import { describe, expect, it, vi } from "vitest";
import { apiErrorSchema } from "../../src/contracts/api-contract.js";
import { taskResultSchema, type TaskResult } from "../../src/contracts/task-contract.js";
import { buildApp } from "../../src/app.js";
import { createTestApi } from "./api-test-helpers.js";
import { livingRoomStatusProposal } from "../fixtures/task-fixtures.js";

describe("Fastify app construction", () => {
  it("builds an injectable app without reading env or listening on import", async () => {
    const api = createTestApi([livingRoomStatusProposal]);
    const listenSpy = vi.spyOn(api.app, "listen");

    try {
      const response = await api.app.inject({
        method: "POST",
        url: "/tasks",
        payload: { text: "Is the living room air conditioner running?" }
      });

      expect(listenSpy).not.toHaveBeenCalled();
      expect(response.statusCode).toBe(201);
      expect(taskResultSchema.safeParse(response.json<TaskResult>()).success).toBe(true);
    } finally {
      listenSpy.mockRestore();
      await api.app.close();
    }
  });

  it("normalizes invalid bodies, unknown routes, and method mismatches into ApiError", async () => {
    const api = createTestApi([livingRoomStatusProposal]);

    try {
      const invalidBody = await api.app.inject({
        method: "POST",
        url: "/tasks",
        payload: { text: "" }
      });
      const unknownRoute = await api.app.inject({
        method: "GET",
        url: "/missing"
      });
      const methodMismatch = await api.app.inject({
        method: "PUT",
        url: "/tasks/task-001"
      });

      expect(invalidBody.statusCode).toBe(400);
      expect(unknownRoute.statusCode).toBe(404);
      expect(methodMismatch.statusCode).toBe(405);
      expect(methodMismatch.headers.allow).toBe("GET");
      expect(apiErrorSchema.safeParse(invalidBody.json()).success).toBe(true);
      expect(apiErrorSchema.safeParse(unknownRoute.json()).success).toBe(true);
      expect(apiErrorSchema.safeParse(methodMismatch.json()).success).toBe(true);
      expect(apiErrorSchema.parse(methodMismatch.json()).error.details).toMatchObject({
        request: {
          method: "PUT",
          route: "/tasks/:taskId"
        }
      });
      expect(api.taskService.taskRepository.list()).toEqual([]);
    } finally {
      await api.app.close();
    }
  });

  it("converts invalid task-route responses into an internal ApiError", async () => {
    const app = buildApp({
      dependencies: {
        taskService: {
          createTask: async () => ({ taskId: "" }),
          getTask: () => ({ ok: false, reason: "task_not_found" }),
          confirmTask: () => ({ taskId: "" }),
          rejectTask: () => ({ taskId: "" })
        } as never,
        simulatedDeviceService: {
          debugSnapshot: () => []
        } as never
      }
    });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/tasks",
        payload: { text: "anything" }
      });

      expect(response.statusCode).toBe(500);
      expect(apiErrorSchema.parse(response.json()).error.code).toBe("response_validation_failed");
    } finally {
      await app.close();
    }
  });

  it("converts invalid debug responses and unexpected route errors into internal ApiError", async () => {
    const invalidDebugApp = buildApp({
      dependencies: {
        taskService: {
          createTask: async () => ({ taskId: "" }),
          getTask: () => ({ ok: false, reason: "task_not_found" }),
          confirmTask: () => ({ taskId: "" }),
          rejectTask: () => ({ taskId: "" })
        } as never,
        simulatedDeviceService: {
          debugSnapshot: () => [{ deviceId: "" }]
        } as never
      }
    });
    const throwingApp = buildApp({
      dependencies: {
        taskService: {
          createTask: async () => {
            throw new Error("raw secret from service");
          },
          getTask: () => ({ ok: false, reason: "task_not_found" }),
          confirmTask: () => ({ taskId: "" }),
          rejectTask: () => ({ taskId: "" })
        } as never,
        simulatedDeviceService: {
          debugSnapshot: () => []
        } as never
      }
    });

    try {
      const invalidDebug = await invalidDebugApp.inject({
        method: "GET",
        url: "/debug/simulated-devices"
      });
      const unexpected = await throwingApp.inject({
        method: "POST",
        url: "/tasks",
        payload: { text: "anything" }
      });

      expect(invalidDebug.statusCode).toBe(500);
      expect(apiErrorSchema.parse(invalidDebug.json()).error.code).toBe("response_validation_failed");
      expect(unexpected.statusCode).toBe(500);
      expect(apiErrorSchema.parse(unexpected.json()).error).toMatchObject({
        code: "service_error",
        statusCode: 500
      });
      expect(JSON.stringify(unexpected.json())).not.toContain("raw secret");
    } finally {
      await invalidDebugApp.close();
      await throwingApp.close();
    }
  });
});
