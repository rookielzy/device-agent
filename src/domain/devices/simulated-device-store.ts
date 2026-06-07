import type {
  PublicValue,
  ReadableValue,
  SelectedControlItem,
  SelectedDataItem,
  SimulatedDeviceContext,
  ValueMetadata,
  WritableControl
} from "../../contracts/device-contract.js";
import {
  type ControlAppliedResult,
  type DeviceControlApplyResult,
  type InvalidValueResult,
  type UnavailableResult,
  type UnsupportedResult
} from "./device-results.js";
import { createSeedCatalog } from "./simulated-device-seeds.js";
import type { Clock, ControlTargetInput, SimulatedDeviceSeed, ValueValidationResult } from "./device-types.js";

type DeviceState = SimulatedDeviceContext;

const defaultClock: Clock = () => new Date();

export class SimulatedDeviceStore {
  readonly #devices = new Map<string, DeviceState>();
  readonly #clock: Clock;

  constructor(options: { seeds?: SimulatedDeviceSeed[]; clock?: Clock } = {}) {
    this.#clock = options.clock ?? defaultClock;

    for (const device of createSeedCatalog(options.seeds)) {
      this.#devices.set(device.deviceId, device);
    }
  }

  listDevices(): SimulatedDeviceContext[] {
    return this.#snapshot([...this.#devices.values()]);
  }

  getDevice(deviceId: string): SimulatedDeviceContext | undefined {
    const device = this.#devices.get(deviceId);

    return device ? this.#snapshot(device) : undefined;
  }

  selectReadableData(deviceId: string, itemIds?: string[]): SelectedDataItem[] {
    const device = this.#devices.get(deviceId);

    if (!device) {
      return [];
    }

    const ids = itemIds ? new Set(itemIds) : undefined;

    return device.readableValues
      .filter((item) => !ids || ids.has(item.itemId))
      .map((item) => this.#toSelectedDataItem(device.deviceId, item));
  }

  selectWritableControl(input: ControlTargetInput): SelectedControlItem | undefined {
    const device = this.#devices.get(input.deviceId);
    const control = device?.writableControls.find((candidate) => candidate.controlId === input.controlId);

    if (!device || !control) {
      return undefined;
    }

    return this.#toSelectedControlItem(device.deviceId, control, input.requestedValue);
  }

  validateControlValue(deviceId: string, controlId: string, requestedValue: PublicValue): ValueValidationResult | undefined {
    const device = this.#devices.get(deviceId);
    const control = device?.writableControls.find((candidate) => candidate.controlId === controlId);

    if (!control) {
      return undefined;
    }

    return validateValue(control.metadata, requestedValue);
  }

  applyControl(input: ControlTargetInput): DeviceControlApplyResult {
    const device = this.#devices.get(input.deviceId);

    if (!device) {
      return {
        kind: "not_found",
        reason: "device_not_found",
        message: `No simulated device found for ${input.deviceId}.`
      };
    }

    if (!device.availability.online) {
      return this.#unavailable(device);
    }

    const control = device.writableControls.find((candidate) => candidate.controlId === input.controlId);

    if (!control) {
      return this.#unsupported(device, "control_item_not_found", `Device ${device.displayName} does not expose writable control ${input.controlId}.`);
    }

    const validation = validateValue(control.metadata, input.requestedValue);

    if (!validation.valid) {
      return this.#invalidValue(device, control, input.requestedValue, validation.metadata);
    }

    const previousValue = control.currentValue;
    control.currentValue = input.requestedValue;

    const readable = findReadableForControl(device, control.controlId);
    if (readable) {
      readable.value = input.requestedValue;
      readable.freshness = "fresh";
      readable.observedAt = this.#clock().toISOString();
    }

    const snapshot = this.#snapshot(device);
    const appliedControl = this.#toSelectedControlItem(snapshot.deviceId, control, input.requestedValue);
    const result: ControlAppliedResult = {
      kind: "control_applied",
      device: snapshot,
      controlItem: appliedControl,
      ...(previousValue === undefined ? {} : { previousValue }),
      updatedValue: input.requestedValue
    };

    return result;
  }

  #unavailable(device: DeviceState): UnavailableResult {
    return {
      kind: "unavailable",
      reason: "device_offline",
      device: this.#snapshot(device),
      message: device.availability.reason ?? `${device.displayName} is unavailable.`
    };
  }

  #unsupported(device: DeviceState, reason: UnsupportedResult["reason"], message: string): UnsupportedResult {
    return {
      kind: "unsupported",
      reason,
      device: this.#snapshot(device),
      message
    };
  }

  #invalidValue(device: DeviceState, control: WritableControl, requestedValue: PublicValue, metadata: ValueMetadata): InvalidValueResult {
    return {
      kind: "invalid_value",
      reason: "invalid_control_value",
      device: this.#snapshot(device),
      controlId: control.controlId,
      requestedValue,
      metadata,
      message: `Value ${String(requestedValue)} is invalid for ${control.name}.`
    };
  }

  #toSelectedDataItem(deviceId: string, item: ReadableValue): SelectedDataItem {
    return {
      deviceId,
      itemId: item.itemId,
      name: item.name,
      ...(item.value === undefined ? {} : { value: item.value }),
      metadata: cloneMetadata(item.metadata),
      freshness: item.freshness
    };
  }

  #toSelectedControlItem(deviceId: string, control: WritableControl, requestedValue: PublicValue): SelectedControlItem {
    return {
      deviceId,
      controlId: control.controlId,
      name: control.name,
      requestedValue,
      metadata: cloneMetadata(control.metadata)
    };
  }

  #snapshot<T extends SimulatedDeviceContext | SimulatedDeviceContext[]>(value: T): T {
    return structuredClone(value);
  }
}

function cloneMetadata(metadata: ValueMetadata): ValueMetadata {
  return structuredClone(metadata);
}

export function validateValue(metadata: ValueMetadata, value: PublicValue): ValueValidationResult {
  switch (metadata.kind) {
    case "boolean":
      return typeof value === "boolean" ? { valid: true } : { valid: false, failure: "boolean_expected", metadata: cloneMetadata(metadata) };
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return { valid: false, failure: "number_expected", metadata: cloneMetadata(metadata) };
      }

      if (metadata.min !== undefined && value < metadata.min) {
        return { valid: false, failure: "below_minimum", metadata: cloneMetadata(metadata) };
      }

      if (metadata.max !== undefined && value > metadata.max) {
        return { valid: false, failure: "above_maximum", metadata: cloneMetadata(metadata) };
      }

      if (metadata.step !== undefined) {
        const base = metadata.min ?? 0;
        const scaled = (value - base) / metadata.step;

        if (Math.abs(scaled - Math.round(scaled)) > Number.EPSILON * 100) {
          return { valid: false, failure: "invalid_step", metadata: cloneMetadata(metadata) };
        }
      }

      return { valid: true };
    case "string":
      return typeof value === "string" ? { valid: true } : { valid: false, failure: "string_expected", metadata: cloneMetadata(metadata) };
    case "enum":
      if (typeof value !== "string") {
        return { valid: false, failure: "enum_expected", metadata: cloneMetadata(metadata) };
      }

      return metadata.options.includes(value)
        ? { valid: true }
        : { valid: false, failure: "enum_option_not_allowed", metadata: cloneMetadata(metadata) };
  }
}

function findReadableForControl(device: DeviceState, controlId: string): ReadableValue | undefined {
  return device.readableValues.find((item) => item.itemId === controlId);
}
