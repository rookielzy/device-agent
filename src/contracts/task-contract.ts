import { z } from "zod";
import {
  publicValueSchema,
  selectedControlItemSchema,
  selectedDataItemSchema,
  selectedDeviceContextSchema
} from "./device-contract.js";

export const taskClassificationSchema = z.enum([
  "status_query",
  "control_request",
  "ambiguous",
  "unsupported"
]);

export const executionStateSchema = z.enum([
  "completed",
  "pending_confirmation",
  "needs_clarification",
  "unavailable",
  "rejected",
  "failed"
]);

export const timelineStageSchema = z.enum([
  "request_received",
  "model_interpretation",
  "service_validation",
  "device_resolution",
  "simulated_read",
  "confirmation_required",
  "confirmation_received",
  "simulated_execution",
  "final_outcome"
]);

export const timelineSourceSchema = z.enum([
  "client",
  "model",
  "service",
  "simulated_device"
]);

export const timelineStatusSchema = z.enum([
  "started",
  "succeeded",
  "waiting",
  "blocked",
  "failed"
]);

export const planStepSchema = z.object({
  stepId: z.string().min(1),
  description: z.string().min(1),
  status: z.enum(["planned", "completed", "skipped", "blocked"])
}).strict();

export const structuredPlanSchema = z.object({
  summary: z.string().min(1),
  steps: z.array(planStepSchema).min(1),
  confidence: z.number().min(0).max(1),
  ambiguityReason: z.string().min(1).optional()
}).strict();

export const pendingControlSchema = z.object({
  pendingControlId: z.string().min(1),
  target: selectedControlItemSchema,
  confirmationSummary: z.string().min(1),
  expectedEffect: z.string().min(1),
  expiresAt: z.string().datetime({ offset: true }).optional()
}).strict();

export const timelineEventSchema = z.object({
  eventId: z.string().min(1),
  stage: timelineStageSchema,
  source: timelineSourceSchema,
  status: timelineStatusSchema,
  at: z.string().datetime({ offset: true }),
  detail: z.string().min(1)
}).strict();

export const taskResultSchema = z
  .object({
    taskId: z.string().min(1),
    originalText: z.string().min(1),
    classification: taskClassificationSchema,
    executionState: executionStateSchema,
    reply: z.string().min(1),
    userReply: z.string().min(1).optional(),
    plan: structuredPlanSchema,
    selectedContext: selectedDeviceContextSchema,
    selectedDataItems: z.array(selectedDataItemSchema).default([]),
    selectedControlItems: z.array(selectedControlItemSchema).default([]),
    pendingControl: pendingControlSchema.optional(),
    timeline: z.array(timelineEventSchema).min(1)
  })
  .strict()
  .superRefine((taskResult, ctx) => {
    if (taskResult.executionState === "pending_confirmation") {
      if (taskResult.classification !== "control_request") {
        ctx.addIssue({
          code: "custom",
          path: ["classification"],
          message: "pending_confirmation requires control_request classification"
        });
      }

      if (!taskResult.pendingControl) {
        ctx.addIssue({
          code: "custom",
          path: ["pendingControl"],
          message: "pending_confirmation requires pendingControl"
        });
      }
    }

    if (taskResult.pendingControl && taskResult.executionState !== "pending_confirmation") {
      ctx.addIssue({
        code: "custom",
        path: ["pendingControl"],
        message: "pendingControl is only valid while executionState is pending_confirmation"
      });
    }

    if (taskResult.pendingControl && taskResult.classification !== "control_request") {
      ctx.addIssue({
        code: "custom",
        path: ["classification"],
        message: "pendingControl requires control_request classification"
      });
    }
  });

export type TaskClassification = z.infer<typeof taskClassificationSchema>;
export type ExecutionState = z.infer<typeof executionStateSchema>;
export type TimelineStage = z.infer<typeof timelineStageSchema>;
export type TimelineEvent = z.infer<typeof timelineEventSchema>;
export type StructuredPlan = z.infer<typeof structuredPlanSchema>;
export type PendingControl = z.infer<typeof pendingControlSchema>;
export type TaskResult = z.infer<typeof taskResultSchema>;
