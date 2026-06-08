import { describe, expect, it } from "vitest";
import { apiErrorSchema } from "../../src/contracts/api-contract.js";
import { taskResultSchema, type TaskResult } from "../../src/contracts/task-contract.js";
import type { SimulatedDeviceService } from "../../src/domain/devices/simulated-device-service.js";
import { createMutableClock, hallwayLightOnProposal } from "../fixtures/task-fixtures.js";
import { createTestApi } from "./api-test-helpers.js";

describe("Task confirmation HTTP API", () => {
  it("creates pending controls, confirms by task id, mutates once, and persists final task state", async () => {
    const api = createTestApi([hallwayLightOnProposal]);

    try {
      const created = taskResultSchema.parse((await api.app.inject({
        method: "POST",
        url: "/tasks",
        payload: { text: "Turn on the hallway light" }
      })).json<TaskResult>());
      const beforeConfirm = hallwayPower(api.simulatedDeviceService);
      const confirmedResponse = await api.app.inject({
        method: "POST",
        url: `/tasks/${created.taskId}/confirm`
      });
      const confirmed = taskResultSchema.parse(confirmedResponse.json<TaskResult>());
      const duplicate = taskResultSchema.parse((await api.app.inject({
        method: "POST",
        url: `/tasks/${created.taskId}/confirm`
      })).json<TaskResult>());
      const inspected = taskResultSchema.parse((await api.app.inject({
        method: "GET",
        url: `/tasks/${created.taskId}`
      })).json<TaskResult>());

      expect(created.executionState).toBe("pending_confirmation");
      expect(created.pendingControl?.pendingControlId).toBe("pending-001");
      expect(created.timeline.map((event) => event.stage)).not.toContain("simulated_execution");
      expect(beforeConfirm).toBe(false);

      expect(confirmedResponse.statusCode).toBe(200);
      expect(confirmed.executionState).toBe("completed");
      expect(confirmed.outcomeReason).toBe("none");
      expect(confirmed.pendingControl).toBeUndefined();
      expect(confirmed.timeline.map((event) => event.stage)).toContain("confirmation_received");
      expect(confirmed.timeline.map((event) => event.stage)).toContain("simulated_execution");
      expect(hallwayPower(api.simulatedDeviceService)).toBe(true);

      expect(duplicate.executionState).toBe("failed");
      expect(duplicate.outcomeReason).toBe("pending_control_already_confirmed");
      expect(hallwayPower(api.simulatedDeviceService)).toBe(true);
      expect(inspected.executionState).toBe("completed");
      expect(inspected.outcomeReason).toBe("none");
    } finally {
      await api.app.close();
    }
  });

  it("rejects pending controls without mutation and blocks later confirmation", async () => {
    const api = createTestApi([hallwayLightOnProposal]);

    try {
      const created = taskResultSchema.parse((await api.app.inject({
        method: "POST",
        url: "/tasks",
        payload: { text: "Turn on the hallway light" }
      })).json<TaskResult>());
      const rejectedResponse = await api.app.inject({
        method: "POST",
        url: `/tasks/${created.taskId}/reject`
      });
      const rejected = taskResultSchema.parse(rejectedResponse.json<TaskResult>());
      const confirmAfterReject = taskResultSchema.parse((await api.app.inject({
        method: "POST",
        url: `/tasks/${created.taskId}/confirm`
      })).json<TaskResult>());

      expect(rejectedResponse.statusCode).toBe(200);
      expect(rejected.executionState).toBe("rejected");
      expect(rejected.outcomeReason).toBe("control_rejected");
      expect(rejected.pendingControl).toBeUndefined();
      expect(rejected.timeline.map((event) => event.stage)).not.toContain("simulated_execution");
      expect(confirmAfterReject.executionState).toBe("rejected");
      expect(confirmAfterReject.outcomeReason).toBe("pending_control_already_rejected");
      expect(hallwayPower(api.simulatedDeviceService)).toBe(false);
    } finally {
      await api.app.close();
    }
  });

  it("returns task-shaped missing and expired confirmation outcomes without creating missing task records", async () => {
    const mutable = createMutableClock(new Date("2026-06-07T09:00:00.000Z"));
    const api = createTestApi([hallwayLightOnProposal], {
      clock: mutable.clock,
      pendingControlTtlMs: 60_000
    });

    try {
      const missing = taskResultSchema.parse((await api.app.inject({
        method: "POST",
        url: "/tasks/missing-task/confirm"
      })).json<TaskResult>());
      const created = taskResultSchema.parse((await api.app.inject({
        method: "POST",
        url: "/tasks",
        payload: { text: "Turn on the hallway light" }
      })).json<TaskResult>());

      mutable.set(new Date("2026-06-07T09:02:00.000Z"));
      const expired = taskResultSchema.parse((await api.app.inject({
        method: "POST",
        url: `/tasks/${created.taskId}/confirm`
      })).json<TaskResult>());
      const rejectExpired = taskResultSchema.parse((await api.app.inject({
        method: "POST",
        url: `/tasks/${created.taskId}/reject`
      })).json<TaskResult>());

      expect(missing.executionState).toBe("failed");
      expect(missing.outcomeReason).toBe("pending_control_missing");
      expect(api.taskService.getTask("missing-task").ok).toBe(false);
      expect(expired.executionState).toBe("failed");
      expect(expired.outcomeReason).toBe("pending_control_expired");
      expect(rejectExpired.executionState).toBe("failed");
      expect(rejectExpired.outcomeReason).toBe("pending_control_expired");
      expect(hallwayPower(api.simulatedDeviceService)).toBe(false);
    } finally {
      await api.app.close();
    }
  });

  it("rejects confirmation and rejection request bodies before applying pending controls", async () => {
    const confirmApi = createTestApi([hallwayLightOnProposal]);
    const rejectApi = createTestApi([hallwayLightOnProposal]);

    try {
      const confirmPending = taskResultSchema.parse((await confirmApi.app.inject({
        method: "POST",
        url: "/tasks",
        payload: { text: "Turn on the hallway light" }
      })).json<TaskResult>());
      const rejectPending = taskResultSchema.parse((await rejectApi.app.inject({
        method: "POST",
        url: "/tasks",
        payload: { text: "Turn on the hallway light" }
      })).json<TaskResult>());

      const confirmWithBody = await confirmApi.app.inject({
        method: "POST",
        url: `/tasks/${confirmPending.taskId}/confirm`,
        payload: { text: "Actually turn off something else" }
      });
      const rejectWithBody = await rejectApi.app.inject({
        method: "POST",
        url: `/tasks/${rejectPending.taskId}/reject`,
        payload: { text: "Reject a different request" }
      });

      expect(confirmWithBody.statusCode).toBe(400);
      expect(rejectWithBody.statusCode).toBe(400);
      expect(apiErrorSchema.parse(confirmWithBody.json()).error.code).toBe("bad_request");
      expect(apiErrorSchema.parse(rejectWithBody.json()).error.code).toBe("bad_request");
      expect(hallwayPower(confirmApi.simulatedDeviceService)).toBe(false);
      expect(hallwayPower(rejectApi.simulatedDeviceService)).toBe(false);
      expect(confirmApi.taskService.pendingControlRepository.getByTaskId(confirmPending.taskId)?.status).toBe("pending");
      expect(rejectApi.taskService.pendingControlRepository.getByTaskId(rejectPending.taskId)?.status).toBe("pending");
    } finally {
      await confirmApi.app.close();
      await rejectApi.app.close();
    }
  });
});

function hallwayPower(service: SimulatedDeviceService): boolean | undefined {
  return service.debugSnapshot().find((device) => device.deviceId === "device-light-hallway")?.readableValues.find((item) => item.itemId === "power")?.value as boolean | undefined;
}
