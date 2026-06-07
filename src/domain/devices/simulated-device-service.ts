import type { PublicValue } from "../../contracts/task-contract.js";
import type {
  DeviceControlApplyResult,
  DeviceControlProposalResult,
  DeviceReadResult,
  InvalidValueResult,
  UnavailableResult
} from "./device-results.js";
import { DeviceResolver, resolveBooleanFromPhrase } from "./device-resolver.js";
import { SimulatedDeviceStore } from "./simulated-device-store.js";
import type { Clock, ControlTarget, DeviceTarget, SimulatedDeviceSeed } from "./device-types.js";

export class SimulatedDeviceService {
  readonly #store: SimulatedDeviceStore;
  readonly #resolver: DeviceResolver;

  constructor(options: { seeds?: SimulatedDeviceSeed[]; clock?: Clock; store?: SimulatedDeviceStore; resolver?: DeviceResolver } = {}) {
    const storeOptions = {
      ...(options.seeds ? { seeds: options.seeds } : {}),
      ...(options.clock ? { clock: options.clock } : {})
    };
    this.#store = options.store ?? new SimulatedDeviceStore(storeOptions);
    this.#resolver = options.resolver ?? new DeviceResolver();
  }

  readStatus(target: DeviceTarget): DeviceReadResult {
    const resolution = this.#resolver.resolveRead(this.#store.listDevices(), target);

    if (resolution.kind !== "resolved") {
      return resolution;
    }

    if (!resolution.device.availability.online) {
      return unavailable(resolution.device);
    }

    return {
      kind: "read_success",
      device: resolution.device,
      dataItems: resolution.dataItems
    };
  }

  proposeControl(target: ControlTarget): DeviceControlProposalResult {
    const resolution = this.#resolver.resolveControl(this.#store.listDevices(), target);

    if (resolution.kind !== "resolved") {
      return resolution;
    }

    if (!resolution.device.availability.online) {
      return unavailable(resolution.device);
    }

    if (!resolution.controlItem) {
      return {
        kind: "unsupported",
        reason: "control_item_not_found",
        device: resolution.device,
        message: `No writable control matches the requested action on ${resolution.device.displayName}.`
      };
    }

    const validation = this.#store.validateControlValue(
      resolution.controlItem.deviceId,
      resolution.controlItem.controlId,
      target.requestedValue
    );

    if (!validation) {
      return {
        kind: "unsupported",
        reason: "control_item_not_found",
        device: resolution.device,
        message: `No writable control matches the requested action on ${resolution.device.displayName}.`
      };
    }

    if (!validation.valid) {
      const invalid: InvalidValueResult = {
        kind: "invalid_value",
        reason: "invalid_control_value",
        device: resolution.device,
        controlId: resolution.controlItem.controlId,
        requestedValue: target.requestedValue,
        metadata: validation.metadata,
        message: `Value ${String(target.requestedValue)} is invalid for ${resolution.controlItem.name}.`
      };

      return invalid;
    }

    return {
      kind: "control_proposed",
      device: resolution.device,
      controlItem: resolution.controlItem,
      expectedEffect: expectedEffect(resolution.device.displayName, resolution.controlItem.name, target.requestedValue)
    };
  }

  proposePowerControlFromPhrase(target: DeviceTarget): DeviceControlProposalResult {
    const requestedValue = resolveBooleanFromPhrase(target.phrase);

    if (requestedValue === undefined) {
      return {
        kind: "not_found",
        reason: "device_not_found",
        message: "No requested power value could be inferred from the phrase."
      };
    }

    return this.proposeControl({
      ...target,
      controlItem: target.controlItem ?? "power",
      requestedValue
    });
  }

  applyControl(target: ControlTarget): DeviceControlApplyResult {
    const proposal = this.proposeControl(target);

    if (proposal.kind !== "control_proposed") {
      return proposal;
    }

    return this.#store.applyControl({
      deviceId: proposal.controlItem.deviceId,
      controlId: proposal.controlItem.controlId,
      requestedValue: proposal.controlItem.requestedValue
    });
  }

  debugSnapshot() {
    return this.#store.listDevices();
  }
}

function unavailable(device: UnavailableResult["device"]): UnavailableResult {
  return {
    kind: "unavailable",
    reason: "device_offline",
    device,
    message: device.availability.reason ?? `${device.displayName} is unavailable.`
  };
}

function expectedEffect(deviceName: string, controlName: string, requestedValue: PublicValue): string {
  return `${deviceName} ${controlName.toLowerCase()} will change to ${String(requestedValue)}.`;
}
