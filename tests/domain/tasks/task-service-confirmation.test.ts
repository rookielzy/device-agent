import { describe, expect, it } from "vitest";
import { taskResultSchema } from "../../../src/contracts/task-contract.js";
import { SimulatedDeviceService } from "../../../src/domain/devices/simulated-device-service.js";
import type {
  DeviceControlApplyResult,
  DeviceControlProposalResult,
  DeviceReadResult
} from "../../../src/domain/devices/device-results.js";
import { TaskService, type TaskDeviceService } from "../../../src/domain/tasks/task-service.js";
import {
  createFixedInterpreter,
  createIdSequence,
  createMutableClock,
  hallwayLightOnProposal,
  offlineKitchenControlProposal
} from "../../fixtures/task-fixtures.js";

function createConfirmationService(options: {
  clock?: () => Date;
  pendingControlTtlMs?: number;
  deviceService?: TaskDeviceService;
} = {}) {
  const clock = options.clock ?? (() => new Date("2026-06-07T09:00:00.000Z"));

  return new TaskService({
    interpreter: createFixedInterpreter(hallwayLightOnProposal),
    ...(options.deviceService ? { deviceService: options.deviceService } : {}),
    clock,
    taskIdGenerator: createIdSequence("task"),
    pendingControlIdGenerator: createIdSequence("pending"),
    timelineEventIdGenerator: createIdSequence("evt"),
    ...(options.pendingControlTtlMs !== undefined ? { pendingControlTtlMs: options.pendingControlTtlMs } : {})
  });
}

function hallwayPower(service: SimulatedDeviceService): boolean | undefined {
  const result = service.readStatus({
    room: "hallway",
    deviceType: "light",
    dataItem: "power"
  });

  if (result.kind !== "read_success") {
    return undefined;
  }

  return result.dataItems[0]?.value as boolean | undefined;
}

class FailingApplyDeviceService {
  readonly inner = new SimulatedDeviceService();
  failApply = false;

  readStatus(target: Parameters<SimulatedDeviceService["readStatus"]>[0]): DeviceReadResult {
    return this.inner.readStatus(target);
  }

  proposeControl(target: Parameters<SimulatedDeviceService["proposeControl"]>[0]): DeviceControlProposalResult {
    return this.inner.proposeControl(target);
  }

  applyControl(target: Parameters<SimulatedDeviceService["applyControl"]>[0]): DeviceControlApplyResult {
    if (this.failApply) {
      const device = this.inner.debugSnapshot().find((candidate) => candidate.deviceId === "device-light-hallway");

      return {
        kind: "unavailable",
        reason: "device_offline",
        device: {
          ...device!,
          availability: {
            online: false,
            reason: "Device went offline before confirmation"
          }
        },
        message: "Device went offline before confirmation"
      };
    }

    return this.inner.applyControl(target);
  }

  debugSnapshot(): ReturnType<SimulatedDeviceService["debugSnapshot"]> {
    return this.inner.debugSnapshot();
  }
}

describe("TaskService confirmation lifecycle", () => {
  it("creates pending controls without mutating simulated state", async () => {
    const deviceService = new SimulatedDeviceService();
    const service = createConfirmationService({ deviceService });

    const result = await service.createTask("Turn on the hallway light");

    expect(taskResultSchema.safeParse(result).success).toBe(true);
    expect(result.executionState).toBe("pending_confirmation");
    expect(result.pendingControl?.pendingControlId).toBe("pending-001");
    expect(result.selectedControlItems[0]?.requestedValue).toBe(true);
    expect(result.timeline.map((event) => event.stage)).not.toContain("simulated_execution");
    expect(hallwayPower(deviceService)).toBe(false);
    expect(service.pendingControlRepository.getByTaskId(result.taskId)?.status).toBe("pending");
  });

  it("confirms a pending control, applies mutation once, and stores final task state", async () => {
    const deviceService = new SimulatedDeviceService();
    const service = createConfirmationService({ deviceService });
    const pending = await service.createTask("Turn on the hallway light");

    const confirmed = service.confirmTask(pending.taskId);
    const duplicate = service.confirmTask(pending.taskId);

    expect(confirmed.executionState).toBe("completed");
    expect(confirmed.outcomeReason).toBe("none");
    expect(confirmed.pendingControl).toBeUndefined();
    expect(confirmed.timeline.map((event) => event.stage)).toEqual([
      "request_received",
      "model_interpretation",
      "service_validation",
      "device_resolution",
      "confirmation_required",
      "final_outcome",
      "confirmation_received",
      "simulated_execution",
      "final_outcome"
    ]);
    expect(hallwayPower(deviceService)).toBe(true);

    expect(duplicate.executionState).toBe("failed");
    expect(duplicate.outcomeReason).toBe("pending_control_already_confirmed");
    expect(hallwayPower(deviceService)).toBe(true);

    const stored = service.getTask(pending.taskId);
    expect(stored.ok).toBe(true);
    if (stored.ok) {
      expect(stored.task.executionState).toBe("completed");
      expect(stored.task.outcomeReason).toBe("none");
    }
  });

  it("confirms and rejects by pending control id", async () => {
    const confirmDeviceService = new SimulatedDeviceService();
    const confirmService = createConfirmationService({ deviceService: confirmDeviceService });
    const pending = await confirmService.createTask("Turn on the hallway light");

    const confirmed = confirmService.confirmPendingControl(pending.pendingControl!.pendingControlId);

    expect(confirmed.executionState).toBe("completed");
    expect(hallwayPower(confirmDeviceService)).toBe(true);

    const rejectDeviceService = new SimulatedDeviceService();
    const rejectService = createConfirmationService({ deviceService: rejectDeviceService });
    const rejectPending = await rejectService.createTask("Turn on the hallway light");

    const rejected = rejectService.rejectPendingControl(rejectPending.pendingControl!.pendingControlId);

    expect(rejected.executionState).toBe("rejected");
    expect(hallwayPower(rejectDeviceService)).toBe(false);
  });

  it("rejects pending controls without mutation", async () => {
    const deviceService = new SimulatedDeviceService();
    const service = createConfirmationService({ deviceService });
    const pending = await service.createTask("Turn on the hallway light");

    const rejected = service.rejectTask(pending.taskId);
    const confirmAfterReject = service.confirmTask(pending.taskId);

    expect(rejected.executionState).toBe("rejected");
    expect(rejected.outcomeReason).toBe("control_rejected");
    expect(rejected.pendingControl).toBeUndefined();
    expect(rejected.timeline.map((event) => event.stage)).not.toContain("simulated_execution");
    expect(hallwayPower(deviceService)).toBe(false);

    expect(confirmAfterReject.executionState).toBe("rejected");
    expect(confirmAfterReject.outcomeReason).toBe("pending_control_already_rejected");
    expect(hallwayPower(deviceService)).toBe(false);

    const stored = service.getTask(pending.taskId);
    expect(stored.ok).toBe(true);
    if (stored.ok) {
      expect(stored.task.executionState).toBe("rejected");
      expect(stored.task.outcomeReason).toBe("control_rejected");
    }
  });

  it("blocks missing and expired confirmations without mutation", async () => {
    const mutable = createMutableClock(new Date("2026-06-07T09:00:00.000Z"));
    const deviceService = new SimulatedDeviceService({ clock: mutable.clock });
    const service = createConfirmationService({
      clock: mutable.clock,
      deviceService,
      pendingControlTtlMs: 60_000
    });

    const missing = service.confirmTask("missing-task");
    const pending = await service.createTask("Turn on the hallway light");
    mutable.set(new Date("2026-06-07T09:02:00.000Z"));
    const expired = service.confirmTask(pending.taskId);
    const repeatedExpired = service.confirmTask(pending.taskId);

    expect(missing.executionState).toBe("failed");
    expect(missing.outcomeReason).toBe("pending_control_missing");
    expect(expired.executionState).toBe("failed");
    expect(expired.outcomeReason).toBe("pending_control_expired");
    expect(repeatedExpired.outcomeReason).toBe("pending_control_expired");
    expect(hallwayPower(deviceService)).toBe(false);

    expect(service.getTask("missing-task").ok).toBe(false);
    const stored = service.getTask(pending.taskId);
    expect(stored.ok).toBe(true);
    if (stored.ok) {
      expect(stored.task.executionState).toBe("pending_confirmation");
      expect(stored.task.outcomeReason).toBe("none");
    }
  });

  it("does not consume pending controls when confirmation-time device apply fails", async () => {
    const deviceService = new FailingApplyDeviceService();
    const service = createConfirmationService({
      deviceService
    });
    const pending = await service.createTask("Turn on the hallway light");

    deviceService.failApply = true;
    const failed = service.confirmTask(pending.taskId);
    const repeated = service.confirmTask(pending.taskId);

    expect(failed.executionState).toBe("unavailable");
    expect(failed.outcomeReason).toBe("device_offline");
    expect(failed.timeline.map((event) => event.stage)).not.toContain("simulated_execution");
    expect(repeated.executionState).toBe("unavailable");
    expect(repeated.outcomeReason).toBe("device_offline");
    expect(hallwayPower(deviceService.inner)).toBe(false);
    expect(service.pendingControlRepository.getByTaskId(pending.taskId)?.status).toBe("pending");

    const stored = service.getTask(pending.taskId);
    expect(stored.ok).toBe(true);
    if (stored.ok) {
      expect(stored.task.executionState).toBe("pending_confirmation");
      expect(stored.task.outcomeReason).toBe("none");
    }
  });

  it("blocks offline control creation before a pending control exists", async () => {
    const deviceService = new SimulatedDeviceService();
    const service = new TaskService({
      interpreter: createFixedInterpreter(offlineKitchenControlProposal),
      deviceService,
      clock: () => new Date("2026-06-07T09:00:00.000Z"),
      taskIdGenerator: createIdSequence("task"),
      pendingControlIdGenerator: createIdSequence("pending"),
      timelineEventIdGenerator: createIdSequence("evt")
    });

    const result = await service.createTask("Turn on the kitchen light");

    expect(result.executionState).toBe("unavailable");
    expect(result.outcomeReason).toBe("device_offline");
    expect(result.pendingControl).toBeUndefined();
    expect(service.pendingControlRepository.getByTaskId(result.taskId)).toBeUndefined();
    expect(deviceService.debugSnapshot().find((device) => device.deviceId === "device-light-kitchen")?.writableControls[0]?.currentValue).toBeUndefined();
  });
});
