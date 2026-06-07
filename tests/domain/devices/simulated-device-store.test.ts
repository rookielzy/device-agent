import { describe, expect, it } from "vitest";
import { SimulatedDeviceStore } from "../../../src/domain/devices/simulated-device-store.js";

const mutationClock = () => new Date("2026-06-07T09:00:00.000Z");

describe("SimulatedDeviceStore", () => {
  it("applies a confirmed light power control to readable and writable state", () => {
    const store = new SimulatedDeviceStore({ clock: mutationClock });
    const result = store.applyControl({
      deviceId: "device-light-hallway",
      controlId: "power",
      requestedValue: true
    });

    expect(result.kind).toBe("control_applied");
    if (result.kind === "control_applied") {
      expect(result.previousValue).toBe(false);
      expect(result.updatedValue).toBe(true);
      expect(result.device.writableControls[0]?.currentValue).toBe(true);
      expect(result.device.readableValues[0]?.value).toBe(true);
      expect(result.device.readableValues[0]?.observedAt).toBe("2026-06-07T09:00:00.000Z");
    }

    expect(store.selectReadableData("device-light-hallway", ["power"])[0]?.value).toBe(true);
  });

  it("applies an air-conditioner target temperature control", () => {
    const store = new SimulatedDeviceStore({ clock: mutationClock });
    const result = store.applyControl({
      deviceId: "device-ac-living-room",
      controlId: "target_temperature",
      requestedValue: 25
    });

    expect(result.kind).toBe("control_applied");
    if (result.kind === "control_applied") {
      expect(result.previousValue).toBe(24);
      expect(result.updatedValue).toBe(25);
    }

    const snapshot = store.getDevice("device-ac-living-room");
    expect(snapshot?.readableValues.find((item) => item.itemId === "target_temperature")?.value).toBe(25);
    expect(snapshot?.writableControls.find((control) => control.controlId === "target_temperature")?.currentValue).toBe(25);
  });

  it("preserves state when callers only select controls before apply", () => {
    const store = new SimulatedDeviceStore();
    const selected = store.selectWritableControl({
      deviceId: "device-light-hallway",
      controlId: "power",
      requestedValue: true
    });

    expect(selected?.requestedValue).toBe(true);
    expect(store.selectReadableData("device-light-hallway", ["power"])[0]?.value).toBe(false);
    expect(store.getDevice("device-light-hallway")?.writableControls[0]?.currentValue).toBe(false);
  });

  it("returns unavailable and preserves state for offline devices", () => {
    const store = new SimulatedDeviceStore();
    const before = store.getDevice("device-light-kitchen");
    const result = store.applyControl({
      deviceId: "device-light-kitchen",
      controlId: "power",
      requestedValue: true
    });

    expect(result.kind).toBe("unavailable");
    expect(store.getDevice("device-light-kitchen")).toEqual(before);
  });

  it("rejects invalid enum, boolean, numeric range, and numeric step values without mutation", () => {
    const store = new SimulatedDeviceStore();
    const mode = store.applyControl({
      deviceId: "device-ac-living-room",
      controlId: "mode",
      requestedValue: "auto"
    });
    const boolean = store.applyControl({
      deviceId: "device-light-hallway",
      controlId: "power",
      requestedValue: "on"
    });
    const range = store.applyControl({
      deviceId: "device-ac-living-room",
      controlId: "target_temperature",
      requestedValue: 31
    });
    const step = store.applyControl({
      deviceId: "device-ac-living-room",
      controlId: "target_temperature",
      requestedValue: 24.5
    });

    expect([mode.kind, boolean.kind, range.kind, step.kind]).toEqual([
      "invalid_value",
      "invalid_value",
      "invalid_value",
      "invalid_value"
    ]);
    expect(store.getDevice("device-ac-living-room")?.writableControls.find((control) => control.controlId === "mode")?.currentValue).toBe("cool");
    expect(store.getDevice("device-ac-living-room")?.writableControls.find((control) => control.controlId === "target_temperature")?.currentValue).toBe(24);
    expect(store.getDevice("device-light-hallway")?.writableControls[0]?.currentValue).toBe(false);
  });

  it("returns defensive snapshots that cannot mutate store state", () => {
    const store = new SimulatedDeviceStore();
    const snapshot = store.getDevice("device-light-hallway");

    expect(snapshot).toBeDefined();
    snapshot!.displayName = "Changed Outside Store";
    snapshot!.readableValues[0]!.value = true;
    snapshot!.writableControls[0]!.currentValue = true;

    const later = store.getDevice("device-light-hallway");
    expect(later?.displayName).toBe("Hallway Light");
    expect(later?.readableValues[0]?.value).toBe(false);
    expect(later?.writableControls[0]?.currentValue).toBe(false);
  });
});
