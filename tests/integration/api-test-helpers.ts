import type { FastifyInstance } from "fastify";
import type { AgentInterpreter, AgentProposal } from "../../src/agent/agent-interpreter.js";
import { buildApp } from "../../src/app.js";
import { SimulatedDeviceService } from "../../src/domain/devices/simulated-device-service.js";
import { TaskService } from "../../src/domain/tasks/task-service.js";
import {
  createFixedClock,
  createIdSequence,
  createSequenceInterpreter
} from "../fixtures/task-fixtures.js";
import type { Clock } from "../../src/domain/tasks/task-types.js";

export type TestApi = {
  app: FastifyInstance;
  taskService: TaskService;
  simulatedDeviceService: SimulatedDeviceService;
  interpreter: AgentInterpreter;
};

export function createTestApi(proposals: AgentProposal[], options: {
  clock?: Clock;
  pendingControlTtlMs?: number;
} = {}): TestApi {
  const interpreter = createSequenceInterpreter(proposals);
  const clock = options.clock ?? createFixedClock();
  const simulatedDeviceService = new SimulatedDeviceService({ clock });
  const taskService = new TaskService({
    interpreter,
    deviceService: simulatedDeviceService,
    clock,
    taskIdGenerator: createIdSequence("task"),
    pendingControlIdGenerator: createIdSequence("pending"),
    timelineEventIdGenerator: createIdSequence("evt"),
    ...(options.pendingControlTtlMs !== undefined ? { pendingControlTtlMs: options.pendingControlTtlMs } : {})
  });
  const app = buildApp({
    dependencies: {
      taskService,
      simulatedDeviceService
    }
  });

  return {
    app,
    taskService,
    simulatedDeviceService,
    interpreter
  };
}

export async function closeTestApi(api: Pick<TestApi, "app">): Promise<void> {
  await api.app.close();
}
