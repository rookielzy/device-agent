import { describe, expect, it } from "vitest";
import {
  selectedControlItemSchema,
  selectedDataItemSchema,
  simulatedDeviceContextSchema
} from "../../../src/contracts/device-contract.js";
import type { DeviceDomainResult } from "../../../src/domain/devices/device-results.js";
import { createSeedCatalog } from "../../../src/domain/devices/simulated-device-seeds.js";
import { SimulatedDeviceService } from "../../../src/domain/devices/simulated-device-service.js";
import {
  bedroomSensor,
  hallwayLight,
  livingRoomAirConditioner,
  offlineKitchenLight
} from "../../fixtures/contract-fixtures.js";

describe("device domain contract compatibility", () => {
  it("keeps existing contract fixtures valid", () => {
    expect(simulatedDeviceContextSchema.safeParse(livingRoomAirConditioner).success).toBe(true);
    expect(simulatedDeviceContextSchema.safeParse(hallwayLight).success).toBe(true);
    expect(simulatedDeviceContextSchema.safeParse(bedroomSensor).success).toBe(true);
    expect(simulatedDeviceContextSchema.safeParse(offlineKitchenLight).success).toBe(true);
  });

  it("parses every production seed snapshot through the public device context schema", () => {
    const catalog = createSeedCatalog();

    expect(catalog.map((device) => simulatedDeviceContextSchema.parse(device).deviceId)).toEqual([
      "device-ac-living-room",
      "device-light-hallway",
      "device-light-kitchen",
      "device-sensor-bedroom",
      "device-light-bedroom"
    ]);
  });

  it("seeds the planned simulated device branches", () => {
    const catalog = createSeedCatalog();
    const livingRoomAc = catalog.find((device) => device.deviceId === "device-ac-living-room");
    const hallway = catalog.find((device) => device.deviceId === "device-light-hallway");
    const kitchen = catalog.find((device) => device.deviceId === "device-light-kitchen");
    const sensor = catalog.find((device) => device.deviceId === "device-sensor-bedroom");
    const bedroomDevices = catalog.filter((device) => device.room === "bedroom");

    expect(livingRoomAc?.readableValues.map((item) => item.itemId)).toEqual([
      "power",
      "mode",
      "target_temperature",
      "room_temperature"
    ]);
    expect(hallway?.writableControls).toHaveLength(1);
    expect(kitchen?.availability.online).toBe(false);
    expect(kitchen?.availability.reason).toContain("heartbeat");
    expect(sensor?.writableControls).toHaveLength(0);
    expect(bedroomDevices.length).toBeGreaterThanOrEqual(2);
  });

  it("parses selected domain data and control items through public selected schemas", () => {
    const service = new SimulatedDeviceService();
    const readResult = service.readStatus({
      room: "living room",
      deviceType: "air_conditioner",
      phrase: "living room air conditioner status"
    });
    const controlResult = service.proposeControl({
      room: "hallway",
      deviceType: "light",
      controlItem: "power",
      requestedValue: true
    });

    expect(readResult.kind).toBe("read_success");
    if (readResult.kind === "read_success") {
      expect(readResult.dataItems.map((item) => selectedDataItemSchema.parse(item).itemId)).toEqual([
        "power",
        "mode",
        "target_temperature",
        "room_temperature"
      ]);
    }

    expect(controlResult.kind).toBe("control_proposed");
    if (controlResult.kind === "control_proposed") {
      expect(selectedControlItemSchema.parse(controlResult.controlItem).controlId).toBe("power");
    }
  });

  it("keeps domain outcomes task-neutral and provider-neutral", () => {
    const service = new SimulatedDeviceService();
    const outcomes: DeviceDomainResult[] = [
      service.readStatus({ room: "living room", deviceType: "air_conditioner", phrase: "status" }),
      service.proposeControl({ room: "hallway", deviceType: "light", controlItem: "power", requestedValue: true }),
      service.applyControl({ room: "hallway", deviceType: "light", controlItem: "power", requestedValue: true }),
      service.readStatus({ phrase: "what is the bedroom device doing" }),
      service.readStatus({ phrase: "where is the garage fan" }),
      service.readStatus({ room: "kitchen", deviceType: "light", phrase: "status" }),
      service.proposeControl({ room: "bedroom", deviceType: "environment_sensor", controlItem: "temperature", requestedValue: 19 }),
      service.proposeControl({ room: "hallway", deviceType: "light", controlItem: "power", requestedValue: "yes" })
    ];

    expect(outcomes.map((outcome) => outcome.kind)).toEqual([
      "read_success",
      "control_proposed",
      "control_applied",
      "ambiguous",
      "not_found",
      "unavailable",
      "unsupported",
      "invalid_value"
    ]);

    for (const outcome of outcomes) {
      expect("taskId" in outcome).toBe(false);
      expect("timeline" in outcome).toBe(false);
      expect("messages" in outcome).toBe(false);
      expect("tool_calls" in outcome).toBe(false);
      expect("run" in outcome).toBe(false);
    }
  });
});
