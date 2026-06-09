import { describe, expect, it } from "vitest";
import { LangChainDeepSeekInterpreter } from "../../src/agent/langchain-deepseek-interpreter.js";
import type { DeviceToolResult } from "../../src/agent/device-tools.js";
import { TaskService } from "../../src/domain/tasks/task-service.js";
import {
  createTracer,
  type TraceEvent
} from "../../src/observability/trace.js";
import {
  createFixedClock,
  createIdSequence,
  livingRoomStatusProposal
} from "../fixtures/task-fixtures.js";

type InvokableTool = {
  name: string;
  invoke(input: unknown): Promise<DeviceToolResult>;
};

describe("agent trace", () => {
  it("emits one correlated chain across task service, LangChain adapter, and device tools", async () => {
    const events: TraceEvent[] = [];
    const tracer = createTracer({
      enabled: true,
      sink: (event) => events.push(event),
      traceIdGenerator: () => "trace-001",
      clock: createFixedClock()
    });
    const interpreter = new LangChainDeepSeekInterpreter({
      apiKey: "test-key",
      model: "deepseek-test",
      tracer,
      agentFactory: (input) => ({
        async invoke() {
          const readStatus = input.tools.find((tool) => tool.name === "read_simulated_device_status") as InvokableTool;
          await readStatus.invoke({
            room: "living room",
            deviceType: "air_conditioner"
          });

          return {
            structuredResponse: livingRoomStatusProposal
          };
        }
      })
    });
    const service = new TaskService({
      interpreter,
      tracer,
      clock: createFixedClock(),
      taskIdGenerator: createIdSequence("task"),
      pendingControlIdGenerator: createIdSequence("pending"),
      timelineEventIdGenerator: createIdSequence("evt")
    });

    const originalText = "Is the living room air conditioner running?";

    const result = await service.createTask(originalText);

    expect(result.executionState).toBe("completed");

    const requestEvents = events.filter((event) => event.fields.taskId === "task-001");
    expect(new Set(requestEvents.map((event) => event.traceId))).toEqual(new Set(["trace-001"]));
    expect(requestEvents.map((event) => `${event.component}:${event.event}`)).toEqual(
      expect.arrayContaining([
        "domain.task_service:create_task.started",
        "agent.langchain_deepseek:interpret.started",
        "agent.langchain_deepseek:agent.invoke.started",
        "agent.tool.simulated_device:read_status.started",
        "agent.tool.simulated_device:read_status.completed",
        "agent.tool.simulated_device:read_status.succeeded",
        "agent.langchain_deepseek:agent.invoke.succeeded",
        "agent.langchain_deepseek:interpret.completed",
        "domain.task_service:interpreter.proposal_received",
        "domain.task_service:simulated_status.read_started",
        "domain.task_service:simulated_status.read_completed",
        "domain.task_service:task.saved",
        "domain.task_service:create_task.completed"
      ])
    );
    expect(requestEvents.find((event) => event.event === "interpret.started")?.fields).toMatchObject({
      originalTextLength: originalText.length
    });
    expect(requestEvents.find((event) => event.event === "read_status.completed")?.fields).toMatchObject({
      kind: "read_success",
      deviceId: "device-ac-living-room",
      dataItemCount: 4
    });
    expect(requestEvents.map((event) => event.event)).not.toContain("agent.invoke.input");
    expect(requestEvents.map((event) => event.event)).not.toContain("read_status.output");
  });

  it("emits full interface input and output only when payload tracing is enabled", async () => {
    const events: TraceEvent[] = [];
    const tracer = createTracer({
      enabled: true,
      includePayloads: true,
      sink: (event) => events.push(event),
      traceIdGenerator: () => "trace-001",
      clock: createFixedClock()
    });
    const interpreter = new LangChainDeepSeekInterpreter({
      apiKey: "test-key",
      model: "deepseek-test",
      tracer,
      agentFactory: (input) => ({
        async invoke() {
          const readStatus = input.tools.find((tool) => tool.name === "read_simulated_device_status") as InvokableTool;
          await readStatus.invoke({
            room: "living room",
            deviceType: "air_conditioner"
          });

          return {
            structuredResponse: livingRoomStatusProposal
          };
        }
      })
    });
    const service = new TaskService({
      interpreter,
      tracer,
      clock: createFixedClock(),
      taskIdGenerator: createIdSequence("task"),
      pendingControlIdGenerator: createIdSequence("pending"),
      timelineEventIdGenerator: createIdSequence("evt")
    });

    await service.createTask("Is the living room air conditioner running?");

    const requestEvents = events.filter((event) => event.fields.taskId === "task-001");
    expect(requestEvents.find((event) => event.event === "agent.invoke.input")?.fields).toMatchObject({
      input: {
        messages: [
          {
            role: "user",
            content: expect.stringContaining("Is the living room air conditioner running?")
          }
        ]
      }
    });
    expect(requestEvents.find((event) => event.event === "agent.invoke.output")?.fields).toMatchObject({
      output: {
        structuredResponse: livingRoomStatusProposal
      }
    });
    expect(requestEvents.find((event) => event.event === "read_status.input")?.fields).toMatchObject({
      input: {
        room: "living room",
        deviceType: "air_conditioner"
      }
    });
    expect(requestEvents.find((event) => event.event === "read_status.output")?.fields).toMatchObject({
      output: {
        ok: true,
        kind: "read_success"
      }
    });
  });

  it("redacts sensitive fields before writing trace events", () => {
    const events: TraceEvent[] = [];
    const tracer = createTracer({
      enabled: true,
      sink: (event) => events.push(event),
      traceIdGenerator: () => "trace-001",
      clock: createFixedClock()
    });

    tracer.emit("info", "test", "sensitive", {
      apiKey: "secret-key",
      nested: {
        password: "secret-password",
        value: "visible"
      }
    });

    expect(events[0]?.fields).toEqual({
      apiKey: "[redacted]",
      nested: {
        password: "[redacted]",
        value: "visible"
      }
    });
  });

  it("stays silent when explicitly disabled", () => {
    const events: TraceEvent[] = [];
    const tracer = createTracer({
      enabled: false,
      sink: (event) => events.push(event)
    });

    tracer.emit("info", "test", "silent");

    expect(tracer.enabled).toBe(false);
    expect(events).toEqual([]);
  });
});
