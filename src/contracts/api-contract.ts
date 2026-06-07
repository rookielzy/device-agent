import { z } from "zod";

export const createTaskBodySchema = z.object({
  text: z.string().trim().min(1)
}).strict();

export const taskIdParamsSchema = z.object({
  taskId: z.string().trim().min(1)
}).strict();

export const apiErrorCodeSchema = z.enum([
  "bad_request",
  "not_found",
  "method_not_allowed",
  "response_validation_failed",
  "service_error"
]);

export const apiErrorSchema = z.object({
  error: z.object({
    code: apiErrorCodeSchema,
    message: z.string().min(1),
    statusCode: z.number().int().min(400).max(599),
    details: z.unknown().optional()
  }).strict()
}).strict();

export type CreateTaskBody = z.infer<typeof createTaskBodySchema>;
export type TaskIdParams = z.infer<typeof taskIdParamsSchema>;
export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;

export class ApiRequestValidationError extends Error {
  readonly details: unknown;

  constructor(message: string, details?: unknown) {
    super(message);
    this.name = "ApiRequestValidationError";
    this.details = details;
  }
}

export function createApiError(input: {
  code: ApiErrorCode;
  message: string;
  statusCode: number;
  details?: unknown;
}): ApiError {
  return apiErrorSchema.parse({
    error: {
      code: input.code,
      message: input.message,
      statusCode: input.statusCode,
      ...(input.details === undefined ? {} : { details: input.details })
    }
  });
}

export function parseCreateTaskBody(value: unknown): CreateTaskBody {
  const parsed = createTaskBodySchema.safeParse(value);

  if (!parsed.success) {
    throw new ApiRequestValidationError("Request validation failed.", parsed.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message
    })));
  }

  return parsed.data;
}

export function parseTaskIdParams(value: unknown): TaskIdParams {
  const parsed = taskIdParamsSchema.safeParse(value);

  if (!parsed.success) {
    throw new ApiRequestValidationError("Request validation failed.", parsed.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message
    })));
  }

  return parsed.data;
}
