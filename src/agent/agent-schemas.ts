import { z } from "zod";
import {
  deviceTypeSchema,
  publicValueSchema,
  selectedDataItemSchema,
  simulatedDeviceContextSchema
} from "../contracts/device-contract.js";
import type { ControlTarget, DeviceTarget } from "../domain/devices/device-types.js";

export const deviceTargetSchema = z
  .object({
    deviceId: z.string().min(1).optional(),
    room: z.string().min(1).optional(),
    deviceName: z.string().min(1).optional(),
    deviceType: deviceTypeSchema.optional(),
    capability: z.string().min(1).optional(),
    dataItem: z.string().min(1).optional(),
    controlItem: z.string().min(1).optional(),
    phrase: z.string().min(1).optional()
  })
  .strict()
  .refine(hasDeviceSelector, {
    message: "proposal target must include at least one selector"
  });

export const controlTargetSchema = z
  .object({
    deviceId: z.string().min(1).optional(),
    room: z.string().min(1).optional(),
    deviceName: z.string().min(1).optional(),
    deviceType: deviceTypeSchema.optional(),
    capability: z.string().min(1).optional(),
    dataItem: z.string().min(1).optional(),
    controlItem: z.string().min(1).optional(),
    phrase: z.string().min(1).optional(),
    requestedValue: publicValueSchema
  })
  .strict()
  .refine(hasDeviceSelector, {
    message: "control proposal target must include at least one device selector"
  });

export const statusQueryProposalSchema = z
  .object({
    kind: z.literal("status_query"),
    target: deviceTargetSchema,
    summary: z.string().min(1).optional(),
    confidence: z.number().min(0).max(1).optional()
  })
  .strict()
  .superRefine((proposal, ctx) => {
    if (proposal.target.controlItem !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["target", "controlItem"],
        message: "status proposal target must not include a control item"
      });
    }
  });

export const controlRequestProposalSchema = z
  .object({
    kind: z.literal("control_request"),
    target: controlTargetSchema,
    confirmationSummary: z.string().min(1).optional(),
    summary: z.string().min(1).optional(),
    confidence: z.number().min(0).max(1).optional()
  })
  .strict()
  .superRefine((proposal, ctx) => {
    if (proposal.target.dataItem !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["target", "dataItem"],
        message: "control proposal target must not include a readable data item"
      });
    }

    if (
      proposal.target.controlItem === undefined &&
      proposal.target.capability === undefined &&
      proposal.target.phrase === undefined
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["target"],
        message: "control proposal target must include a control item, capability, or phrase"
      });
    }
  });

export const ambiguousProposalSchema = z
  .object({
    kind: z.literal("ambiguous"),
    reason: z.string().min(1),
    candidates: z.array(simulatedDeviceContextSchema).default([]),
    target: deviceTargetSchema.optional(),
    summary: z.string().min(1).optional(),
    confidence: z.number().min(0).max(1).optional()
  })
  .strict();

export const unsupportedProposalSchema = z
  .object({
    kind: z.literal("unsupported"),
    reason: z.string().min(1),
    target: deviceTargetSchema.optional(),
    summary: z.string().min(1).optional(),
    confidence: z.number().min(0).max(1).optional()
  })
  .strict();

export const parseFailureProposalSchema = z
  .object({
    kind: z.literal("parse_failure"),
    reason: z.string().min(1),
    detail: z.string().min(1).optional(),
    summary: z.string().min(1).optional(),
    confidence: z.number().min(0).max(1).optional()
  })
  .strict();

const platformUnavailableReasonSchema = z.enum([
  "platform_auth_failed",
  "platform_timeout",
  "platform_error",
  "platform_no_data",
  "device_not_found",
  "device_offline",
  "metadata_unrecognized"
]);

const platformFailureStageSchema = z.enum([
  "platform_auth",
  "platform_search",
  "platform_detail",
  "platform_runtime_read"
]);

const platformStatusSuccessResultSchema = z.object({
  kind: z.literal("platform_status_success"),
  device: simulatedDeviceContextSchema,
  dataItems: z.array(selectedDataItemSchema).default([]),
  switchState: z.boolean().optional(),
  returnAirTemperature: z.number().optional(),
  runStatusHint: z.enum(["unknown", "offline", "online", "running", "stopped"]).optional()
}).strict();

const platformStatusAmbiguousResultSchema = z.object({
  kind: z.literal("ambiguous"),
  reason: z.literal("ambiguous_target"),
  candidates: z.array(simulatedDeviceContextSchema).default([]),
  stage: z.literal("platform_search").default("platform_search")
}).strict();

const platformStatusUnavailableResultSchema = z.object({
  kind: z.literal("unavailable"),
  reason: platformUnavailableReasonSchema,
  device: simulatedDeviceContextSchema.optional(),
  candidates: z.array(simulatedDeviceContextSchema).default([]),
  stage: platformFailureStageSchema
}).strict();

export const platformStatusResultSchema = z.discriminatedUnion("kind", [
  platformStatusSuccessResultSchema,
  platformStatusAmbiguousResultSchema,
  platformStatusUnavailableResultSchema
]);

export const platformStatusProposalSchema = z
  .object({
    kind: z.literal("platform_status_query"),
    result: platformStatusResultSchema,
    summary: z.string().min(1).optional(),
    confidence: z.number().min(0).max(1).optional()
  })
  .strict();

export const agentProposalSchema = z.discriminatedUnion("kind", [
  statusQueryProposalSchema,
  controlRequestProposalSchema,
  ambiguousProposalSchema,
  unsupportedProposalSchema,
  parseFailureProposalSchema,
  platformStatusProposalSchema
]);

export type AgentProposal = z.infer<typeof agentProposalSchema>;
export type AgentProposalKind = AgentProposal["kind"];
export type DeviceProposalTarget = z.infer<typeof deviceTargetSchema>;
export type ControlProposalTarget = z.infer<typeof controlTargetSchema>;

export function parseAgentProposal(value: unknown): AgentProposal {
  return agentProposalSchema.parse(value);
}

export function toDeviceTarget(target: DeviceProposalTarget): DeviceTarget {
  return {
    ...(target.deviceId !== undefined ? { deviceId: target.deviceId } : {}),
    ...(target.room !== undefined ? { room: target.room } : {}),
    ...(target.deviceName !== undefined ? { deviceName: target.deviceName } : {}),
    ...(target.deviceType !== undefined ? { deviceType: target.deviceType } : {}),
    ...(target.capability !== undefined ? { capability: target.capability } : {}),
    ...(target.dataItem !== undefined ? { dataItem: target.dataItem } : {}),
    ...(target.controlItem !== undefined ? { controlItem: target.controlItem } : {}),
    ...(target.phrase !== undefined ? { phrase: target.phrase } : {})
  };
}

export function toControlTarget(target: ControlProposalTarget): ControlTarget {
  return {
    ...toDeviceTarget(target),
    requestedValue: target.requestedValue
  };
}

function hasDeviceSelector(target: {
  deviceId?: string | undefined;
  room?: string | undefined;
  deviceName?: string | undefined;
  deviceType?: string | undefined;
  capability?: string | undefined;
  dataItem?: string | undefined;
  controlItem?: string | undefined;
  phrase?: string | undefined;
}): boolean {
  return [
    target.deviceId,
    target.room,
    target.deviceName,
    target.deviceType,
    target.phrase
  ].some((value) => value !== undefined);
}
