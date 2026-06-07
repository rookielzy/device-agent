import type {
  PublicValue,
  SelectedControlItem,
  SelectedDataItem,
  SimulatedDeviceContext,
  ValueMetadata
} from "../../contracts/device-contract.js";
import type {
  AmbiguousResult,
  NotFoundResult,
  UnsupportedResult
} from "./device-results.js";
import type { ControlTarget, DeviceTarget } from "./device-types.js";

export type DeviceResolution =
  | {
      kind: "resolved";
      device: SimulatedDeviceContext;
      dataItems: SelectedDataItem[];
      controlItem?: SelectedControlItem;
    }
  | AmbiguousResult
  | NotFoundResult
  | UnsupportedResult;

type NormalizedTarget = DeviceTarget & {
  tokens: string[];
};

const typeSynonyms: Record<SimulatedDeviceContext["type"], string[]> = {
  air_conditioner: ["air conditioner", "ac", "aircon", "conditioner"],
  environment_sensor: ["environment sensor", "sensor", "temperature sensor", "humidity sensor"],
  generic: ["device"],
  light: ["light", "lamp"]
};

const capabilitySynonyms: Record<string, string[]> = {
  humidity: ["humidity", "humid"],
  mode: ["mode", "cooling", "heating", "fan", "dry"],
  power: ["power", "on", "off", "running", "turn", "switch"],
  room_temperature: ["room temperature", "current temperature", "temperature now"],
  target_temperature: ["target temperature", "set temperature", "temperature", "cooler", "warmer"],
  temperature: ["temperature", "temp"]
};

const controlSynonyms: Record<string, string[]> = {
  mode: capabilitySynonyms.mode!,
  power: capabilitySynonyms.power!,
  target_temperature: capabilitySynonyms.target_temperature!
};

export class DeviceResolver {
  resolveRead(devices: SimulatedDeviceContext[], target: DeviceTarget): DeviceResolution {
    const normalizedTarget = normalizeTarget(target);
    const deviceResolution = this.#resolveDevice(devices, normalizedTarget);

    if (deviceResolution.kind !== "resolved") {
      return deviceResolution;
    }

    const selectedDataItems = selectReadableItems(deviceResolution.device, normalizedTarget);

    if (selectedDataItems.length === 0) {
      return {
        kind: "unsupported",
        reason: "readable_item_not_found",
        device: deviceResolution.device,
        message: `No readable value matches the requested status on ${deviceResolution.device.displayName}.`
      };
    }

    return {
      kind: "resolved",
      device: deviceResolution.device,
      dataItems: selectedDataItems
    };
  }

  resolveControl(devices: SimulatedDeviceContext[], target: ControlTarget): DeviceResolution {
    const normalizedTarget = normalizeTarget(target);
    const deviceResolution = this.#resolveDevice(devices, normalizedTarget);

    if (deviceResolution.kind !== "resolved") {
      return deviceResolution;
    }

    const selectedControl = selectWritableControl(deviceResolution.device, normalizedTarget, target.requestedValue);

    if (!selectedControl) {
      const hasReadOnlyMatch = hasReadableMatch(deviceResolution.device, normalizedTarget);

      return {
        kind: "unsupported",
        reason: hasReadOnlyMatch ? "read_only" : "control_item_not_found",
        device: deviceResolution.device,
        message: hasReadOnlyMatch
          ? `${deviceResolution.device.displayName} exposes that value as read-only.`
          : `No writable control matches the requested action on ${deviceResolution.device.displayName}.`
      };
    }

    return {
      kind: "resolved",
      device: deviceResolution.device,
      dataItems: [],
      controlItem: selectedControl
    };
  }

  #resolveDevice(
    devices: SimulatedDeviceContext[],
    target: NormalizedTarget
  ):
    | {
        kind: "resolved";
        device: SimulatedDeviceContext;
      }
    | AmbiguousResult
    | NotFoundResult {
    if (target.deviceId) {
      const byId = devices.find((device) => device.deviceId === target.deviceId);

      if (!byId) {
        return notFound(`No simulated device found for ${target.deviceId}.`);
      }

      return {
        kind: "resolved",
        device: byId
      };
    }

    let candidates = devices;
    let narrowedByDeviceReference = false;

    if (target.room) {
      const requestedRoom = normalizeText(target.room);
      candidates = candidates.filter((device) => normalizeText(device.room) === requestedRoom);
      narrowedByDeviceReference = true;
    } else {
      const rooms = new Set(devices.map((device) => normalizeText(device.room)));
      const matchedRoom = [...rooms].find((room) => containsTokenPhrase(target.tokens, room));

      if (matchedRoom) {
        candidates = candidates.filter((device) => normalizeText(device.room) === matchedRoom);
        narrowedByDeviceReference = true;
      }
    }

    const explicitType = target.deviceType ?? detectDeviceType(target.tokens);
    if (explicitType) {
      candidates = candidates.filter((device) => device.type === explicitType);
      narrowedByDeviceReference = true;
    }

    if (target.deviceName) {
      const normalizedName = normalizeText(target.deviceName);
      candidates = candidates.filter((device) => normalizeText(device.displayName).includes(normalizedName));
      narrowedByDeviceReference = true;
    }

    if (candidates.length === 0) {
      const fallbackByName = devices.filter((device) => target.tokens.some((token) => isConcreteDeviceToken(device, token)));

      if (fallbackByName.length === 1) {
        return {
          kind: "resolved",
          device: fallbackByName[0]!
        };
      }

      if (fallbackByName.length > 1) {
        return ambiguous(fallbackByName);
      }

      return notFound("No simulated device matches the requested reference.");
    }

    if (!narrowedByDeviceReference) {
      const fallbackByName = devices.filter((device) => target.tokens.some((token) => isConcreteDeviceToken(device, token)));

      if (fallbackByName.length === 1) {
        return {
          kind: "resolved",
          device: fallbackByName[0]!
        };
      }

      if (fallbackByName.length > 1) {
        return ambiguous(fallbackByName);
      }

      return notFound("No simulated device matches the requested reference.");
    }

    if (candidates.length === 1) {
      return {
        kind: "resolved",
        device: candidates[0]!
      };
    }

    const capability = normalizeDeviceFilteringCapability(target);
    if (capability) {
      const capabilityMatches = candidates.filter((device) => deviceMatchesCapability(device, capability));

      if (capabilityMatches.length === 1) {
        return {
          kind: "resolved",
          device: capabilityMatches[0]!
        };
      }

      if (capabilityMatches.length > 1 && explicitType) {
        return ambiguous(capabilityMatches);
      }
    }

    const nameMatches = candidates.filter((device) => displayNameTokens(device).some((token) => target.tokens.includes(token)));

    if (nameMatches.length === 1) {
      return {
        kind: "resolved",
        device: nameMatches[0]!
      };
    }

    return ambiguous(candidates);
  }
}

export function resolveBooleanFromPhrase(phrase: string | undefined): PublicValue | undefined {
  if (!phrase) {
    return undefined;
  }

  const normalized = normalizeText(phrase);

  if (/\b(on|enable|enabled|start|turn on)\b/.test(normalized)) {
    return true;
  }

  if (/\b(off|disable|disabled|stop|turn off)\b/.test(normalized)) {
    return false;
  }

  return undefined;
}

function selectReadableItems(device: SimulatedDeviceContext, target: NormalizedTarget): SelectedDataItem[] {
  const capability = normalizeReadCapability(target);
  let readableValues = device.readableValues;

  if (target.dataItem) {
    const requestedDataItem = normalizeText(target.dataItem);
    readableValues = readableValues.filter((item) => itemMatches(item.itemId, item.name, requestedDataItem));
  } else if (capability && !isWholeDeviceStatusRead(device, target)) {
    readableValues = readableValues.filter((item) => readableMatchesCapability(item.itemId, item.name, capability));
  } else if (device.type === "air_conditioner") {
    readableValues = device.readableValues;
  } else {
    const tokenMatches = readableValues.filter((item) =>
      target.tokens.some((token) => itemMatches(item.itemId, item.name, token))
    );
    readableValues = tokenMatches.length > 0 ? tokenMatches : readableValues;
  }

  return readableValues.map((item) => ({
    deviceId: device.deviceId,
    itemId: item.itemId,
    name: item.name,
    ...(item.value === undefined ? {} : { value: item.value }),
    metadata: cloneMetadata(item.metadata),
    freshness: item.freshness
  }));
}

function selectWritableControl(
  device: SimulatedDeviceContext,
  target: NormalizedTarget,
  requestedValue: PublicValue
): SelectedControlItem | undefined {
  const capability = normalizeControlCapability(target);
  let writableControls = device.writableControls;

  if (target.controlItem) {
    const requestedControl = normalizeText(target.controlItem);
    writableControls = writableControls.filter((control) => itemMatches(control.controlId, control.name, requestedControl));
  } else if (capability) {
    writableControls = writableControls.filter((control) => controlMatchesCapability(control.controlId, control.name, capability));
  }

  if (writableControls.length !== 1) {
    return undefined;
  }

  const control = writableControls[0]!;

  return {
    deviceId: device.deviceId,
    controlId: control.controlId,
    name: control.name,
    requestedValue,
    metadata: cloneMetadata(control.metadata)
  };
}

function cloneMetadata(metadata: ValueMetadata): ValueMetadata {
  return structuredClone(metadata);
}

function hasReadableMatch(device: SimulatedDeviceContext, target: NormalizedTarget): boolean {
  if (target.controlItem) {
    const requestedControl = normalizeText(target.controlItem);

    return device.readableValues.some((item) => itemMatches(item.itemId, item.name, requestedControl));
  }

  return selectReadableItems(device, target).length > 0;
}

function normalizeTarget(target: DeviceTarget): NormalizedTarget {
  const phrases = [
    target.phrase,
    target.room,
    target.deviceName,
    target.capability,
    target.dataItem,
    target.controlItem
  ].filter((value): value is string => Boolean(value));

  return {
    ...target,
    tokens: tokenize(phrases.join(" "))
  };
}

function normalizeReadCapability(target: NormalizedTarget): string | undefined {
  const explicit = target.dataItem ?? target.capability;

  if (explicit) {
    return normalizeText(explicit);
  }

  return findSynonymKey(capabilitySynonyms, target.tokens);
}

function normalizeDeviceFilteringCapability(target: NormalizedTarget): string | undefined {
  const explicit = target.dataItem ?? target.controlItem ?? target.capability;

  if (explicit) {
    return normalizeText(explicit);
  }

  return undefined;
}

function normalizeControlCapability(target: NormalizedTarget): string | undefined {
  const explicit = target.controlItem ?? target.capability;

  if (explicit) {
    return normalizeText(explicit);
  }

  return findSynonymKey(controlSynonyms, target.tokens);
}

function deviceMatchesCapability(device: SimulatedDeviceContext, capability: string): boolean {
  return (
    device.readableValues.some((item) => readableMatchesCapability(item.itemId, item.name, capability)) ||
    device.writableControls.some((control) => controlMatchesCapability(control.controlId, control.name, capability))
  );
}

function isWholeDeviceStatusRead(device: SimulatedDeviceContext, target: NormalizedTarget): boolean {
  if (target.dataItem || target.capability) {
    return false;
  }

  return device.type === "air_conditioner" && target.tokens.some((token) => ["status", "state", "running"].includes(token));
}

function readableMatchesCapability(itemId: string, name: string, capability: string): boolean {
  if (capability === "temperature") {
    return itemId.includes("temperature");
  }

  return itemMatches(itemId, name, capability);
}

function controlMatchesCapability(controlId: string, name: string, capability: string): boolean {
  return itemMatches(controlId, name, capability);
}

function itemMatches(id: string, name: string, requested: string): boolean {
  const normalizedRequested = normalizeText(requested);
  const normalizedId = normalizeText(id);
  const normalizedName = normalizeText(name);

  return (
    normalizedId === normalizedRequested ||
    normalizedName === normalizedRequested ||
    normalizedId.includes(normalizedRequested) ||
    normalizedName.includes(normalizedRequested)
  );
}

function detectDeviceType(tokens: string[]): SimulatedDeviceContext["type"] | undefined {
  return (Object.entries(typeSynonyms) as Array<[SimulatedDeviceContext["type"], string[]]>).find(([, synonyms]) =>
    synonyms.some((synonym) => containsTokenPhrase(tokens, synonym))
  )?.[0];
}

function findSynonymKey(synonymsByKey: Record<string, string[]>, tokens: string[]): string | undefined {
  return Object.entries(synonymsByKey).find(([, synonyms]) =>
    synonyms.some((synonym) => containsTokenPhrase(tokens, synonym))
  )?.[0];
}

function displayNameTokens(device: SimulatedDeviceContext): string[] {
  return tokenize(`${device.displayName} ${device.room} ${device.type.replaceAll("_", " ")}`);
}

function isConcreteDeviceToken(device: SimulatedDeviceContext, token: string): boolean {
  if (token.length < 3 || ["on", "off", "is", "the", "what", "doing", "status", "state"].includes(token)) {
    return false;
  }

  return displayNameTokens(device).includes(token);
}

function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(" ")
    .filter((token) => token.length > 0);
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function containsTokenPhrase(tokens: string[], phrase: string): boolean {
  const normalized = normalizeText(phrase);

  if (!normalized) {
    return false;
  }

  return tokens.join(" ").includes(normalized);
}

function ambiguous(candidates: SimulatedDeviceContext[]): AmbiguousResult {
  return {
    kind: "ambiguous",
    reason: "multiple_devices",
    candidates,
    message: "Multiple simulated devices match the request."
  };
}

function notFound(message: string): NotFoundResult {
  return {
    kind: "not_found",
    reason: "device_not_found",
    message
  };
}
