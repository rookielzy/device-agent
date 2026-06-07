import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { taskResultSchema } from "../contracts/task-contract.js";
import {
  createApiError,
  parseCreateTaskBody,
  parseTaskIdParams,
  type ApiError
} from "../contracts/api-contract.js";
import type { TaskService } from "../domain/tasks/task-service.js";
import type { TaskResult } from "../contracts/task-contract.js";

export class ResponseValidationError extends Error {
  constructor() {
    super("Route response failed public contract validation");
    this.name = "ResponseValidationError";
  }
}

export type TaskRoutesOptions = {
  taskService: TaskService;
};

export const registerTaskRoutes: FastifyPluginAsync<TaskRoutesOptions> = async (app, options) => {
  app.post("/tasks", async (request, reply) => {
    const body = parseCreateTaskBody(request.body);
    const result = await options.taskService.createTask(body.text);

    return sendTaskResult(reply.status(201), result);
  });

  app.get("/tasks/:taskId", async (request, reply) => {
    const params = parseTaskIdParams(request.params);
    const stored = options.taskService.getTask(params.taskId);

    if (!stored.ok) {
      return reply.status(404).send(taskNotFound(params.taskId));
    }

    return sendTaskResult(reply, stored.task);
  });

  app.post("/tasks/:taskId/confirm", async (request, reply) => {
    const params = parseTaskIdParams(request.params);

    return sendTaskResult(reply, options.taskService.confirmTask(params.taskId));
  });

  app.post("/tasks/:taskId/reject", async (request, reply) => {
    const params = parseTaskIdParams(request.params);

    return sendTaskResult(reply, options.taskService.rejectTask(params.taskId));
  });
};

function sendTaskResult(reply: FastifyReply, result: TaskResult) {
  const parsed = taskResultSchema.safeParse(result);

  if (!parsed.success) {
    throw new ResponseValidationError();
  }

  return reply.send(parsed.data);
}

function taskNotFound(taskId: string): ApiError {
  return createApiError({
    code: "not_found",
    message: "Task not found.",
    statusCode: 404,
    details: { taskId }
  });
}
