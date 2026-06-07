import { z } from "zod";

export const deviceTypeSchema = z.enum([
  "light",
  "air_conditioner",
  "environment_sensor",
  "generic"
]);

export const valueFreshnessSchema = z.enum(["fresh", "stale", "unknown"]);

export const publicValueSchema = z.union([z.string(), z.number(), z.boolean()]);

const metadataBaseSchema = z.object({
  label: z.string().min(1),
  unit: z.string().min(1).optional(),
  description: z.string().min(1).optional()
}).strict();

export const booleanValueMetadataSchema = metadataBaseSchema.extend({
  kind: z.literal("boolean")
}).strict();

export const numberValueMetadataSchema = metadataBaseSchema.extend({
  kind: z.literal("number"),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().positive().optional()
}).strict();

export const stringValueMetadataSchema = metadataBaseSchema.extend({
  kind: z.literal("string")
}).strict();

export const enumValueMetadataSchema = metadataBaseSchema.extend({
  kind: z.literal("enum"),
  options: z.array(z.string().min(1)).min(1)
}).strict();

export const valueMetadataSchema = z.discriminatedUnion("kind", [
  booleanValueMetadataSchema,
  numberValueMetadataSchema,
  stringValueMetadataSchema,
  enumValueMetadataSchema
]);

export const deviceAvailabilitySchema = z.object({
  online: z.boolean(),
  reason: z.string().min(1).optional()
}).strict();

export const readableValueSchema = z.object({
  itemId: z.string().min(1),
  name: z.string().min(1),
  metadata: valueMetadataSchema,
  value: publicValueSchema.optional(),
  freshness: valueFreshnessSchema,
  observedAt: z.string().datetime({ offset: true }).optional()
}).strict();

export const writableControlSchema = z.object({
  controlId: z.string().min(1),
  name: z.string().min(1),
  metadata: valueMetadataSchema,
  currentValue: publicValueSchema.optional(),
  writable: z.literal(true)
}).strict();

export const simulatedDeviceContextSchema = z.object({
  deviceId: z.string().min(1),
  displayName: z.string().min(1),
  room: z.string().min(1),
  type: deviceTypeSchema,
  availability: deviceAvailabilitySchema,
  capabilities: z.array(z.string().min(1)).min(1),
  readableValues: z.array(readableValueSchema),
  writableControls: z.array(writableControlSchema)
}).strict();

export const selectedDataItemSchema = z.object({
  deviceId: z.string().min(1),
  itemId: z.string().min(1),
  name: z.string().min(1),
  value: publicValueSchema.optional(),
  metadata: valueMetadataSchema.optional(),
  freshness: valueFreshnessSchema.optional()
}).strict();

export const selectedControlItemSchema = z.object({
  deviceId: z.string().min(1),
  controlId: z.string().min(1),
  name: z.string().min(1),
  requestedValue: publicValueSchema,
  metadata: valueMetadataSchema.optional()
}).strict();

export const selectedDeviceContextSchema = z.object({
  devices: z.array(simulatedDeviceContextSchema),
  dataItems: z.array(selectedDataItemSchema).default([]),
  controlItems: z.array(selectedControlItemSchema).default([]),
  candidates: z.array(simulatedDeviceContextSchema).default([])
}).strict();

export type DeviceType = z.infer<typeof deviceTypeSchema>;
export type ValueFreshness = z.infer<typeof valueFreshnessSchema>;
export type PublicValue = z.infer<typeof publicValueSchema>;
export type ValueMetadata = z.infer<typeof valueMetadataSchema>;
export type ReadableValue = z.infer<typeof readableValueSchema>;
export type WritableControl = z.infer<typeof writableControlSchema>;
export type SimulatedDeviceContext = z.infer<typeof simulatedDeviceContextSchema>;
export type SelectedDataItem = z.infer<typeof selectedDataItemSchema>;
export type SelectedControlItem = z.infer<typeof selectedControlItemSchema>;
export type SelectedDeviceContext = z.infer<typeof selectedDeviceContextSchema>;
