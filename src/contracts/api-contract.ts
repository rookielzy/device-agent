import { z, ZodError } from "zod";
import { simulatedDeviceContextSchema } from "./device-contract.js";
import {
  taskResultSchema,
  type TaskResult
} from "./task-contract.js";

export const TASK_TEXT_MAX_LENGTH = 2_000;

export const taskCreateRequestSchema = z
  .object({
    text: z.string().trim().min(1).max(TASK_TEXT_MAX_LENGTH)
  })
  .strict();

export const taskIdParamsSchema = z
  .object({
    taskId: z.string().trim().min(1)
  })
  .strict();

export const emptyBodySchema = z.object({}).strict();

export const apiErrorCodeSchema = z.enum([
  "validation_error",
  "not_found",
  "internal_error"
]);

export const apiErrorSchema = z
  .object({
    error: z
      .object({
        code: apiErrorCodeSchema,
        message: z.string().min(1),
        statusCode: z.number().int().min(400).max(599),
        details: z.array(z.string().min(1)).optional()
      })
      .strict()
  })
  .strict();

export const simulatedDeviceSnapshotResponseSchema = z
  .object({
    devices: z.array(simulatedDeviceContextSchema)
  })
  .strict();

export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;
export type SimulatedDeviceSnapshotResponse = z.infer<typeof simulatedDeviceSnapshotResponseSchema>;

export class ApiResponseValidationError extends Error {
  readonly statusCode = 500;
  readonly validationIssues: string[];

  constructor(publicShape: string, error: ZodError) {
    super(`${publicShape} response failed API contract validation`);
    this.name = "ApiResponseValidationError";
    this.validationIssues = formatZodIssues(error);
  }
}

export function makeApiError(input: {
  code: ApiErrorCode;
  message: string;
  statusCode: number;
  details?: string[];
}): ApiError {
  return apiErrorSchema.parse({
    error: {
      code: input.code,
      message: input.message,
      statusCode: input.statusCode,
      ...(input.details && input.details.length > 0 ? { details: input.details } : {})
    }
  });
}

export function parseTaskResultResponse(value: unknown): TaskResult {
  const parsed = taskResultSchema.safeParse(value);

  if (!parsed.success) {
    throw new ApiResponseValidationError("TaskResult", parsed.error);
  }

  return parsed.data;
}

export function parseSimulatedDeviceSnapshotResponse(devices: unknown): SimulatedDeviceSnapshotResponse {
  const parsed = simulatedDeviceSnapshotResponseSchema.safeParse({
    devices
  });

  if (!parsed.success) {
    throw new ApiResponseValidationError("SimulatedDeviceSnapshot", parsed.error);
  }

  return parsed.data;
}

export function formatZodIssues(error: ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.join(".");

    return path ? `${path}: ${issue.message}` : issue.message;
  });
}
