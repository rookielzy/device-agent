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
import { noopTracer, traceTimed, type Tracer } from "../observability/trace.js";

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

export function createDeviceTools(
  deviceService: Pick<SimulatedDeviceService, "readStatus" | "proposeControl" | "debugSnapshot">,
  tracer: Tracer = noopTracer
) {
  return [
    tool(
      async (target) => traceTimed(
        tracer,
        "agent.tool.simulated_device",
        "read_status",
        {
          toolName: "read_simulated_device_status",
          target: summarizeTarget(target)
        },
        async () => {
          tracer.payload("debug", "agent.tool.simulated_device", "read_status.input", {
            input: target
          });
          const result = serializeReadResult(deviceService.readStatus(toDeviceTarget(target)));
          tracer.emit(result.ok ? "info" : "warn", "agent.tool.simulated_device", "read_status.completed", summarizeToolResult(result));
          tracer.payload("debug", "agent.tool.simulated_device", "read_status.output", {
            output: result
          });

          return result;
        }
      ),
      {
        name: "read_simulated_device_status",
        description: "Resolve a simulated device target and return readable status facts without mutation.",
        schema: deviceTargetSchema
      }
    ),
    tool(
      async (target) => traceTimed(
        tracer,
        "agent.tool.simulated_device",
        "propose_control",
        {
          toolName: "propose_simulated_device_control",
          target: summarizeTarget(target)
        },
        async () => {
          tracer.payload("debug", "agent.tool.simulated_device", "propose_control.input", {
            input: target
          });
          const result = serializeControlResult(deviceService.proposeControl(toControlTarget(target)));
          tracer.emit(result.ok ? "info" : "warn", "agent.tool.simulated_device", "propose_control.completed", summarizeToolResult(result));
          tracer.payload("debug", "agent.tool.simulated_device", "propose_control.output", {
            output: result
          });

          return result;
        }
      ),
      {
        name: "propose_simulated_device_control",
        description: "Validate a simulated control request and return proposal facts without applying the control.",
        schema: controlTargetSchema
      }
    ),
    tool(
      async () => traceTimed(
        tracer,
        "agent.tool.simulated_device",
        "list_candidates",
        {
          toolName: "list_simulated_device_candidates"
        },
        async () => {
          tracer.payload("debug", "agent.tool.simulated_device", "list_candidates.input", {
            input: {}
          });
          const result = {
            ok: true as const,
            kind: "catalog_snapshot" as const,
            devices: deviceService.debugSnapshot().map(toToolDevice)
          };
          tracer.emit("info", "agent.tool.simulated_device", "list_candidates.completed", summarizeToolResult(result));
          tracer.payload("debug", "agent.tool.simulated_device", "list_candidates.output", {
            output: result
          });

          return result;
        }
      ),
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

function summarizeTarget(target: unknown) {
  if (!isRecord(target)) {
    return {
      shape: typeof target
    };
  }

  return {
    room: stringField(target.room),
    deviceType: stringField(target.deviceType),
    dataItem: stringField(target.dataItem),
    controlItem: stringField(target.controlItem),
    requestedValueType: target.requestedValue === undefined ? undefined : typeof target.requestedValue,
    phraseLength: typeof target.phrase === "string" ? target.phrase.length : undefined
  };
}

function summarizeToolResult(result: DeviceToolResult) {
  if (result.ok) {
    return {
      ok: true,
      kind: result.kind,
      deviceId: result.kind === "catalog_snapshot" ? undefined : result.device.deviceId,
      dataItemCount: result.kind === "read_success" ? result.dataItems.length : undefined,
      controlItemId: result.kind === "control_proposed" ? result.controlItem.controlId : undefined,
      candidateCount: result.kind === "catalog_snapshot" ? result.devices.length : undefined
    };
  }

  return {
    ok: false,
    kind: result.kind,
    reason: result.reason,
    deviceId: result.device?.deviceId,
    candidateCount: result.candidates?.length
  };
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
