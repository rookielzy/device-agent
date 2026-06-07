import { describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import {
  ApiResponseValidationError,
  parseTaskResultResponse
} from "../../src/contracts/api-contract.js";
import { taskResultSchema } from "../../src/contracts/task-contract.js";
import {
  livingRoomStatusProposal
} from "../fixtures/task-fixtures.js";
import {
  closeApp,
  createApiTestApp,
  parseApiErrorResponse,
  parseTaskResponse
} from "./api-test-helpers.js";

describe("Fastify app construction and transport errors", () => {
  it("builds an injectable app without listening or reading DeepSeek credentials", async () => {
    const { app } = createApiTestApp({
      proposals: [livingRoomStatusProposal]
    });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/tasks",
        payload: {
          text: "Is the living room air conditioner running?"
        }
      });

      expect(response.statusCode).toBe(201);
      expect(parseTaskResponse(response.payload).taskId).toBe("task-001");
    } finally {
      await closeApp(app);
    }
  });

  it("allows callers to inject a fixed task service and shared device service", async () => {
    const { app, services } = createApiTestApp({
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
      const stored = services.taskService.getTask(created.taskId);

      expect(stored.ok).toBe(true);
      expect(services.deviceService.debugSnapshot()).toEqual(expect.any(Array));
      if (stored.ok) {
        expect(stored.task).toEqual(created);
      }
    } finally {
      await closeApp(app);
    }
  });

  it("normalizes malformed bodies, bad params, method mismatch, and unknown routes as ApiError", async () => {
    const { app } = createApiTestApp();

    try {
      const malformedBody = await app.inject({
        method: "POST",
        url: "/tasks",
        payload: {
          text: ""
        }
      });
      const missingBody = await app.inject({
        method: "POST",
        url: "/tasks"
      });
      const nonObjectBody = await app.inject({
        method: "POST",
        url: "/tasks",
        payload: "just text"
      });
      const badParam = await app.inject({
        method: "GET",
        url: "/tasks/%20"
      });
      const methodMismatch = await app.inject({
        method: "PUT",
        url: "/tasks/task-001"
      });
      const unknownRoute = await app.inject({
        method: "GET",
        url: "/missing"
      });

      for (const response of [malformedBody, missingBody, badParam]) {
        const parsed = parseApiErrorResponse(response.payload);
        expect(response.statusCode).toBe(400);
        expect(parsed.error.code).toBe("validation_error");
      }

      const nonObjectBodyError = parseApiErrorResponse(nonObjectBody.payload);
      expect(nonObjectBody.statusCode).toBe(415);
      expect(nonObjectBodyError.error.code).toBe("validation_error");

      for (const response of [methodMismatch, unknownRoute]) {
        const parsed = parseApiErrorResponse(response.payload);
        expect(response.statusCode).toBe(404);
        expect(parsed.error.code).toBe("not_found");
      }
    } finally {
      await closeApp(app);
    }
  });

  it("classifies invalid task-shaped responses before they can leak as public payloads", async () => {
    const { services } = createApiTestApp({
      proposals: [livingRoomStatusProposal]
    });
    const validTask = await services.taskService.createTask("Is the living room air conditioner running?");

    expect(() =>
      parseTaskResultResponse({
        ...validTask,
        providerMetadata: {
          leaked: true
        }
      })
    ).toThrow(ApiResponseValidationError);
  });

  it("converts unexpected route errors into internal ApiError without leaking messages", async () => {
    const { app } = createApiTestApp();
    app.get("/test/unexpected-error", async () => {
      throw new Error("raw provider payload tool_calls request-id-123");
    });

    try {
      const response = await app.inject({
        method: "GET",
        url: "/test/unexpected-error"
      });
      const parsed = parseApiErrorResponse(response.payload);

      expect(response.statusCode).toBe(500);
      expect(parsed.error.code).toBe("internal_error");
      expect(parsed.error.message).toBe("Unexpected API error");
      expect(JSON.stringify(parsed)).not.toContain("tool_calls");
      expect(JSON.stringify(parsed)).not.toContain("request-id-123");
    } finally {
      await closeApp(app);
    }
  });

  it("can be constructed directly from an interpreter without app-level side effects", async () => {
    const app = buildApp({
      interpreter: {
        interpret: () => livingRoomStatusProposal
      },
      taskIdGenerator: () => "direct-task",
      pendingControlIdGenerator: () => "direct-pending",
      timelineEventIdGenerator: () => "direct-event"
    });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/tasks",
        payload: {
          text: "Is the living room air conditioner running?"
        }
      });

      expect(taskResultSchema.safeParse(JSON.parse(response.payload)).success).toBe(true);
    } finally {
      await closeApp(app);
    }
  });
});
