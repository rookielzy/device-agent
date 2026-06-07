import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { buildApp, type AppDependencies } from "./app.js";
import { createAgentInterpreter, type CreateAgentInterpreterOptions } from "./agent/agent-factory.js";
import type { AgentInterpreter } from "./agent/agent-interpreter.js";
import { parseEnv, type AppConfig } from "./config/env.js";
import { SimulatedDeviceService } from "./domain/devices/simulated-device-service.js";
import { TaskService } from "./domain/tasks/task-service.js";

export type RuntimeDependencyOverrides = {
  simulatedDeviceService?: SimulatedDeviceService;
  interpreter?: AgentInterpreter;
  agentInterpreterFactory?: (options: CreateAgentInterpreterOptions) => AgentInterpreter;
};

export type StartServerOptions = {
  env?: NodeJS.ProcessEnv;
  config?: AppConfig;
  app?: FastifyInstance;
  overrides?: RuntimeDependencyOverrides;
};

export function createRuntimeDependencies(config: AppConfig, overrides: RuntimeDependencyOverrides = {}): AppDependencies {
  const simulatedDeviceService = overrides.simulatedDeviceService ?? new SimulatedDeviceService();
  const interpreter =
    overrides.interpreter ??
    (overrides.agentInterpreterFactory ?? createAgentInterpreter)({
      config,
      deviceService: simulatedDeviceService
    });
  const taskService = new TaskService({
    interpreter,
    deviceService: simulatedDeviceService
  });

  return {
    simulatedDeviceService,
    taskService
  };
}

export async function startServer(options: StartServerOptions = {}): Promise<{
  app: FastifyInstance;
  address: string;
}> {
  const config = options.config ?? parseEnv(options.env);
  const app = options.app ?? buildApp({
    dependencies: createRuntimeDependencies(config, options.overrides)
  });
  const address = await app.listen({
    host: config.host,
    port: config.port
  });

  return {
    app,
    address
  };
}

async function main(): Promise<void> {
  try {
    const { address } = await startServer();
    process.stdout.write(`Device Agent API listening at ${address}\n`);
  } catch (error) {
    process.stderr.write(`${formatStartupError(error)}\n`);
    process.exitCode = 1;
  }
}

function formatStartupError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Device Agent API failed to start";
}

if (isDirectExecution()) {
  void main();
}

function isDirectExecution(): boolean {
  return process.argv[1] === fileURLToPath(import.meta.url);
}
