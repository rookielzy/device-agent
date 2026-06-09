import type {
  DeviceType,
  PublicValue,
  ReadableValue,
  SelectedDataItem,
  SimulatedDeviceContext,
  ValueMetadata
} from "../../contracts/device-contract.js";
import type {
  EquipmentResp,
  EquipmentSingleResp,
  PivotalParamConfigValueResp
} from "../../contracts/platform-contract.js";

export type RuntimeFacts = {
  dataItems: SelectedDataItem[];
  readableValues: ReadableValue[];
  switchState?: {
    value: boolean;
    source: PivotalParamConfigValueResp;
  };
  returnAirTemperature?: {
    value: number;
    source: PivotalParamConfigValueResp;
  };
};

export function equipmentToDeviceContext(input: {
  equipment: EquipmentSingleResp | EquipmentResp;
  detail?: EquipmentResp;
  runtimeValues?: ReadableValue[];
}): SimulatedDeviceContext {
  const detail = input.detail;
  const availability = availabilityFromRunStatus(detail?.runStatus);

  return {
    deviceId: String(input.equipment.id),
    displayName: displayNameForEquipment(input.equipment),
    room: roomForEquipment(input.equipment),
    type: deviceTypeForEquipment(input.equipment),
    availability,
    capabilities: capabilitiesForEquipment(input.equipment, input.runtimeValues ?? []),
    readableValues: input.runtimeValues ?? [],
    writableControls: []
  };
}

export function runtimeFactsFor(equipmentId: string, params: PivotalParamConfigValueResp[]): RuntimeFacts {
  const readableValues = params.map((param) => pivotalParamToReadableValue(param));
  const switchParam = params.find(isSwitchParam);
  const returnAirParam = params.find(isReturnAirTemperatureParam);
  const switchState = switchParam ? booleanValueForParam(switchParam) : undefined;
  const returnAirTemperature = returnAirParam ? numberValueForParam(returnAirParam) : undefined;
  const dataItems: SelectedDataItem[] = readableValues.map((value) => ({
    deviceId: equipmentId,
    itemId: value.itemId,
    name: value.name,
    ...(value.value !== undefined ? { value: value.value } : {}),
    metadata: value.metadata,
    freshness: value.freshness
  }));

  return {
    dataItems,
    readableValues,
    ...(switchState !== undefined && switchParam ? { switchState: { value: switchState, source: switchParam } } : {}),
    ...(returnAirTemperature !== undefined && returnAirParam ? { returnAirTemperature: { value: returnAirTemperature, source: returnAirParam } } : {})
  };
}

export function hasAirConditionerText(equipment: EquipmentSingleResp | EquipmentResp): boolean {
  const text = searchableText(equipment);

  return /空调|air\s*condition|aircondition|ac\b|hvac/i.test(text);
}

export function equipmentMatchesConstraints(input: {
  equipment: EquipmentSingleResp;
  room?: string;
  floor?: string;
  deviceType?: DeviceType;
  projectName?: string;
}): boolean {
  const text = searchableText(input.equipment);

  if (input.projectName && !includesNormalized(text, input.projectName)) {
    return false;
  }

  if (input.room && !includesNormalized(text, input.room)) {
    return false;
  }

  if (input.floor && !includesNormalized(text, input.floor)) {
    return false;
  }

  if (input.deviceType === "air_conditioner" && !hasAirConditionerText(input.equipment)) {
    return false;
  }

  return true;
}

export function runStatusHint(runStatus: number | undefined): "unknown" | "offline" | "online" | "running" | "stopped" | undefined {
  switch (runStatus) {
    case -1:
      return "unknown";
    case 0:
      return "offline";
    case 1:
      return "online";
    case 2:
      return "running";
    case 3:
      return "stopped";
    default:
      return undefined;
  }
}

function pivotalParamToReadableValue(param: PivotalParamConfigValueResp): ReadableValue {
  const value = publicValueForParam(param);

  return {
    itemId: itemIdForParam(param),
    name: param.name,
    metadata: metadataForParam(param),
    ...(value !== undefined ? { value } : {}),
    freshness: "fresh"
  };
}

function publicValueForParam(param: PivotalParamConfigValueResp): PublicValue | undefined {
  if (isSwitchParam(param)) {
    return booleanValueForParam(param);
  }

  const numeric = numberValueForParam(param);
  if (numeric !== undefined) {
    return numeric;
  }

  const boolean = booleanValueForParam(param);
  if (boolean !== undefined) {
    return boolean;
  }

  if (param.value === undefined) {
    return undefined;
  }

  return param.value;
}

function metadataForParam(param: PivotalParamConfigValueResp): ValueMetadata {
  const value = param.value;
  const numeric = numberValueForParam(param);
  const boolean = booleanValueForParam(param);

  if (isSwitchParam(param) && boolean !== undefined) {
    return {
      kind: "boolean",
      label: param.name,
      ...(param.unit ? { unit: param.unit } : {})
    };
  }

  if (numeric !== undefined) {
    return {
      kind: "number",
      label: param.name,
      ...(param.unit ? { unit: param.unit } : {})
    };
  }

  if (boolean !== undefined) {
    return {
      kind: "boolean",
      label: param.name,
      ...(param.unit ? { unit: param.unit } : {})
    };
  }

  if (typeof value === "string") {
    return {
      kind: "string",
      label: param.name,
      ...(param.unit ? { unit: param.unit } : {})
    };
  }

  return {
    kind: "string",
    label: param.name,
    ...(param.unit ? { unit: param.unit } : {})
  };
}

function itemIdForParam(param: PivotalParamConfigValueResp): string {
  return normalizeText(param.enName || param.name).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || param.name;
}

function numberValueForParam(param: PivotalParamConfigValueResp): number | undefined {
  if (typeof param.value === "number") {
    return param.value;
  }

  if (typeof param.value !== "string") {
    return undefined;
  }

  const value = Number(param.value.trim());

  return Number.isFinite(value) ? value : undefined;
}

function booleanValueForParam(param: PivotalParamConfigValueResp): boolean | undefined {
  if (typeof param.value === "boolean") {
    return param.value;
  }

  if (typeof param.value === "number") {
    return param.value === 1 ? true : param.value === 0 ? false : undefined;
  }

  if (typeof param.value !== "string") {
    return undefined;
  }

  const value = param.value.trim().toLowerCase();
  if (["1", "true", "on", "open", "开启", "开", "运行", "运行中"].includes(value)) {
    return true;
  }

  if (["0", "false", "off", "close", "关闭", "关", "停止", "停机"].includes(value)) {
    return false;
  }

  return undefined;
}

function isSwitchParam(param: PivotalParamConfigValueResp): boolean {
  const text = normalizeText(`${param.name} ${param.enName ?? ""}`);

  return /switch|power|enable|onoff|on_off|startstop|start_stop|开关|启停|运行状态/.test(text);
}

export function isSwitchDataItem(item: SelectedDataItem): boolean {
  const text = normalizeText(`${item.itemId} ${item.name} ${item.metadata?.label ?? ""}`);

  return /switch|power|enable|onoff|on_off|startstop|start_stop|开关|启停|运行状态/.test(text);
}

export function isReturnAirTemperatureDataItem(item: SelectedDataItem): boolean {
  const text = normalizeText(`${item.itemId} ${item.name} ${item.metadata?.label ?? ""}`);

  return /returnair|return_air|returntemp|returntemperature|回风|回气/.test(text);
}

export function isSupplyAirTemperatureDataItem(item: SelectedDataItem): boolean {
  const text = normalizeText(`${item.itemId} ${item.name} ${item.metadata?.label ?? ""}`);

  return /supplyair|supply_air|supplytemp|supplytemperature|送风/.test(text);
}

function isReturnAirTemperatureParam(param: PivotalParamConfigValueResp): boolean {
  const text = normalizeText(`${param.name} ${param.enName ?? ""}`);

  if (!isTemperatureLike(param)) {
    return false;
  }

  return /returnair|return_air|return temp|回风|回气/.test(text);
}

function isTemperatureLike(param: PivotalParamConfigValueResp): boolean {
  const text = normalizeText(`${param.name} ${param.enName ?? ""} ${param.unit ?? ""}`);

  return /temp|temperature|温度|℃|celsius/.test(text);
}

function capabilitiesForEquipment(equipment: EquipmentSingleResp | EquipmentResp, runtimeValues: ReadableValue[]): string[] {
  const capabilities = new Set<string>(["platform_read"]);
  if (hasAirConditionerText(equipment)) {
    capabilities.add("read_air_conditioner_status");
  }
  for (const value of runtimeValues) {
    capabilities.add(`read_${value.itemId}`);
  }

  return [...capabilities];
}

function displayNameForEquipment(equipment: EquipmentSingleResp | EquipmentResp): string {
  return equipment.alias || equipment.name;
}

function roomForEquipment(equipment: EquipmentSingleResp | EquipmentResp): string {
  return equipment.alias || equipment.building || equipment.project || "unknown";
}

function deviceTypeForEquipment(equipment: EquipmentSingleResp | EquipmentResp): DeviceType {
  return hasAirConditionerText(equipment) ? "air_conditioner" : "generic";
}

function availabilityFromRunStatus(runStatus: number | undefined): SimulatedDeviceContext["availability"] {
  const hint = runStatusHint(runStatus);

  if (hint === "offline") {
    return {
      online: false,
      reason: "Platform reports the device is offline"
    };
  }

  if (hint === "unknown") {
    return {
      online: false,
      reason: "Platform reports an unknown runtime status"
    };
  }

  return {
    online: true
  };
}

function searchableText(equipment: EquipmentSingleResp | EquipmentResp): string {
  return normalizeText([
    equipment.name,
    equipment.alias,
    equipment.type,
    equipment.model,
    equipment.project,
    equipment.building,
    equipment.businessGrouping
  ].filter(Boolean).join(" "));
}

function includesNormalized(haystack: string, needle: string): boolean {
  return haystack.includes(normalizeText(needle));
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, "");
}
