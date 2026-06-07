import { z } from "zod";
import {
  deviceTypeSchema,
  publicValueSchema,
  simulatedDeviceContextSchema
} from "../contracts/device-contract.js";

const deviceTargetSchema = z
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

const controlTargetSchema = z
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

export const agentProposalSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("status_query"),
      target: deviceTargetSchema,
      summary: z.string().min(1).optional(),
      confidence: z.number().min(0).max(1).optional()
    })
    .strict(),
  z
    .object({
      kind: z.literal("control_request"),
      target: controlTargetSchema,
      confirmationSummary: z.string().min(1).optional(),
      summary: z.string().min(1).optional(),
      confidence: z.number().min(0).max(1).optional()
    })
    .strict(),
  z
    .object({
      kind: z.literal("ambiguous"),
      reason: z.string().min(1),
      candidates: z.array(simulatedDeviceContextSchema).default([]),
      target: deviceTargetSchema.optional(),
      summary: z.string().min(1).optional(),
      confidence: z.number().min(0).max(1).optional()
    })
    .strict(),
  z
    .object({
      kind: z.literal("unsupported"),
      reason: z.string().min(1),
      target: deviceTargetSchema.optional(),
      summary: z.string().min(1).optional(),
      confidence: z.number().min(0).max(1).optional()
    })
    .strict(),
  z
    .object({
      kind: z.literal("parse_failure"),
      reason: z.string().min(1),
      detail: z.string().min(1).optional(),
      summary: z.string().min(1).optional(),
      confidence: z.number().min(0).max(1).optional()
    })
    .strict()
]);

export type AgentProposal = z.infer<typeof agentProposalSchema>;
export type AgentProposalKind = AgentProposal["kind"];

export type AgentInterpreterInput = {
  originalText: string;
};

export type AgentInterpreter = {
  interpret(input: AgentInterpreterInput): AgentProposal | Promise<AgentProposal>;
};

export function parseAgentProposal(value: unknown): AgentProposal {
  return agentProposalSchema.parse(value);
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
    target.capability,
    target.dataItem,
    target.controlItem,
    target.phrase
  ].some((value) => value !== undefined);
}
