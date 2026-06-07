import { tool } from "@langchain/core/tools";
import { z } from "zod";
import {
  type SelectedControlItem,
  type SelectedDataItem,
  type SimulatedDeviceContext
} from "../contracts/device-contract.js";
import {
  controlTargetSchema,
  deviceTargetSchema,
  toControlTarget,
  toDeviceTarget
} from "./agent-schemas.js";
import type {
  DeviceControlProposalResult,
  DeviceDomainResult,
  DeviceReadResult
} from "../domain/devices/device-results.js";
import { SimulatedDeviceService } from "../domain/devices/simulated-device-service.js";

export type DeviceToolResult =
  | {
      ok: true;
      kind: "read_success";
      device: DeviceToolDevice;
      dataItems: SelectedDataItem[];
    }
  | {
      ok: true;
      kind: "control_proposed";
      device: DeviceToolDevice;
      controlItem: SelectedControlItem;
      expectedEffect: string;
    }
  | {
      ok: true;
      kind: "catalog_snapshot";
      devices: DeviceToolDevice[];
    }
  | {
      ok: false;
      kind: Exclude<DeviceDomainResult["kind"], "read_success" | "control_proposed" | "control_applied">;
      reason: string;
      message: string;
      device?: DeviceToolDevice;
      candidates?: DeviceToolDevice[];
    };

type DeviceToolDevice = Pick<
  SimulatedDeviceContext,
  "deviceId" | "displayName" | "room" | "type" | "availability" | "capabilities" | "readableValues" | "writableControls"
>;

export type DeviceToolSet = ReturnType<typeof createDeviceTools>;

export function createDeviceTools(deviceService: Pick<SimulatedDeviceService, "readStatus" | "proposeControl" | "debugSnapshot">) {
  return [
    tool(
      async (target) => serializeReadResult(deviceService.readStatus(toDeviceTarget(target))),
      {
        name: "read_simulated_device_status",
        description: "Resolve a simulated device target and return readable status facts without mutation.",
        schema: deviceTargetSchema
      }
    ),
    tool(
      async (target) => serializeControlResult(deviceService.proposeControl(toControlTarget(target))),
      {
        name: "propose_simulated_device_control",
        description: "Validate a simulated control request and return proposal facts without applying the control.",
        schema: controlTargetSchema
      }
    ),
    tool(
      async () => ({
        ok: true as const,
        kind: "catalog_snapshot" as const,
        devices: deviceService.debugSnapshot().map(toToolDevice)
      }),
      {
        name: "list_simulated_device_candidates",
        description: "Return a compact simulated-device catalog for resolving ambiguous user language.",
        schema: z.object({}).strict()
      }
    )
  ];
}

function serializeReadResult(result: DeviceReadResult): DeviceToolResult {
  if (result.kind === "read_success") {
    return {
      ok: true,
      kind: result.kind,
      device: toToolDevice(result.device),
      dataItems: result.dataItems
    };
  }

  return serializeBlockedResult(result);
}

function serializeControlResult(result: DeviceControlProposalResult): DeviceToolResult {
  if (result.kind === "control_proposed") {
    return {
      ok: true,
      kind: result.kind,
      device: toToolDevice(result.device),
      controlItem: result.controlItem,
      expectedEffect: result.expectedEffect
    };
  }

  return serializeBlockedResult(result);
}

function serializeBlockedResult(
  result: Exclude<DeviceReadResult | DeviceControlProposalResult, { kind: "read_success" | "control_proposed" }>
): DeviceToolResult {
  switch (result.kind) {
    case "ambiguous":
      return {
        ok: false,
        kind: result.kind,
        reason: result.reason,
        message: result.message,
        candidates: result.candidates.map(toToolDevice)
      };
    case "not_found":
      return {
        ok: false,
        kind: result.kind,
        reason: result.reason,
        message: result.message
      };
    case "unavailable":
    case "unsupported":
      return {
        ok: false,
        kind: result.kind,
        reason: result.reason,
        message: result.message,
        ...(result.device ? { device: toToolDevice(result.device) } : {})
      };
    case "invalid_value":
      return {
        ok: false,
        kind: result.kind,
        reason: result.reason,
        message: result.message,
        device: toToolDevice(result.device)
      };
  }
}

function toToolDevice(device: SimulatedDeviceContext): DeviceToolDevice {
  return {
    deviceId: device.deviceId,
    displayName: device.displayName,
    room: device.room,
    type: device.type,
    availability: device.availability,
    capabilities: device.capabilities,
    readableValues: device.readableValues,
    writableControls: device.writableControls
  };
}
