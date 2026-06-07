import { describe, expect, it } from "vitest";
import { DeviceResolver } from "../../../src/domain/devices/device-resolver.js";
import { createSeedCatalog } from "../../../src/domain/devices/simulated-device-seeds.js";

describe("DeviceResolver", () => {
  it("resolves living-room air-conditioner status and selects common readable values", () => {
    const resolver = new DeviceResolver();
    const result = resolver.resolveRead(createSeedCatalog(), {
      phrase: "Is the living room air conditioner running?"
    });

    expect(result.kind).toBe("resolved");
    if (result.kind === "resolved") {
      expect(result.device.deviceId).toBe("device-ac-living-room");
      expect(result.dataItems.map((item) => item.itemId)).toEqual([
        "power",
        "mode",
        "target_temperature",
        "room_temperature"
      ]);
    }
  });

  it("resolves light power status from an on/off phrase", () => {
    const resolver = new DeviceResolver();
    const result = resolver.resolveRead(createSeedCatalog(), {
      phrase: "Is the hallway light on?"
    });

    expect(result.kind).toBe("resolved");
    if (result.kind === "resolved") {
      expect(result.device.deviceId).toBe("device-light-hallway");
      expect(result.dataItems).toHaveLength(1);
      expect(result.dataItems[0]?.itemId).toBe("power");
    }
  });

  it("returns ambiguity for vague bedroom-device phrases", () => {
    const resolver = new DeviceResolver();
    const result = resolver.resolveRead(createSeedCatalog(), {
      phrase: "What is the bedroom device doing?"
    });

    expect(result.kind).toBe("ambiguous");
    if (result.kind === "ambiguous") {
      expect(result.candidates.map((device) => device.deviceId)).toEqual([
        "device-sensor-bedroom",
        "device-light-bedroom"
      ]);
    }
  });

  it("resolves one room candidate when precise device type is present", () => {
    const resolver = new DeviceResolver();
    const result = resolver.resolveRead(createSeedCatalog(), {
      phrase: "What is the bedroom light doing?"
    });

    expect(result.kind).toBe("resolved");
    if (result.kind === "resolved") {
      expect(result.device.deviceId).toBe("device-light-bedroom");
      expect(result.dataItems[0]?.itemId).toBe("power");
    }
  });

  it("returns unsupported for unsupported data and control intents after resolving a device", () => {
    const resolver = new DeviceResolver();
    const unsupportedData = resolver.resolveRead(createSeedCatalog(), {
      room: "hallway",
      deviceType: "light",
      dataItem: "humidity"
    });
    const unsupportedControl = resolver.resolveControl(createSeedCatalog(), {
      room: "bedroom",
      deviceType: "environment_sensor",
      controlItem: "temperature",
      requestedValue: 19
    });

    expect(unsupportedData.kind).toBe("unsupported");
    expect(unsupportedControl.kind).toBe("unsupported");
    if (unsupportedControl.kind === "unsupported") {
      expect(unsupportedControl.reason).toBe("read_only");
    }
  });

  it("returns not-found when no seeded device matches", () => {
    const resolver = new DeviceResolver();
    const result = resolver.resolveRead(createSeedCatalog(), {
      phrase: "Is the garage fan on?"
    });

    expect(result.kind).toBe("not_found");
  });

  it("returns selected metadata copies so callers cannot mutate source snapshots", () => {
    const resolver = new DeviceResolver();
    const catalog = createSeedCatalog();
    const readResult = resolver.resolveRead(catalog, {
      phrase: "Is the hallway light on?"
    });
    const controlResult = resolver.resolveControl(catalog, {
      room: "hallway",
      deviceType: "light",
      controlItem: "power",
      requestedValue: true
    });

    expect(readResult.kind).toBe("resolved");
    expect(controlResult.kind).toBe("resolved");

    if (readResult.kind === "resolved" && controlResult.kind === "resolved") {
      readResult.dataItems[0]!.metadata!.label = "Changed Data Label";
      controlResult.controlItem!.metadata!.label = "Changed Control Label";
    }

    const hallway = catalog.find((device) => device.deviceId === "device-light-hallway");
    expect(hallway?.readableValues[0]?.metadata.label).toBe("Power");
    expect(hallway?.writableControls[0]?.metadata.label).toBe("Power");
  });
});
