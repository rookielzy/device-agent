import fastify, {
  type FastifyInstance,
  type FastifyServerOptions
} from "fastify";
import { ZodError } from "zod";
import { type AgentInterpreter } from "./agent/agent-interpreter.js";
import {
  ApiResponseValidationError,
  formatZodIssues,
  makeApiError
} from "./contracts/api-contract.js";
import { SimulatedDeviceService } from "./domain/devices/simulated-device-service.js";
import { TaskService, type TaskServiceOptions } from "./domain/tasks/task-service.js";
import { registerSimulatedDeviceRoutes } from "./routes/simulated-devices.js";
import { registerTaskRoutes } from "./routes/tasks.js";

export type AppServices = {
  taskService: TaskService;
  deviceService: SimulatedDeviceService;
};

export type BuildServicesOptions = {
  interpreter: AgentInterpreter;
  deviceService?: SimulatedDeviceService;
} & Omit<TaskServiceOptions, "interpreter" | "deviceService">;

export type BuildAppOptions =
  | {
      services: AppServices;
      logger?: FastifyServerOptions["logger"];
    }
  | ({
      logger?: FastifyServerOptions["logger"];
    } & BuildServicesOptions);

export function buildServices(options: BuildServicesOptions): AppServices {
  const deviceService =
    options.deviceService ??
    new SimulatedDeviceService({
      ...(options.clock ? { clock: options.clock } : {})
    });
  const taskService = new TaskService({
    interpreter: options.interpreter,
    deviceService,
    ...(options.taskRepository ? { taskRepository: options.taskRepository } : {}),
    ...(options.pendingControlRepository ? { pendingControlRepository: options.pendingControlRepository } : {}),
    ...(options.clock ? { clock: options.clock } : {}),
    ...(options.taskIdGenerator ? { taskIdGenerator: options.taskIdGenerator } : {}),
    ...(options.pendingControlIdGenerator ? { pendingControlIdGenerator: options.pendingControlIdGenerator } : {}),
    ...(options.timelineEventIdGenerator ? { timelineEventIdGenerator: options.timelineEventIdGenerator } : {}),
    ...(options.pendingControlTtlMs !== undefined ? { pendingControlTtlMs: options.pendingControlTtlMs } : {})
  });

  return {
    taskService,
    deviceService
  };
}

export function buildApp(options: BuildAppOptions): FastifyInstance {
  const services = "services" in options ? options.services : buildServices(options);
  const app = fastify({
    logger: options.logger ?? false
  });

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send(
      makeApiError({
        code: "not_found",
        message: `No route found for ${request.method} ${request.url}`,
        statusCode: 404
      })
    );
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ApiResponseValidationError) {
      reply.status(500).send(
        makeApiError({
          code: "internal_error",
          message: "API response failed contract validation",
          statusCode: 500
        })
      );
      return;
    }

    if (error instanceof ZodError) {
      reply.status(400).send(
        makeApiError({
          code: "validation_error",
          message: "Request failed validation",
          statusCode: 400,
          details: formatZodIssues(error)
        })
      );
      return;
    }

    const statusCode = statusCodeFromError(error);
    const isClientError = statusCode >= 400 && statusCode < 500;

    reply.status(statusCode).send(
      makeApiError({
        code: isClientError ? "validation_error" : "internal_error",
        message: isClientError && error instanceof Error ? error.message : "Unexpected API error",
        statusCode
      })
    );
  });

  registerTaskRoutes(app, {
    taskService: services.taskService
  });
  registerSimulatedDeviceRoutes(app, {
    deviceService: services.deviceService
  });

  return app;
}

function statusCodeFromError(error: unknown): number {
  if (typeof error !== "object" || error === null || !("statusCode" in error)) {
    return 500;
  }

  const statusCode = (error as { statusCode?: unknown }).statusCode;

  return typeof statusCode === "number" && statusCode >= 400 ? statusCode : 500;
}
