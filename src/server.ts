import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance, FastifyServerOptions } from "fastify";
import {
  createAgentInterpreter,
  type CreateAgentInterpreterOptions
} from "./agent/agent-factory.js";
import { buildApp, buildServices, type AppServices } from "./app.js";
import { parseEnv, type AppConfig } from "./config/env.js";
import { SimulatedDeviceService } from "./domain/devices/simulated-device-service.js";

export type CreateRuntimeAppOptions = {
  env?: NodeJS.ProcessEnv;
  config?: AppConfig;
  logger?: FastifyServerOptions["logger"];
  deepseekAgent?: CreateAgentInterpreterOptions["deepseekAgent"];
  deepseekAgentFactory?: CreateAgentInterpreterOptions["deepseekAgentFactory"];
};

export type StartServerOptions = CreateRuntimeAppOptions & {
  runtime?: RuntimeApp;
};

export type RuntimeApp = {
  app: FastifyInstance;
  config: AppConfig;
  services: AppServices;
};

export type StartedServer = RuntimeApp & {
  address: string;
};

export async function startServer(options: StartServerOptions = {}): Promise<StartedServer> {
  const runtime = options.runtime ?? createRuntimeApp({
    ...options,
    logger: options.logger ?? true
  });
  const address = await runtime.app.listen({
    host: runtime.config.host,
    port: runtime.config.port
  });

  runtime.app.log.info({ address }, "Device Agent API listening");

  return {
    ...runtime,
    address
  };
}

export function createRuntimeApp(options: CreateRuntimeAppOptions = {}): RuntimeApp {
  const config = options.config ?? parseEnv(options.env);
  const deviceService = new SimulatedDeviceService();
  const interpreter = createAgentInterpreter({
    config,
    deviceService,
    ...(options.deepseekAgent ? { deepseekAgent: options.deepseekAgent } : {}),
    ...(options.deepseekAgentFactory ? { deepseekAgentFactory: options.deepseekAgentFactory } : {})
  });
  const services = buildServices({
    interpreter,
    deviceService
  });
  const app = options.logger === undefined
    ? buildApp({ services })
    : buildApp({
        services,
        logger: options.logger
      });

  return {
    app,
    config,
    services
  };
}

async function main(): Promise<void> {
  try {
    await startServer();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

if (isEntrypoint()) {
  void main();
}

function isEntrypoint(): boolean {
  const scriptPath = process.argv[1];

  if (!scriptPath) {
    return false;
  }

  return fileURLToPath(import.meta.url) === resolve(scriptPath);
}
