import type {
  SelectedControlItem,
  SelectedDataItem,
  SimulatedDeviceContext,
  ValueMetadata
} from "../../contracts/device-contract.js";
import type { PublicValue } from "../../contracts/task-contract.js";

export type DeviceResultKind =
  | "read_success"
  | "control_proposed"
  | "control_applied"
  | "ambiguous"
  | "not_found"
  | "unavailable"
  | "unsupported"
  | "invalid_value";

export type DeviceResultReason =
  | "device_not_found"
  | "multiple_devices"
  | "multiple_capabilities"
  | "device_offline"
  | "readable_item_not_found"
  | "control_item_not_found"
  | "read_only"
  | "unsupported_capability"
  | "invalid_control_value"
  | "state_unavailable";

type ResultBase = {
  kind: DeviceResultKind;
  reason?: DeviceResultReason;
};

export type ReadSuccessResult = ResultBase & {
  kind: "read_success";
  device: SimulatedDeviceContext;
  dataItems: SelectedDataItem[];
};

export type ControlProposedResult = ResultBase & {
  kind: "control_proposed";
  device: SimulatedDeviceContext;
  controlItem: SelectedControlItem;
  expectedEffect: string;
};

export type ControlAppliedResult = ResultBase & {
  kind: "control_applied";
  device: SimulatedDeviceContext;
  controlItem: SelectedControlItem;
  previousValue?: PublicValue;
  updatedValue: PublicValue;
};

export type AmbiguousResult = ResultBase & {
  kind: "ambiguous";
  reason: "multiple_devices" | "multiple_capabilities";
  candidates: SimulatedDeviceContext[];
  message: string;
};

export type NotFoundResult = ResultBase & {
  kind: "not_found";
  reason: "device_not_found";
  message: string;
};

export type UnavailableResult = ResultBase & {
  kind: "unavailable";
  reason: "device_offline" | "state_unavailable";
  device: SimulatedDeviceContext;
  message: string;
};

export type UnsupportedResult = ResultBase & {
  kind: "unsupported";
  reason: "readable_item_not_found" | "control_item_not_found" | "read_only" | "unsupported_capability";
  device?: SimulatedDeviceContext;
  message: string;
};

export type InvalidValueResult = ResultBase & {
  kind: "invalid_value";
  reason: "invalid_control_value";
  device: SimulatedDeviceContext;
  controlId: string;
  requestedValue: PublicValue;
  metadata: ValueMetadata;
  message: string;
};

export type DeviceReadResult = ReadSuccessResult | AmbiguousResult | NotFoundResult | UnavailableResult | UnsupportedResult;

export type DeviceControlProposalResult =
  | ControlProposedResult
  | AmbiguousResult
  | NotFoundResult
  | UnavailableResult
  | UnsupportedResult
  | InvalidValueResult;

export type DeviceControlApplyResult =
  | ControlAppliedResult
  | AmbiguousResult
  | NotFoundResult
  | UnavailableResult
  | UnsupportedResult
  | InvalidValueResult;

export type DeviceDomainResult = DeviceReadResult | DeviceControlProposalResult | DeviceControlApplyResult;
