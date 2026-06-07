import { describe, expect, it } from "vitest";
import type { AgentInterpreter } from "../../src/agent/agent-interpreter.js";
import {
  hallwayPowerFromDebug,
  parseDebugDeviceResponse,
  parseTaskResponse,
  closeApp,
  createApiTestApp
} from "./api-test-helpers.js";
import {
  createMutableClock,
  hallwayLightOnProposal
} from "../fixtures/task-fixtures.js";

describe("Task confirmation and rejection API", () => {
  it("creates a pending control and confirms it through the stored task id", async () => {
    const { app } = createApiTestApp({
      proposals: [hallwayLightOnProposal]
    });

    try {
      const pendingResponse = await app.inject({
        method: "POST",
        url: "/tasks",
        payload: {
          text: "Turn on the hallway light"
        }
      });
      const pending = parseTaskResponse(pendingResponse.payload);
      const beforeDebug = parseDebugDeviceResponse(
        (
          await app.inject({
            method: "GET",
            url: "/debug/simulated-devices"
          })
        ).payload
      );
      const confirmResponse = await app.inject({
        method: "POST",
        url: `/tasks/${pending.taskId}/confirm`,
        payload: {}
      });
      const confirmed = parseTaskResponse(confirmResponse.payload);
      const afterDebug = parseDebugDeviceResponse(
        (
          await app.inject({
            method: "GET",
            url: "/debug/simulated-devices"
          })
        ).payload
      );
      const duplicateResponse = await app.inject({
        method: "POST",
        url: `/tasks/${pending.taskId}/confirm`,
        payload: {}
      });
      const duplicate = parseTaskResponse(duplicateResponse.payload);
      const inspected = parseTaskResponse(
        (
          await app.inject({
            method: "GET",
            url: `/tasks/${pending.taskId}`
          })
        ).payload
      );

      expect(pendingResponse.statusCode).toBe(201);
      expect(pending.executionState).toBe("pending_confirmation");
      expect(pending.pendingControl?.pendingControlId).toBe("pending-001");
      expect(hallwayPowerFromDebug(beforeDebug)).toBe(false);

      expect(confirmResponse.statusCode).toBe(200);
      expect(confirmed.executionState).toBe("completed");
      expect(confirmed.outcomeReason).toBe("none");
      expect(confirmed.pendingControl).toBeUndefined();
      expect(confirmed.timeline.map((event) => event.stage)).toContain("confirmation_received");
      expect(confirmed.timeline.map((event) => event.stage)).toContain("simulated_execution");
      expect(hallwayPowerFromDebug(afterDebug)).toBe(true);

      expect(duplicate.executionState).toBe("failed");
      expect(duplicate.outcomeReason).toBe("pending_control_already_confirmed");
      expect(hallwayPowerFromDebug(afterDebug)).toBe(true);
      expect(inspected).toEqual(confirmed);
    } finally {
      await closeApp(app);
    }
  });

  it("rejects pending controls without mutating simulated state", async () => {
    const { app } = createApiTestApp({
      proposals: [hallwayLightOnProposal]
    });

    try {
      const pending = parseTaskResponse(
        (
          await app.inject({
            method: "POST",
            url: "/tasks",
            payload: {
              text: "Turn on the hallway light"
            }
          })
        ).payload
      );
      const rejectResponse = await app.inject({
        method: "POST",
        url: `/tasks/${pending.taskId}/reject`,
        payload: {}
      });
      const rejected = parseTaskResponse(rejectResponse.payload);
      const confirmAfterReject = parseTaskResponse(
        (
          await app.inject({
            method: "POST",
            url: `/tasks/${pending.taskId}/confirm`,
            payload: {}
          })
        ).payload
      );
      const debug = parseDebugDeviceResponse(
        (
          await app.inject({
            method: "GET",
            url: "/debug/simulated-devices"
          })
        ).payload
      );
      const inspected = parseTaskResponse(
        (
          await app.inject({
            method: "GET",
            url: `/tasks/${pending.taskId}`
          })
        ).payload
      );

      expect(rejectResponse.statusCode).toBe(200);
      expect(rejected.executionState).toBe("rejected");
      expect(rejected.outcomeReason).toBe("control_rejected");
      expect(rejected.timeline.map((event) => event.stage)).not.toContain("simulated_execution");
      expect(confirmAfterReject.executionState).toBe("rejected");
      expect(confirmAfterReject.outcomeReason).toBe("pending_control_already_rejected");
      expect(hallwayPowerFromDebug(debug)).toBe(false);
      expect(inspected).toEqual(rejected);
    } finally {
      await closeApp(app);
    }
  });

  it("returns service-owned failed task results for missing and expired confirmations", async () => {
    const mutable = createMutableClock(new Date("2026-06-07T09:00:00.000Z"));
    const { app } = createApiTestApp({
      proposals: [hallwayLightOnProposal],
      interpreter: {
        interpret: () => hallwayLightOnProposal
      },
      clock: mutable.clock,
      pendingControlTtlMs: 60_000
    });

    try {
      const missing = parseTaskResponse(
        (
          await app.inject({
            method: "POST",
            url: "/tasks/missing-task/confirm",
            payload: {}
          })
        ).payload
      );
      const pending = parseTaskResponse(
        (
          await app.inject({
            method: "POST",
            url: "/tasks",
            payload: {
              text: "Turn on the hallway light"
            }
          })
        ).payload
      );
      mutable.set(new Date("2026-06-07T09:02:00.000Z"));
      const expired = parseTaskResponse(
        (
          await app.inject({
            method: "POST",
            url: `/tasks/${pending.taskId}/confirm`,
            payload: {}
          })
        ).payload
      );

      expect(missing.executionState).toBe("failed");
      expect(missing.outcomeReason).toBe("pending_control_missing");
      expect(expired.executionState).toBe("failed");
      expect(expired.outcomeReason).toBe("pending_control_expired");
    } finally {
      await closeApp(app);
    }
  });

  it("does not call the interpreter during confirmation or rejection", async () => {
    const calls: string[] = [];
    const interpreter: AgentInterpreter = {
      interpret(input) {
        calls.push(input.originalText);
        return hallwayLightOnProposal;
      }
    };
    const { app } = createApiTestApp({
      interpreter
    });

    try {
      const pending = parseTaskResponse(
        (
          await app.inject({
            method: "POST",
            url: "/tasks",
            payload: {
              text: "Turn on the hallway light"
            }
          })
        ).payload
      );

      const bodyRejected = await app.inject({
        method: "POST",
        url: `/tasks/${pending.taskId}/confirm`,
        payload: {
          text: "try to reinterpret"
        }
      });
      const confirmed = await app.inject({
        method: "POST",
        url: `/tasks/${pending.taskId}/confirm`,
        payload: {}
      });
      const rejectedAfterConfirm = await app.inject({
        method: "POST",
        url: `/tasks/${pending.taskId}/reject`,
        payload: {}
      });

      expect(bodyRejected.statusCode).toBe(400);
      expect(confirmed.statusCode).toBe(200);
      expect(rejectedAfterConfirm.statusCode).toBe(200);
      expect(calls).toEqual(["Turn on the hallway light"]);
    } finally {
      await closeApp(app);
    }
  });
});
