import { describe, expect, it } from "vitest";
import { TASK_TEXT_MAX_LENGTH } from "../../src/contracts/api-contract.js";
import {
  parseApiErrorResponse,
  parseTaskResponse,
  closeApp,
  createApiTestApp
} from "./api-test-helpers.js";
import {
  livingRoomStatusProposal,
  offlineKitchenControlProposal,
  parseFailureProposal,
  vagueBedroomStatusProposal
} from "../fixtures/task-fixtures.js";

describe("Task creation and inspection API", () => {
  it("creates and retrieves a completed air-conditioner status task", async () => {
    const { app } = createApiTestApp({
      proposals: [livingRoomStatusProposal]
    });

    try {
      const createResponse = await app.inject({
        method: "POST",
        url: "/tasks",
        payload: {
          text: "Is the living room air conditioner running?"
        }
      });
      const created = parseTaskResponse(createResponse.payload);
      const inspectResponse = await app.inject({
        method: "GET",
        url: `/tasks/${created.taskId}`
      });
      const inspected = parseTaskResponse(inspectResponse.payload);

      expect(createResponse.statusCode).toBe(201);
      expect(inspectResponse.statusCode).toBe(200);
      expect(created).toMatchObject({
        taskId: "task-001",
        classification: "status_query",
        executionState: "completed",
        outcomeReason: "none"
      });
      expect(created.selectedContext.devices[0]?.deviceId).toBe("device-ac-living-room");
      expect(created.selectedDataItems.map((item) => [item.itemId, item.value])).toEqual([
        ["power", true],
        ["mode", "cool"],
        ["target_temperature", 24],
        ["room_temperature", 25.3]
      ]);
      expect(created.timeline.map((event) => event.stage)).toEqual([
        "request_received",
        "model_interpretation",
        "service_validation",
        "device_resolution",
        "simulated_read",
        "final_outcome"
      ]);
      expect(inspected).toEqual(created);
    } finally {
      await closeApp(app);
    }
  });

  it("returns clarification for vague bedroom-device requests without selecting controls", async () => {
    const { app } = createApiTestApp({
      proposals: [vagueBedroomStatusProposal]
    });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/tasks",
        payload: {
          text: "What is the bedroom device doing?"
        }
      });
      const task = parseTaskResponse(response.payload);

      expect(response.statusCode).toBe(201);
      expect(task.executionState).toBe("needs_clarification");
      expect(task.outcomeReason).toBe("ambiguous_target");
      expect(task.selectedContext.candidates.map((device) => device.deviceId)).toEqual([
        "device-sensor-bedroom",
        "device-light-bedroom"
      ]);
      expect(task.selectedControlItems).toHaveLength(0);
      expect(task.pendingControl).toBeUndefined();
    } finally {
      await closeApp(app);
    }
  });

  it("returns unavailable for offline kitchen-light control without creating pending control", async () => {
    const { app, services } = createApiTestApp({
      proposals: [offlineKitchenControlProposal]
    });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/tasks",
        payload: {
          text: "Turn on the kitchen light"
        }
      });
      const task = parseTaskResponse(response.payload);

      expect(response.statusCode).toBe(201);
      expect(task.executionState).toBe("unavailable");
      expect(task.outcomeReason).toBe("device_offline");
      expect(task.pendingControl).toBeUndefined();
      expect(services.taskService.pendingControlRepository.getByTaskId(task.taskId)).toBeUndefined();
      expect(task.timeline.map((event) => event.stage)).not.toContain("simulated_execution");
    } finally {
      await closeApp(app);
    }
  });

  it("keeps unsupported and parse-failure utterances task-shaped without provider fields", async () => {
    const { app } = createApiTestApp({
      proposals: [
        {
          kind: "unsupported",
          reason: "No supported simulated status target was recognized.",
          target: {
            phrase: "Show me the garage fan status"
          },
          confidence: 0.35
        },
        parseFailureProposal
      ]
    });

    try {
      const unsupportedResponse = await app.inject({
        method: "POST",
        url: "/tasks",
        payload: {
          text: "Show me the garage fan status"
        }
      });
      const parseFailureResponse = await app.inject({
        method: "POST",
        url: "/tasks",
        payload: {
          text: "Blue banana entropy please"
        }
      });
      const unsupported = parseTaskResponse(unsupportedResponse.payload);
      const parseFailure = parseTaskResponse(parseFailureResponse.payload);

      expect(unsupported.executionState).toBe("failed");
      expect(unsupported.outcomeReason).toBe("unsupported_request");
      expect(parseFailure.executionState).toBe("failed");
      expect(parseFailure.outcomeReason).toBe("parse_failure");
      expect(JSON.stringify(unsupported)).not.toContain("tool_calls");
      expect(JSON.stringify(parseFailure)).not.toContain("DeepSeek");
    } finally {
      await closeApp(app);
    }
  });

  it("sanitizes thrown interpreter errors in task-shaped HTTP responses", async () => {
    const { app } = createApiTestApp({
      interpreter: {
        interpret() {
          throw new Error("raw provider payload tool_calls request-id-123");
        }
      }
    });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/tasks",
        payload: {
          text: "Turn on something"
        }
      });
      const task = parseTaskResponse(response.payload);

      expect(response.statusCode).toBe(201);
      expect(task.executionState).toBe("failed");
      expect(task.outcomeReason).toBe("parse_failure");
      expect(JSON.stringify(task)).not.toContain("tool_calls");
      expect(JSON.stringify(task)).not.toContain("request-id-123");
    } finally {
      await closeApp(app);
    }
  });

  it("rejects malformed creation payloads and unknown inspections as ApiError", async () => {
    const { app, services } = createApiTestApp();

    try {
      const malformed = await app.inject({
        method: "POST",
        url: "/tasks",
        payload: {
          text: " "
        }
      });
      const unknown = await app.inject({
        method: "GET",
        url: "/tasks/missing-task"
      });

      expect(malformed.statusCode).toBe(400);
      expect(parseApiErrorResponse(malformed.payload).error.code).toBe("validation_error");
      expect(unknown.statusCode).toBe(404);
      expect(parseApiErrorResponse(unknown.payload).error.code).toBe("not_found");
      expect(services.taskService.taskRepository.list()).toEqual([]);
    } finally {
      await closeApp(app);
    }
  });

  it("rejects overlong task text before it can reach the interpreter", async () => {
    const { app, services } = createApiTestApp({
      interpreter: {
        interpret() {
          throw new Error("interpreter should not be called");
        }
      }
    });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/tasks",
        payload: {
          text: "x".repeat(TASK_TEXT_MAX_LENGTH + 1)
        }
      });
      const error = parseApiErrorResponse(response.payload);

      expect(response.statusCode).toBe(400);
      expect(error.error.code).toBe("validation_error");
      expect(services.taskService.taskRepository.list()).toEqual([]);
    } finally {
      await closeApp(app);
    }
  });
});
