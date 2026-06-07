import type {
  PublicValue,
  ReadableValue,
  SelectedControlItem,
  SelectedDataItem,
  SimulatedDeviceContext,
  ValueMetadata,
  WritableControl
} from "../../contracts/device-contract.js";

export type DeviceTarget = {
  deviceId?: string;
  room?: string;
  deviceName?: string;
  deviceType?: SimulatedDeviceContext["type"];
  capability?: string;
  dataItem?: string;
  controlItem?: string;
  phrase?: string;
};

export type ControlTarget = DeviceTarget & {
  requestedValue: PublicValue;
};

export type ControlTargetInput = {
  deviceId: string;
  controlId: string;
  requestedValue: PublicValue;
};

export type Clock = () => Date;

export type MutableReadableValue = ReadableValue;
export type MutableWritableControl = WritableControl;

export type SimulatedDeviceSeed = SimulatedDeviceContext & {
  aliases?: string[];
};

export type DeviceSnapshot = SimulatedDeviceContext;
export type SelectedReadableData = SelectedDataItem;
export type SelectedWritableControl = SelectedControlItem;

export type ValueValidationFailure =
  | "boolean_expected"
  | "number_expected"
  | "string_expected"
  | "enum_expected"
  | "enum_option_not_allowed"
  | "below_minimum"
  | "above_maximum"
  | "invalid_step";

export type ValueValidationResult =
  | {
      valid: true;
    }
  | {
      valid: false;
      failure: ValueValidationFailure;
      metadata: ValueMetadata;
    };

export type ResolvedDeviceTarget = {
  device: DeviceSnapshot;
  dataItems: SelectedReadableData[];
  controlItem?: SelectedWritableControl;
};
