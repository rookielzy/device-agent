import { describe, expect, it } from "vitest";
import { FakeInterpreter } from "../../src/agent/fake-interpreter.js";
import { sampleUtterances } from "../fixtures/sample-utterances.js";
import {
  closeApp,
  createApiTestApp,
  hallwayPowerFromDebug,
  parseApiErrorResponse,
  parseDebugDeviceResponse,
  parseTaskResponse
} from "./api-test-helpers.js";

describe("Agent Plan Contract HTTP API acceptance", () => {
  it("covers AE1 status query over HTTP", async () => {
    const { app } = createApiTestApp({
      interpreter: new FakeInterpreter()
    });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/tasks",
        payload: {
          text: sampleUtterances.find((utterance) => utterance.id === "ae1-living-room-ac-status")!.text
        }
      });
      const task = parseTaskResponse(response.payload);

      expect(response.statusCode).toBe(201);
      expect(task.executionState).toBe("completed");
      expect(task.selectedDataItems.map((item) => item.itemId)).toEqual([
        "power",
        "mode",
        "target_temperature",
        "room_temperature"
      ]);
      expect(task.timeline.map((event) => event.stage)).toContain("simulated_read");
    } finally {
      await closeApp(app);
    }
  });

  it("covers AE2 confirmed control over HTTP", async () => {
    const { app } = createApiTestApp({
      interpreter: new FakeInterpreter()
    });

    try {
      const pending = parseTaskResponse(
        (
          await app.inject({
            method: "POST",
            url: "/tasks",
            payload: {
              text: sampleUtterances.find((utterance) => utterance.id === "ae2-hallway-light-on")!.text
            }
          })
        ).payload
      );
      const confirmed = parseTaskResponse(
        (
          await app.inject({
            method: "POST",
            url: `/tasks/${pending.taskId}/confirm`,
            payload: {}
          })
        ).payload
      );
      const snapshot = parseDebugDeviceResponse(
        (
          await app.inject({
            method: "GET",
            url: "/debug/simulated-devices"
          })
        ).payload
      );

      expect(pending.executionState).toBe("pending_confirmation");
      expect(confirmed.executionState).toBe("completed");
      expect(confirmed.timeline.map((event) => event.stage)).toContain("simulated_execution");
      expect(hallwayPowerFromDebug(snapshot)).toBe(true);
    } finally {
      await closeApp(app);
    }
  });

  it("covers AE3 unconfirmed and rejected controls without state mutation", async () => {
    const { app } = createApiTestApp({
      interpreter: new FakeInterpreter()
    });

    try {
      const pending = parseTaskResponse(
        (
          await app.inject({
            method: "POST",
            url: "/tasks",
            payload: {
              text: sampleUtterances.find((utterance) => utterance.id === "ae3-unconfirmed-hallway-light")!.text
            }
          })
        ).payload
      );
      const beforeReject = parseDebugDeviceResponse(
        (
          await app.inject({
            method: "GET",
            url: "/debug/simulated-devices"
          })
        ).payload
      );
      const rejected = parseTaskResponse(
        (
          await app.inject({
            method: "POST",
            url: `/tasks/${pending.taskId}/reject`,
            payload: {}
          })
        ).payload
      );
      const afterReject = parseDebugDeviceResponse(
        (
          await app.inject({
            method: "GET",
            url: "/debug/simulated-devices"
          })
        ).payload
      );

      expect(pending.executionState).toBe("pending_confirmation");
      expect(hallwayPowerFromDebug(beforeReject)).toBe(false);
      expect(rejected.executionState).toBe("rejected");
      expect(hallwayPowerFromDebug(afterReject)).toBe(false);
    } finally {
      await closeApp(app);
    }
  });

  it("covers AE4 offline control and AE5 ambiguous request over HTTP", async () => {
    const { app } = createApiTestApp({
      interpreter: new FakeInterpreter()
    });

    try {
      const offline = parseTaskResponse(
        (
          await app.inject({
            method: "POST",
            url: "/tasks",
            payload: {
              text: sampleUtterances.find((utterance) => utterance.id === "ae4-offline-kitchen-light")!.text
            }
          })
        ).payload
      );
      const ambiguous = parseTaskResponse(
        (
          await app.inject({
            method: "POST",
            url: "/tasks",
            payload: {
              text: sampleUtterances.find((utterance) => utterance.id === "ae5-vague-bedroom-device")!.text
            }
          })
        ).payload
      );

      expect(offline.executionState).toBe("unavailable");
      expect(offline.outcomeReason).toBe("device_offline");
      expect(offline.pendingControl).toBeUndefined();
      expect(ambiguous.executionState).toBe("needs_clarification");
      expect(ambiguous.selectedContext.candidates).toHaveLength(2);
    } finally {
      await closeApp(app);
    }
  });

  it("covers AE6 transport failures through ApiError", async () => {
    const { app } = createApiTestApp();

    try {
      const malformed = await app.inject({
        method: "POST",
        url: "/tasks",
        payload: {
          text: ""
        }
      });
      const missing = await app.inject({
        method: "GET",
        url: "/tasks/missing-task"
      });
      const unknown = await app.inject({
        method: "GET",
        url: "/unknown"
      });

      expect(parseApiErrorResponse(malformed.payload).error.code).toBe("validation_error");
      expect(parseApiErrorResponse(missing.payload).error.code).toBe("not_found");
      expect(parseApiErrorResponse(unknown.payload).error.code).toBe("not_found");
    } finally {
      await closeApp(app);
    }
  });
});
