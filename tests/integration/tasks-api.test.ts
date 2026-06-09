import { describe, expect, it } from "vitest";
import { apiErrorSchema } from "../../src/contracts/api-contract.js";
import { taskResultSchema, type TaskResult } from "../../src/contracts/task-contract.js";
import {
  hallwayLightOnProposal,
  invalidHallwayControlProposal,
  livingRoomStatusProposal,
  parseFailureProposal,
  readOnlySensorControlProposal,
  vagueBedroomStatusProposal
} from "../fixtures/task-fixtures.js";
import { createTestApi } from "./api-test-helpers.js";
import { createTracer, type TraceEvent } from "../../src/observability/trace.js";

const forbiddenProviderFields = [
  "tool_calls",
  "run_id",
  "provider_metadata",
  "raw provider",
  "DeepSeek"
];

describe("Task HTTP API", () => {
  it("traces HTTP request and response payloads when payload tracing is enabled", async () => {
    const events: TraceEvent[] = [];
    const tracer = createTracer({
      enabled: true,
      includePayloads: true,
      sink: (event) => events.push(event),
      traceIdGenerator: () => "trace-http-001"
    });
    const api = createTestApi([livingRoomStatusProposal], { tracer });

    try {
      const response = await api.app.inject({
        method: "POST",
        url: "/tasks",
        payload: { text: "Is the living room air conditioner running?" }
      });

      expect(response.statusCode).toBe(201);
      expect(events.find((event) => event.event === "request.body")?.fields).toMatchObject({
        request: {
          method: "POST",
          url: "/tasks",
          body: {
            text: "Is the living room air conditioner running?"
          }
        }
      });
      expect(events.find((event) => event.event === "response.output")?.fields).toMatchObject({
        response: {
          statusCode: 201,
          payload: {
            taskId: "task-001",
            executionState: "completed"
          }
        }
      });
      expect(events.find((event) => event.event === "request.completed")?.fields).toMatchObject({
        method: "POST",
        url: "/tasks",
        statusCode: 201
      });
    } finally {
      await api.app.close();
    }
  });

  it("creates and inspects a completed air-conditioner status task", async () => {
    const api = createTestApi([livingRoomStatusProposal]);

    try {
      const createdResponse = await api.app.inject({
        method: "POST",
        url: "/tasks",
        payload: { text: "Is the living room air conditioner running?" }
      });
      const created = taskResultSchema.parse(createdResponse.json<TaskResult>());
      const inspectedResponse = await api.app.inject({
        method: "GET",
        url: `/tasks/${created.taskId}`
      });

      expect(createdResponse.statusCode).toBe(201);
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
      expect(inspectedResponse.statusCode).toBe(200);
      expect(taskResultSchema.parse(inspectedResponse.json())).toEqual(created);
    } finally {
      await api.app.close();
    }
  });

  it("returns task-shaped ambiguous and parse-failure outcomes", async () => {
    const api = createTestApi([vagueBedroomStatusProposal, parseFailureProposal]);

    try {
      const ambiguousResponse = await api.app.inject({
        method: "POST",
        url: "/tasks",
        payload: { text: "What is the bedroom device doing?" }
      });
      const parseFailureResponse = await api.app.inject({
        method: "POST",
        url: "/tasks",
        payload: { text: "Blue banana entropy please" }
      });
      const ambiguous = taskResultSchema.parse(ambiguousResponse.json<TaskResult>());
      const parseFailure = taskResultSchema.parse(parseFailureResponse.json<TaskResult>());

      expect(ambiguousResponse.statusCode).toBe(201);
      expect(ambiguous.executionState).toBe("needs_clarification");
      expect(ambiguous.outcomeReason).toBe("ambiguous_target");
      expect(ambiguous.selectedContext.candidates.map((device) => device.deviceId)).toEqual([
        "device-sensor-bedroom",
        "device-light-bedroom"
      ]);
      expect(ambiguous.pendingControl).toBeUndefined();

      expect(parseFailureResponse.statusCode).toBe(201);
      expect(parseFailure.executionState).toBe("failed");
      expect(parseFailure.outcomeReason).toBe("parse_failure");
      expectProviderNeutral(parseFailure);
    } finally {
      await api.app.close();
    }
  });

  it("returns schema-valid pending and unsupported control outcomes without provider fields", async () => {
    const api = createTestApi([
      hallwayLightOnProposal,
      readOnlySensorControlProposal,
      invalidHallwayControlProposal
    ]);

    try {
      const pendingResponse = await api.app.inject({
        method: "POST",
        url: "/tasks",
        payload: { text: "Turn on the hallway light" }
      });
      const response = await api.app.inject({
        method: "POST",
        url: "/tasks",
        payload: { text: "Set the bedroom sensor temperature to 19" }
      });
      const invalidResponse = await api.app.inject({
        method: "POST",
        url: "/tasks",
        payload: { text: "Turn on the hallway light" }
      });
      const pending = taskResultSchema.parse(pendingResponse.json<TaskResult>());
      const result = taskResultSchema.parse(response.json<TaskResult>());
      const invalid = taskResultSchema.parse(invalidResponse.json<TaskResult>());
      const inspected = await api.app.inject({
        method: "GET",
        url: `/tasks/${result.taskId}`
      });

      expect(pendingResponse.statusCode).toBe(201);
      expect(pending.executionState).toBe("pending_confirmation");
      expect(pending.pendingControl?.target.controlId).toBe("power");
      expect(pending.timeline.map((event) => event.stage)).toContain("confirmation_required");
      expect(pending.timeline.map((event) => event.stage)).not.toContain("simulated_execution");
      expectProviderNeutral(pending);

      expect(response.statusCode).toBe(201);
      expect(result.executionState).toBe("unavailable");
      expect(result.outcomeReason).toBe("read_only_control");
      expect(result.pendingControl).toBeUndefined();
      expect(result.timeline.map((event) => event.stage)).not.toContain("simulated_execution");
      expectProviderNeutral(result);
      expect(taskResultSchema.parse(inspected.json())).toEqual(result);

      expect(invalidResponse.statusCode).toBe(201);
      expect(invalid.executionState).toBe("failed");
      expect(invalid.outcomeReason).toBe("invalid_control_value");
      expect(invalid.pendingControl).toBeUndefined();
      expect(invalid.timeline.map((event) => event.stage)).not.toContain("simulated_execution");
      expectProviderNeutral(invalid);
    } finally {
      await api.app.close();
    }
  });

  it("returns ApiError for malformed bodies and unknown task inspection", async () => {
    const api = createTestApi([livingRoomStatusProposal]);

    try {
      const missingBody = await api.app.inject({
        method: "POST",
        url: "/tasks"
      });
      const wrongBody = await api.app.inject({
        method: "POST",
        url: "/tasks",
        payload: "not-json-object",
        headers: {
          "content-type": "application/json"
        }
      });
      const unknownTask = await api.app.inject({
        method: "GET",
        url: "/tasks/task-missing"
      });
      const tooLongText = await api.app.inject({
        method: "POST",
        url: "/tasks",
        payload: { text: "x".repeat(4_001) }
      });
      const oversizedBody = await api.app.inject({
        method: "POST",
        url: "/tasks",
        payload: { text: "x".repeat(20_000) }
      });

      expect(missingBody.statusCode).toBe(400);
      expect(wrongBody.statusCode).toBe(400);
      expect(unknownTask.statusCode).toBe(404);
      expect(tooLongText.statusCode).toBe(400);
      expect(oversizedBody.statusCode).toBe(400);
      expect(apiErrorSchema.safeParse(missingBody.json()).success).toBe(true);
      expect(apiErrorSchema.safeParse(wrongBody.json()).success).toBe(true);
      expect(apiErrorSchema.safeParse(tooLongText.json()).success).toBe(true);
      expect(apiErrorSchema.safeParse(oversizedBody.json()).success).toBe(true);
      expect(apiErrorSchema.parse(unknownTask.json()).error).toMatchObject({
        code: "not_found",
        statusCode: 404,
        details: {
          resource: {
            type: "task"
          }
        }
      });
      expect(JSON.stringify(unknownTask.json())).not.toContain("task-missing");
      expect(api.taskService.taskRepository.list()).toEqual([]);
    } finally {
      await api.app.close();
    }
  });

  it("returns ApiError for unknown routes and task route method mismatches", async () => {
    const api = createTestApi([]);

    try {
      const unknownRoute = await api.app.inject({
        method: "GET",
        url: "/not-a-route"
      });
      const methodMismatch = await api.app.inject({
        method: "DELETE",
        url: "/tasks/task-001"
      });

      expect(unknownRoute.statusCode).toBe(404);
      expect(apiErrorSchema.parse(unknownRoute.json()).error).toMatchObject({
        code: "not_found",
        statusCode: 404,
        details: {
          request: {
            method: "GET",
            route: "unmatched"
          }
        }
      });
      expect(methodMismatch.statusCode).toBe(405);
      expect(methodMismatch.headers.allow).toBe("GET");
      expect(apiErrorSchema.parse(methodMismatch.json()).error).toMatchObject({
        code: "method_not_allowed",
        statusCode: 405,
        details: {
          request: {
            method: "DELETE",
            route: "/tasks/:taskId"
          }
        }
      });
      expect(api.taskService.taskRepository.list()).toEqual([]);
    } finally {
      await api.app.close();
    }
  });
});

function expectProviderNeutral(value: unknown): void {
  const serialized = JSON.stringify(value);

  for (const field of forbiddenProviderFields) {
    expect(serialized).not.toContain(field);
  }
}
