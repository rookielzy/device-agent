import type { FastifyInstance } from "fastify";
import { buildApp, type AppServices } from "../../src/app.js";
import type { AgentInterpreter, AgentProposal } from "../../src/agent/agent-interpreter.js";
import { apiErrorSchema, type ApiError } from "../../src/contracts/api-contract.js";
import {
  simulatedDeviceContextSchema,
  type SimulatedDeviceContext
} from "../../src/contracts/device-contract.js";
import {
  taskResultSchema,
  type TaskResult
} from "../../src/contracts/task-contract.js";
import { SimulatedDeviceService } from "../../src/domain/devices/simulated-device-service.js";
import { TaskService } from "../../src/domain/tasks/task-service.js";
import {
  createFixedClock,
  createIdSequence,
  createSequenceInterpreter,
  fixedNow
} from "../fixtures/task-fixtures.js";

export type TestApp = {
  app: FastifyInstance;
  services: AppServices;
  interpreter: AgentInterpreter;
};

export function createApiTestApp(options: {
  proposals?: AgentProposal[];
  interpreter?: AgentInterpreter;
  now?: Date;
  clock?: () => Date;
  pendingControlTtlMs?: number;
} = {}): TestApp {
  const clock = options.clock ?? createFixedClock(options.now ?? fixedNow);
  const deviceService = new SimulatedDeviceService({
    clock
  });
  const interpreter = options.interpreter ?? createSequenceInterpreter(options.proposals ?? []);
  const taskService = new TaskService({
    interpreter,
    deviceService,
    clock,
    taskIdGenerator: createIdSequence("task"),
    pendingControlIdGenerator: createIdSequence("pending"),
    timelineEventIdGenerator: createIdSequence("evt"),
    ...(options.pendingControlTtlMs !== undefined ? { pendingControlTtlMs: options.pendingControlTtlMs } : {})
  });
  const services = {
    taskService,
    deviceService
  };
  const app = buildApp({
    services
  });

  return {
    app,
    services,
    interpreter
  };
}

export async function closeApp(app: FastifyInstance): Promise<void> {
  await app.close();
}

export function parseTaskResponse(payload: string): TaskResult {
  return taskResultSchema.parse(JSON.parse(payload));
}

export function parseApiErrorResponse(payload: string): ApiError {
  return apiErrorSchema.parse(JSON.parse(payload));
}

export function parseDebugDeviceResponse(payload: string): SimulatedDeviceContext[] {
  const parsed = JSON.parse(payload) as unknown;

  if (!isRecord(parsed) || !Array.isArray(parsed.devices)) {
    throw new Error("Debug response did not contain devices array");
  }

  return parsed.devices.map((device) => simulatedDeviceContextSchema.parse(device));
}

export function hallwayPowerFromDebug(devices: SimulatedDeviceContext[]): boolean | undefined {
  const value = devices
    .find((device) => device.deviceId === "device-light-hallway")
    ?.readableValues.find((item) => item.itemId === "power")?.value;

  if (value === undefined || typeof value === "boolean") {
    return value;
  }

  throw new Error(`Expected hallway power debug value to be boolean, received ${typeof value}`);
}

export function kitchenLightFromDebug(devices: SimulatedDeviceContext[]): SimulatedDeviceContext | undefined {
  return devices.find((device) => device.deviceId === "device-light-kitchen");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
