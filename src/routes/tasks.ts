import type { FastifyInstance } from "fastify";
import {
  emptyBodySchema,
  makeApiError,
  parseTaskResultResponse,
  taskCreateRequestSchema,
  taskIdParamsSchema
} from "../contracts/api-contract.js";
import type { TaskResult } from "../contracts/task-contract.js";
import type { TaskService } from "../domain/tasks/task-service.js";

export type RegisterTaskRoutesOptions = {
  taskService: TaskService;
};

export function registerTaskRoutes(app: FastifyInstance, options: RegisterTaskRoutesOptions): void {
  app.post("/tasks", async (request, reply) => {
    const body = taskCreateRequestSchema.parse(request.body);
    const result = await options.taskService.createTask(body.text);

    reply.status(201).send(validateTaskResponse(result));
  });

  app.get("/tasks/:taskId", async (request, reply) => {
    const params = taskIdParamsSchema.parse(request.params);
    const stored = options.taskService.getTask(params.taskId);

    if (!stored.ok) {
      reply.status(404).send(
        makeApiError({
          code: "not_found",
          message: `Task ${params.taskId} was not found`,
          statusCode: 404
        })
      );
      return;
    }

    reply.send(validateTaskResponse(stored.task));
  });

  app.post("/tasks/:taskId/confirm", async (request, reply) => {
    const params = taskIdParamsSchema.parse(request.params);
    emptyBodySchema.parse(request.body ?? {});

    reply.send(validateTaskResponse(options.taskService.confirmTask(params.taskId)));
  });

  app.post("/tasks/:taskId/reject", async (request, reply) => {
    const params = taskIdParamsSchema.parse(request.params);
    emptyBodySchema.parse(request.body ?? {});

    reply.send(validateTaskResponse(options.taskService.rejectTask(params.taskId)));
  });
}

function validateTaskResponse(result: TaskResult): TaskResult {
  return parseTaskResultResponse(result);
}
