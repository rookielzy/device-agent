import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import {
  buildApp,
  createAppDependencies,
  type AppDependencies,
  type PlatformCapabilityServiceDependency
} from "./app.js";
import { createAgentInterpreter, type CreateAgentInterpreterOptions } from "./agent/agent-factory.js";
import type { AgentInterpreter } from "./agent/agent-interpreter.js";
import { parseEnv, type AppConfig } from "./config/env.js";
import { SimulatedDeviceService } from "./domain/devices/simulated-device-service.js";

export type RuntimeDependencyOverrides = {
  simulatedDeviceService?: SimulatedDeviceService;
  platformCapabilityService?: PlatformCapabilityServiceDependency;
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
  return createAppDependencies({
    config,
    ...(overrides.simulatedDeviceService ? { simulatedDeviceService: overrides.simulatedDeviceService } : {}),
    ...(overrides.platformCapabilityService ? { platformCapabilityService: overrides.platformCapabilityService } : {}),
    ...(overrides.interpreter ? { interpreter: overrides.interpreter } : {}),
    agentInterpreterFactory: overrides.agentInterpreterFactory ?? createAgentInterpreter
  });
}

export async function startServer(options: StartServerOptions = {}): Promise<{
  app: FastifyInstance;
  address: string;
}> {
  const config = options.config ?? parseEnv(options.env);
  const app = options.app ?? buildApp({
    dependencies: createRuntimeDependencies(config, options.overrides),
    exposeDebugRoutes: shouldExposeDebugRoutes(config)
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

export function shouldExposeDebugRoutes(config: AppConfig): boolean {
  return config.enableDebugSimulatedDevices || config.host === "127.0.0.1" || config.host === "localhost";
}

if (isDirectExecution()) {
  void main();
}

export function isDirectExecutionPath(argvPath: string | undefined, moduleUrl: string): boolean {
  return argvPath !== undefined && resolve(argvPath) === fileURLToPath(moduleUrl);
}

function isDirectExecution(): boolean {
  return isDirectExecutionPath(process.argv[1], import.meta.url);
}
