import { z } from "zod";

const idSchema = z.number().int();
const optionalStringSchema = z.string().optional();
const optionalIdSchema = idSchema.optional();
const optionalNumberSchema = z.number().optional();

export const platformLoginResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().int().positive(),
  scope: z.string().optional(),
  account_expires: z.number().optional()
}).passthrough();

export const universalFoldSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  parentId: optionalIdSchema
}).passthrough();

export const equipmentSingleRespSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  alias: optionalStringSchema,
  modelId: optionalIdSchema,
  model: optionalStringSchema,
  typeId: optionalIdSchema,
  type: optionalStringSchema,
  serialNumber: optionalStringSchema,
  templateId: optionalIdSchema,
  parentId: optionalIdSchema,
  mountEquipmentIds: z.array(idSchema).optional(),
  projectId: optionalIdSchema,
  project: optionalStringSchema,
  businessGroupingId: optionalIdSchema,
  businessGrouping: optionalStringSchema,
  buildingId: optionalIdSchema,
  building: optionalStringSchema
}).passthrough();

export const equipmentRespSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  alias: optionalStringSchema,
  serialNumber: optionalStringSchema,
  modelId: optionalIdSchema,
  model: optionalStringSchema,
  gatewayId: optionalIdSchema,
  gateway: optionalStringSchema,
  gatewayIot: optionalStringSchema,
  slave: optionalStringSchema,
  typeId: optionalIdSchema,
  rootTypeId: optionalIdSchema,
  type: optionalStringSchema,
  runStatus: z.number().int().optional(),
  version: optionalStringSchema,
  status: z.number().int().optional(),
  mounts: z.array(universalFoldSchema).optional(),
  virtual: optionalNumberSchema,
  virtualMeter: optionalNumberSchema,
  templateId: optionalIdSchema,
  template: optionalStringSchema,
  entityId: optionalIdSchema,
  entity: optionalStringSchema,
  projectId: optionalIdSchema,
  project: optionalStringSchema,
  businessGroupingId: optionalIdSchema,
  businessGrouping: optionalStringSchema,
  buildingId: optionalIdSchema,
  building: optionalStringSchema,
  parentId: optionalIdSchema,
  hasUnrecoveredAlarm: optionalNumberSchema,
  createTime: optionalStringSchema,
  modifyTime: optionalStringSchema,
  dataSourceEquipmentId: optionalIdSchema
}).passthrough();

export const pivotalParamConfigValueRespSchema = z.object({
  name: z.string().min(1),
  enName: optionalStringSchema,
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
  unit: optionalStringSchema,
  equipment: optionalStringSchema,
  equipmentId: optionalIdSchema,
  splitGroup: optionalStringSchema,
  splitGroupId: optionalIdSchema,
  splitGroupSort: optionalNumberSchema
}).passthrough();

export const universalFoldListSchema = z.array(universalFoldSchema);
export const equipmentSingleRespListSchema = z.array(equipmentSingleRespSchema);
export const pivotalParamConfigValueRespListSchema = z.array(pivotalParamConfigValueRespSchema);

export type PlatformLoginResponse = z.infer<typeof platformLoginResponseSchema>;
export type UniversalFold = z.infer<typeof universalFoldSchema>;
export type EquipmentSingleResp = z.infer<typeof equipmentSingleRespSchema>;
export type EquipmentResp = z.infer<typeof equipmentRespSchema>;
export type PivotalParamConfigValueResp = z.infer<typeof pivotalParamConfigValueRespSchema>;
