import { describe, expect, it } from "vitest";
import { agentProposalSchema } from "../../../src/agent/agent-interpreter.js";
import { taskResultSchema } from "../../../src/contracts/task-contract.js";
import type { SimulatedDeviceContext } from "../../../src/contracts/device-contract.js";
import type { AgentProposal } from "../../../src/agent/agent-interpreter.js";
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

    const reported = await reportedFailureService.createTask("nonsense");
    const invalidShape = await invalidShapeService.createTask("turn something");

    expect(reported.executionState).toBe("failed");
    expect(reported.outcomeReason).toBe("parse_failure");
    expect(reported.timeline.some((event) => event.stage === "model_interpretation" && event.status === "failed")).toBe(true);

    expect(invalidShape.executionState).toBe("failed");
    expect(invalidShape.outcomeReason).toBe("parse_failure");
    expect(taskResultSchema.safeParse(invalidShape).success).toBe(true);
  });

  it("creates a completed provider-neutral platform status task", async () => {
    const service = createServiceForProposal(platformSuccessProposal);

    const result = await service.createTask("A 项目 1 楼财务室空调开着吗，现在多少度");

    expect(taskResultSchema.safeParse(result).success).toBe(true);
    expect(result).toMatchObject({
      classification: "status_query",
      executionState: "completed",
      outcomeReason: "none"
    });
    expect(result.reply).toContain("23.5");
    expect(result.selectedContext.devices[0]).toMatchObject({
      deviceId: "99887766",
      displayName: "财务室空调",
      type: "air_conditioner"
    });
    expect(result.selectedDataItems.map((item) => [item.name, item.value])).toEqual([
      ["开关状态", true],
      ["回风温度", 23.5]
    ]);
    expect(result.timeline.map((event) => event.stage)).toEqual([
      "request_received",
      "model_interpretation",
      "service_validation",
      "platform_search",
      "platform_detail",
      "platform_runtime_read",
      "final_outcome"
    ]);
    expect(result.timeline.map((event) => event.source)).toContain("platform");
    expectProviderNeutral(result);
  });

  it("maps ambiguous platform proposals to clarification with candidate context", async () => {
    const service = createServiceForProposal({
      kind: "platform_status_query",
      result: {
        kind: "ambiguous",
        reason: "ambiguous_target",
        candidates: [
          platformDevice("99887766", "财务室空调"),
          platformDevice("99887767", "财务室备用空调")
        ],
        stage: "platform_search"
      }
    });

    const result = await service.createTask("财务室空调现在多少度");

    expect(result.executionState).toBe("needs_clarification");
    expect(result.outcomeReason).toBe("ambiguous_target");
    expect(result.selectedContext.candidates.map((candidate) => candidate.deviceId)).toEqual(["99887766", "99887767"]);
    expect(result.selectedDataItems).toEqual([]);
    expect(result.timeline.some((event) => event.stage === "platform_search" && event.status === "blocked")).toBe(true);
  });

  it("maps metadata-unrecognized, timeout, and no-data platform proposals to sanitized non-success outcomes", async () => {
    const metadata = await createServiceForProposal({
      kind: "platform_status_query",
      result: {
        kind: "unavailable",
        reason: "metadata_unrecognized",
        device: platformDevice("99887766", "财务室空调"),
        candidates: [],
        stage: "platform_runtime_read"
      }
    }).createTask("财务室空调现在多少度");
    const timeout = await createServiceForProposal({
      kind: "platform_status_query",
      result: {
        kind: "unavailable",
        reason: "platform_timeout",
        candidates: [],
        stage: "platform_search"
      }
    }).createTask("财务室空调现在多少度");
    const noData = await createServiceForProposal({
      kind: "platform_status_query",
      result: {
        kind: "unavailable",
        reason: "platform_no_data",
        device: platformDevice("99887766", "财务室空调"),
        candidates: [],
        stage: "platform_runtime_read"
      }
    }).createTask("财务室空调现在多少度");
    const auth = await createServiceForProposal({
      kind: "platform_status_query",
      result: {
        kind: "unavailable",
        reason: "platform_auth_failed",
        candidates: [],
        stage: "platform_auth"
      }
    }).createTask("财务室空调现在多少度");
    const platformError = await createServiceForProposal({
      kind: "platform_status_query",
      result: {
        kind: "unavailable",
        reason: "platform_error",
        device: platformDevice("99887766", "财务室空调"),
        candidates: [],
        stage: "platform_detail"
      }
    }).createTask("财务室空调现在多少度");

    expect(metadata).toMatchObject({
      executionState: "unavailable",
      outcomeReason: "metadata_unrecognized"
    });
    expect(metadata.selectedDataItems).toEqual([]);
    expect(timeout).toMatchObject({
      executionState: "unavailable",
      outcomeReason: "platform_timeout"
    });
    expect(noData).toMatchObject({
      executionState: "unavailable",
      outcomeReason: "platform_no_data"
    });
    expect(auth).toMatchObject({
      executionState: "failed",
      outcomeReason: "platform_auth_failed"
    });
    expect(platformError).toMatchObject({
      executionState: "failed",
      outcomeReason: "platform_error"
    });
    expect(auth.timeline.some((event) => event.stage === "platform_auth" && event.status === "failed")).toBe(true);
    expect(platformError.timeline.some((event) => event.stage === "platform_detail" && event.status === "failed")).toBe(true);
    expect(noData.timeline.some((event) => event.stage === "platform_runtime_read" && event.status === "blocked")).toBe(true);
    expectProviderNeutral(metadata);
    expectProviderNeutral(timeout);
    expectProviderNeutral(noData);
    expectProviderNeutral(auth);
    expectProviderNeutral(platformError);
  });
});

const platformSuccessProposal: AgentProposal = {
  kind: "platform_status_query",
  result: {
    kind: "platform_status_success",
    device: {
      ...platformDevice("99887766", "财务室空调"),
      readableValues: [
        {
          itemId: "powerswitch",
          name: "开关状态",
          metadata: {
            kind: "boolean",
            label: "开关状态"
          },
          value: true,
          freshness: "fresh"
        },
        {
          itemId: "returnairtemperature",
          name: "回风温度",
          metadata: {
            kind: "number",
            label: "回风温度",
            unit: "℃"
          },
          value: 23.5,
          freshness: "fresh"
        },
        {
          itemId: "supplyairtemperature",
          name: "送风温度",
          metadata: {
            kind: "number",
            label: "送风温度",
            unit: "℃"
          },
          value: 18.2,
          freshness: "fresh"
        }
      ]
    },
    dataItems: [
      {
        deviceId: "99887766",
        itemId: "powerswitch",
        name: "开关状态",
        value: true,
        metadata: {
          kind: "boolean",
          label: "开关状态"
        },
        freshness: "fresh"
      },
      {
        deviceId: "99887766",
        itemId: "returnairtemperature",
        name: "回风温度",
        value: 23.5,
        metadata: {
          kind: "number",
          label: "回风温度",
          unit: "℃"
        },
        freshness: "fresh"
      },
      {
        deviceId: "99887766",
        itemId: "supplyairtemperature",
        name: "送风温度",
        value: 18.2,
        metadata: {
          kind: "number",
          label: "送风温度",
          unit: "℃"
        },
        freshness: "fresh"
      }
    ],
    switchState: true,
    returnAirTemperature: 23.5,
    runStatusHint: "running"
  },
  summary: "Answer finance-room air-conditioner status from real-platform runtime parameters.",
  confidence: 0.9
};

function platformDevice(deviceId: string, displayName: string): SimulatedDeviceContext {
  return {
    deviceId,
    displayName,
    room: "财务室",
    type: "air_conditioner",
    availability: {
      online: true
    },
    capabilities: ["platform_read", "read_air_conditioner_status"],
    readableValues: [],
    writableControls: []
  };
}

function expectProviderNeutral(value: unknown): void {
  const serialized = JSON.stringify(value);

  for (const forbidden of [
    "runtimeParams",
    "serialNumber",
    "gateway",
    "access-token",
    "refresh-token",
    "password",
    "tool_calls",
    "DeepSeek"
  ]) {
    expect(serialized).not.toContain(forbidden);
  }
}
