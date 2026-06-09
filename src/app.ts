import Fastify, {
  type FastifyError,
  type FastifyInstance,
  type FastifyServerOptions
} from "fastify";
import { ApiRequestValidationError, ApiResponseValidationError, createApiError } from "./contracts/api-contract.js";
import { createAgentInterpreter } from "./agent/agent-factory.js";
import type { AgentInterpreter } from "./agent/agent-interpreter.js";
import { SimulatedDeviceService } from "./domain/devices/simulated-device-service.js";
import { JavaPlatformClient } from "./domain/platform/java-platform-client.js";
import { PlatformCapabilityService } from "./domain/platform/platform-capability-service.js";
import { TaskService, type TaskServiceOptions } from "./domain/tasks/task-service.js";
import type { AppConfig } from "./config/env.js";
import { registerSimulatedDeviceRoutes } from "./routes/simulated-devices.js";
import { registerTaskRoutes } from "./routes/tasks.js";
import {
  noopTracer,
  runWithTraceContext,
  type Tracer
} from "./observability/trace.js";

const DEFAULT_BODY_LIMIT_BYTES = 16_384;
export type PlatformCapabilityServiceDependency = Pick<
  PlatformCapabilityService,
  "listProjectsOrAreas" | "searchDevices" | "getEquipmentDetail" | "getRuntimeParams" | "readAirConditionerStatus"
>;

export type AppDependencies = {
  taskService: TaskService;
  simulatedDeviceService: SimulatedDeviceService;
};

export type BuildAppOptions = {
  dependencies?: AppDependencies;
  config?: AppConfig;
  interpreter?: AgentInterpreter;
  simulatedDeviceService?: SimulatedDeviceService;
  platformCapabilityService?: PlatformCapabilityServiceDependency;
  agentInterpreterFactory?: typeof createAgentInterpreter;
  taskServiceOptions?: Omit<TaskServiceOptions, "interpreter" | "deviceService" | "tracer">;
  fastify?: FastifyServerOptions;
  exposeDebugRoutes?: boolean;
  tracer?: Tracer;
};

export function createAppDependencies(options: Omit<BuildAppOptions, "dependencies" | "fastify"> = {}): AppDependencies {
  const config = options.config;
  const tracer = options.tracer ?? noopTracer;
  const simulatedDeviceService = options.simulatedDeviceService ?? new SimulatedDeviceService({
    ...(options.taskServiceOptions?.clock ? { clock: options.taskServiceOptions.clock } : {})
  });
  const platformCapabilityService: PlatformCapabilityServiceDependency | undefined =
    options.platformCapabilityService ?? (config ? createPlatformCapabilityService(config, tracer) : undefined);
  const interpreter = options.interpreter ?? (options.agentInterpreterFactory ?? createAgentInterpreter)({
    config: requireConfig(config),
    deviceService: simulatedDeviceService,
    ...(platformCapabilityService ? { platformService: platformCapabilityService } : {}),
    tracer
  });
  const taskService = new TaskService({
    interpreter,
    deviceService: simulatedDeviceService,
    tracer,
    ...(options.taskServiceOptions ?? {})
  });

  return {
    taskService,
    simulatedDeviceService
  };
}

function createPlatformCapabilityService(config: AppConfig, tracer: Tracer): PlatformCapabilityService | undefined {
  if (config.deviceCapabilityMode !== "platform") {
    return undefined;
  }

  if (!config.platform) {
    throw new Error("Platform device capability mode requires parsed platform config");
  }

  return new PlatformCapabilityService({
    validationProjectId: config.platform.validationProjectId,
    client: new JavaPlatformClient({
      config: config.platform,
      tracer
    })
  });
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({
    bodyLimit: DEFAULT_BODY_LIMIT_BYTES,
    ...(options.fastify ?? {})
  });
  const dependencies = options.dependencies ?? createAppDependencies(options);
  const exposeDebugRoutes = options.exposeDebugRoutes ?? true;
  const tracer = options.tracer ?? noopTracer;

  app.addHook("onRequest", (request, _reply, done) => {
    const requestTracer = tracer.child({});

    runWithTraceContext(requestTracer.context, () => {
      requestTracer.emit("info", "http.fastify", "request.started", {
        method: request.method,
        url: request.url
      });
      requestTracer.payload("debug", "http.fastify", "request.input", {
        request: {
          method: request.method,
          url: request.url,
          headers: request.headers
        }
      });
      done();
    });
  });

  app.addHook("preHandler", (request, _reply, done) => {
    tracer.payload("debug", "http.fastify", "request.body", {
      request: {
        method: request.method,
        url: request.url,
        body: request.body
      }
    });
    done();
  });

  app.addHook("preSerialization", (_request, reply, payload, done) => {
    tracer.payload("debug", "http.fastify", "response.output", {
      response: {
        statusCode: reply.statusCode,
        payload
      }
    });
    done(null, payload);
  });

  app.addHook("onResponse", (request, reply, done) => {
    tracer.emit(reply.statusCode >= 500 ? "error" : "info", "http.fastify", "request.completed", {
      method: request.method,
      url: request.url,
      statusCode: reply.statusCode
    });
    done();
  });

  app.setErrorHandler((error, _request, reply) => {
    const shaped = shapeRouteError(error);
    tracer.emit("warn", "http.fastify", "request.failed", {
      statusCode: shaped.error.statusCode,
      code: shaped.error.code
    });
    tracer.payload("debug", "http.fastify", "error.output", {
      response: shaped
    });
    void reply.status(shaped.error.statusCode).send(shaped);
  });

  app.setNotFoundHandler((request, reply) => {
    const route = matchApiPath(request.url, { exposeDebugRoutes });
    const methodMismatch = route !== undefined;
    const statusCode = methodMismatch ? 405 : 404;
    const code = methodMismatch ? "method_not_allowed" : "not_found";
    if (route) {
      reply.header("Allow", route.allow.join(", "));
    }

    void reply.status(statusCode).send(createApiError({
      code,
      message: statusCode === 404 ? "Route not found." : "Method not allowed.",
      statusCode,
      details: {
        request: {
          method: request.method,
          route: route?.pattern ?? "unmatched"
        }
      }
    }));
  });

  app.register(registerTaskRoutes, { taskService: dependencies.taskService });
  if (exposeDebugRoutes) {
    app.register(registerSimulatedDeviceRoutes, { simulatedDeviceService: dependencies.simulatedDeviceService });
  }

  return app;
}

function requireConfig(config: AppConfig | undefined): AppConfig {
  if (!config) {
    throw new Error("buildApp requires config or injected dependencies when no interpreter is provided");
  }

  return config;
}

function shapeRouteError(error: unknown) {
  if (error instanceof ApiRequestValidationError) {
    return createApiError({
      code: "bad_request",
      message: error.message,
      statusCode: 400,
      details: error.details
    });
  }

  if (isFastifyValidationError(error)) {
    return createApiError({
      code: "bad_request",
      message: "Request validation failed.",
      statusCode: 400,
      details: {
        issues: error.validation
      }
    });
  }

  if (error instanceof ApiResponseValidationError || isZodError(error)) {
    return createApiError({
      code: "response_validation_failed",
      message: "Route response failed public contract validation.",
      statusCode: 500
    });
  }

  if (isClientHttpError(error)) {
    return createApiError({
      code: "bad_request",
      message: "Request validation failed.",
      statusCode: 400,
      details: {
        reason: "client_http_error"
      }
    });
  }

  return createApiError({
    code: "service_error",
    message: "The API could not complete the request.",
    statusCode: 500
  });
}

function isFastifyValidationError(error: unknown): error is FastifyError & { validation: unknown } {
  return typeof error === "object" && error !== null && "validation" in error;
}

function isZodError(error: unknown): error is { issues: Array<{ path: PropertyKey[]; message: string }> } {
  return (
    typeof error === "object" &&
    error !== null &&
    "issues" in error &&
    Array.isArray((error as { issues?: unknown }).issues)
  );
}

function isClientHttpError(error: unknown): error is { statusCode: number; message: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    typeof (error as { statusCode?: unknown }).statusCode === "number" &&
    (error as { statusCode: number }).statusCode >= 400 &&
    (error as { statusCode: number }).statusCode < 500 &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
  );
}

function matchApiPath(url: string, options: { exposeDebugRoutes: boolean }): { pattern: string; allow: string[] } | undefined {
  const path = url.split("?")[0] ?? url;

  if (path === "/tasks") {
    return { pattern: "/tasks", allow: ["POST"] };
  }

  if (options.exposeDebugRoutes && path === "/debug/simulated-devices") {
    return { pattern: "/debug/simulated-devices", allow: ["GET"] };
  }

  if (/^\/tasks\/[^/]+$/.test(path)) {
    return { pattern: "/tasks/:taskId", allow: ["GET"] };
  }

  if (/^\/tasks\/[^/]+\/(?:confirm|reject)$/.test(path)) {
    return { pattern: "/tasks/:taskId/confirm|reject", allow: ["POST"] };
  }

  return undefined;
}
