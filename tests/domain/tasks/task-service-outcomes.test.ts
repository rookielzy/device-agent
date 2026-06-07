import { describe, expect, it } from "vitest";
import { agentProposalSchema } from "../../../src/agent/agent-interpreter.js";
import { taskResultSchema } from "../../../src/contracts/task-contract.js";
import type { SimulatedDeviceContext } from "../../../src/contracts/device-contract.js";
import { SimulatedDeviceService } from "../../../src/domain/devices/simulated-device-service.js";
import { TaskService } from "../../../src/domain/tasks/task-service.js";
import {
  createFixedClock,
  createFixedInterpreter,
  createIdSequence,
  invalidHallwayControlProposal,
  livingRoomStatusProposal,
  parseFailureProposal,
  readOnlySensorControlProposal,
  vagueBedroomStatusProposal
} from "../../fixtures/task-fixtures.js";

function createServiceForProposal(proposal: Parameters<typeof createFixedInterpreter>[0]) {
  return new TaskService({
    interpreter: createFixedInterpreter(proposal),
    clock: createFixedClock(),
    taskIdGenerator: createIdSequence("task"),
    pendingControlIdGenerator: createIdSequence("pending"),
    timelineEventIdGenerator: createIdSequence("evt")
  });
}

describe("TaskService status and blocked outcomes", () => {
  it("creates a completed air-conditioner status task with selected data and timeline attribution", async () => {
    const service = createServiceForProposal(livingRoomStatusProposal);

    const result = await service.createTask("Is the living room air conditioner running?");

    expect(taskResultSchema.safeParse(result).success).toBe(true);
    expect(result).toMatchObject({
      taskId: "task-001",
      classification: "status_query",
      executionState: "completed",
      outcomeReason: "none"
    });
    expect(result.selectedContext.devices[0]?.deviceId).toBe("device-ac-living-room");
    expect(result.selectedDataItems.map((item) => [item.itemId, item.value])).toEqual([
      ["power", true],
      ["mode", "cool"],
      ["target_temperature", 24],
      ["room_temperature", 25.3]
    ]);
    expect(result.timeline.map((event) => event.stage)).toEqual([
      "request_received",
      "model_interpretation",
      "service_validation",
      "device_resolution",
      "simulated_read",
      "final_outcome"
    ]);
    expect(result.timeline.map((event) => event.source)).toContain("simulated_device");

    const stored = service.getTask(result.taskId);
    expect(stored.ok).toBe(true);
    if (stored.ok) {
      expect(stored.task).toEqual(result);
    }
  });

  it("returns clarification for ambiguous bedroom-device status proposals", async () => {
    const service = createServiceForProposal(vagueBedroomStatusProposal);

    const result = await service.createTask("What is the bedroom device doing?");

    expect(taskResultSchema.safeParse(result).success).toBe(true);
    expect(result.executionState).toBe("needs_clarification");
    expect(result.outcomeReason).toBe("ambiguous_target");
    expect(result.selectedContext.candidates.map((device) => device.deviceId)).toEqual([
      "device-sensor-bedroom",
      "device-light-bedroom"
    ]);
    expect(result.selectedControlItems).toHaveLength(0);
    expect(result.timeline.some((event) => event.stage === "device_resolution" && event.status === "blocked")).toBe(true);
  });

  it("filters interpreter-supplied ambiguous candidates through the simulated catalog", async () => {
    const unknownCandidate: SimulatedDeviceContext = {
      deviceId: "device-fake-provider-leak",
      displayName: "Provider Supplied Device",
      room: "garage",
      type: "generic",
      availability: {
        online: true
      },
      capabilities: ["read_power"],
      readableValues: [],
      writableControls: []
    };
    const service = createServiceForProposal({
      kind: "ambiguous",
      reason: "Interpreter returned mixed candidates",
      candidates: [unknownCandidate]
    });

    const result = await service.createTask("Which device?");

    expect(result.executionState).toBe("needs_clarification");
    expect(result.selectedContext.candidates).toEqual([]);
  });

  it("maps unsupported data items and not-found requests to distinct reasons", async () => {
    const unsupportedService = createServiceForProposal({
      kind: "status_query",
      target: {
        room: "hallway",
        deviceType: "light",
        dataItem: "humidity"
      }
    });
    const notFoundService = createServiceForProposal({
      kind: "status_query",
      target: {
        phrase: "Is the garage fan on?"
      }
    });

    const unsupported = await unsupportedService.createTask("What is the hallway humidity?");
    const notFound = await notFoundService.createTask("Is the garage fan on?");

    expect(unsupported.executionState).toBe("unavailable");
    expect(unsupported.outcomeReason).toBe("unsupported_data_item");
    expect(unsupported.pendingControl).toBeUndefined();
    expect(notFound.executionState).toBe("unavailable");
    expect(notFound.outcomeReason).toBe("device_not_found");
    expect(notFound.selectedContext.devices).toHaveLength(0);
  });

  it("maps read-only and invalid control proposals without creating pending controls", async () => {
    const readOnlyService = createServiceForProposal(readOnlySensorControlProposal);
    const deviceService = new SimulatedDeviceService();
    const invalidService = new TaskService({
      interpreter: createFixedInterpreter(invalidHallwayControlProposal),
      deviceService,
      clock: createFixedClock(),
      taskIdGenerator: createIdSequence("task"),
      pendingControlIdGenerator: createIdSequence("pending"),
      timelineEventIdGenerator: createIdSequence("evt")
    });

    const readOnly = await readOnlyService.createTask("Set the bedroom sensor temperature to 19");
    const before = deviceService.readStatus({ room: "hallway", deviceType: "light", dataItem: "power" });
    const invalid = await invalidService.createTask("Set the hallway light power to yes");
    const after = deviceService.readStatus({ room: "hallway", deviceType: "light", dataItem: "power" });

    expect(readOnly.executionState).toBe("unavailable");
    expect(readOnly.outcomeReason).toBe("read_only_control");
    expect(readOnly.pendingControl).toBeUndefined();
    expect(readOnlyService.pendingControlRepository.getByTaskId(readOnly.taskId)).toBeUndefined();

    expect(invalid.executionState).toBe("failed");
    expect(invalid.outcomeReason).toBe("invalid_control_value");
    expect(invalid.pendingControl).toBeUndefined();
    expect(invalidService.pendingControlRepository.getByTaskId(invalid.taskId)).toBeUndefined();
    expect(invalid.timeline.map((event) => event.stage)).not.toContain("simulated_execution");
    expect(before.kind).toBe("read_success");
    expect(after.kind).toBe("read_success");
    if (before.kind === "read_success" && after.kind === "read_success") {
      expect(before.dataItems[0]?.value).toBe(false);
      expect(after.dataItems[0]?.value).toBe(false);
    }
  });

  it("rejects control proposals that include a requested value but no device selector", () => {
    expect(
      agentProposalSchema.safeParse({
        kind: "control_request",
        target: {
          requestedValue: true
        }
      }).success
    ).toBe(false);
  });

  it("returns a failed parse outcome when interpretation cannot be normalized", async () => {
    const reportedFailureService = createServiceForProposal(parseFailureProposal);
    const invalidShapeService = new TaskService({
      interpreter: {
        interpret: () => ({
          kind: "control_request",
          target: {
            room: "hallway"
          }
        }) as never
      },
      clock: createFixedClock(),
      taskIdGenerator: createIdSequence("task"),
      timelineEventIdGenerator: createIdSequence("evt")
    });
    const throwingInterpreterService = new TaskService({
      interpreter: {
        interpret: () => {
          throw new Error("raw provider payload tool_calls request-id-123");
        }
      },
      clock: createFixedClock(),
      taskIdGenerator: createIdSequence("task"),
      timelineEventIdGenerator: createIdSequence("evt")
    });

    const reported = await reportedFailureService.createTask("nonsense");
    const invalidShape = await invalidShapeService.createTask("turn something");
    const thrown = await throwingInterpreterService.createTask("turn something");

    expect(reported.executionState).toBe("failed");
    expect(reported.outcomeReason).toBe("parse_failure");
    expect(reported.timeline.some((event) => event.stage === "model_interpretation" && event.status === "failed")).toBe(true);

    expect(invalidShape.executionState).toBe("failed");
    expect(invalidShape.outcomeReason).toBe("parse_failure");
    expect(taskResultSchema.safeParse(invalidShape).success).toBe(true);

    expect(thrown.executionState).toBe("failed");
    expect(thrown.outcomeReason).toBe("parse_failure");
    expect(JSON.stringify(thrown)).not.toContain("tool_calls");
    expect(JSON.stringify(thrown)).not.toContain("request-id-123");
  });
});
