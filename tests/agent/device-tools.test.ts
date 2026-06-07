import { describe, expect, it } from "vitest";
import type { SelectedDataItem, SimulatedDeviceContext } from "../../src/contracts/device-contract.js";
import { createDeviceTools, type DeviceToolResult } from "../../src/agent/device-tools.js";
import { SimulatedDeviceService } from "../../src/domain/devices/simulated-device-service.js";

type InvokableDeviceTool = {
  invoke(input: unknown): Promise<DeviceToolResult>;
};

function asInvokable(tool: unknown): InvokableDeviceTool {
  return tool as InvokableDeviceTool;
}

describe("device tool wrappers", () => {
  it("returns air-conditioner status facts for living-room status input", async () => {
    const [readStatus] = createDeviceTools(new SimulatedDeviceService());

    const result = await asInvokable(readStatus).invoke({
      room: "living room",
      deviceType: "air_conditioner"
    });

    expect(result).toMatchObject({
      ok: true,
      kind: "read_success",
      device: {
        deviceId: "device-ac-living-room"
      }
    });
    expect(result.kind).toBe("read_success");
    if (result.kind !== "read_success") {
      throw new Error("expected read_success tool result");
    }
    expect(result.dataItems.map((item: SelectedDataItem) => [item.itemId, item.value])).toEqual([
      ["power", true],
      ["mode", "cool"],
      ["target_temperature", 24],
      ["room_temperature", 25.3]
    ]);
  });

  it("proposes hallway-light control without mutating state", async () => {
    const service = new SimulatedDeviceService();
    const [, proposeControl] = createDeviceTools(service);

    const result = await asInvokable(proposeControl).invoke({
      room: "hallway",
      deviceType: "light",
      controlItem: "power",
      requestedValue: true
    });
    const after = service.readStatus({
      room: "hallway",
      deviceType: "light",
      dataItem: "power"
    });

    expect(result).toMatchObject({
      ok: true,
      kind: "control_proposed",
      controlItem: {
        controlId: "power",
        requestedValue: true
      }
    });
    expect(after.kind).toBe("read_success");
    if (after.kind === "read_success") {
      expect(after.dataItems[0]?.value).toBe(false);
    }
  });

  it("serializes blocked device outcomes with stable reason fields", async () => {
    const [readStatus, proposeControl] = createDeviceTools(new SimulatedDeviceService());

    const ambiguous = await asInvokable(readStatus).invoke({
      phrase: "What is the bedroom device doing?"
    });
    const offline = await asInvokable(proposeControl).invoke({
      room: "kitchen",
      deviceType: "light",
      controlItem: "power",
      requestedValue: true
    });
    const invalid = await asInvokable(proposeControl).invoke({
      room: "hallway",
      deviceType: "light",
      controlItem: "power",
      requestedValue: "yes"
    });
    const notFound = await asInvokable(readStatus).invoke({
      phrase: "Is the garage fan on?"
    });
    const unsupported = await asInvokable(readStatus).invoke({
      room: "hallway",
      deviceType: "light",
      dataItem: "humidity"
    });

    expect(ambiguous).toMatchObject({
      ok: false,
      kind: "ambiguous",
      reason: "multiple_devices"
    });
    expect(ambiguous.kind).toBe("ambiguous");
    if (ambiguous.kind !== "ambiguous") {
      throw new Error("expected ambiguous tool result");
    }
    expect(ambiguous.candidates?.map((device: SimulatedDeviceContext) => device.deviceId)).toEqual([
      "device-sensor-bedroom",
      "device-light-bedroom"
    ]);
    expect(offline).toMatchObject({
      ok: false,
      kind: "unavailable",
      reason: "device_offline"
    });
    expect(invalid).toMatchObject({
      ok: false,
      kind: "invalid_value",
      reason: "invalid_control_value"
    });
    expect(notFound).toMatchObject({
      ok: false,
      kind: "not_found",
      reason: "device_not_found"
    });
    expect(unsupported).toMatchObject({
      ok: false,
      kind: "unsupported",
      reason: "readable_item_not_found",
      device: {
        deviceId: "device-light-hallway"
      }
    });
  });

  it("returns a JSON-serializable provider-neutral catalog snapshot", async () => {
    const [, , listCandidates] = createDeviceTools(new SimulatedDeviceService());

    const result = await asInvokable(listCandidates).invoke({});

    expect(result).toMatchObject({
      ok: true,
      kind: "catalog_snapshot"
    });
    expect(result.kind).toBe("catalog_snapshot");
    if (result.kind !== "catalog_snapshot") {
      throw new Error("expected catalog snapshot tool result");
    }
    expect(result.devices.length).toBeGreaterThan(0);
    expect(JSON.stringify(result)).not.toContain("tool_calls");
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });
});
