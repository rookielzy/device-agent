import { describe, expect, it } from "vitest";
import { simulatedDeviceContextSchema } from "../../../src/contracts/device-contract.js";
import { SimulatedDeviceService } from "../../../src/domain/devices/simulated-device-service.js";

const mutationClock = () => new Date("2026-06-07T09:15:00.000Z");

describe("SimulatedDeviceService", () => {
  it("reads air-conditioner status with selected device and data items", () => {
    const service = new SimulatedDeviceService();
    const result = service.readStatus({
      phrase: "Is the living room air conditioner running?"
    });

    expect(result.kind).toBe("read_success");
    if (result.kind === "read_success") {
      expect(result.device.deviceId).toBe("device-ac-living-room");
      expect(result.dataItems.map((item) => [item.itemId, item.value])).toEqual([
        ["power", true],
        ["mode", "cool"],
        ["target_temperature", 24],
        ["room_temperature", 25.3]
      ]);
    }
  });

  it("proposes light power control without mutation and applies the confirmed control later", () => {
    const service = new SimulatedDeviceService({ clock: mutationClock });
    const proposal = service.proposeControl({
      room: "hallway",
      deviceType: "light",
      controlItem: "power",
      requestedValue: true
    });

    expect(proposal.kind).toBe("control_proposed");
    if (proposal.kind === "control_proposed") {
      expect(proposal.controlItem.controlId).toBe("power");
      expect(proposal.expectedEffect).toContain("true");
    }

    const beforeApply = service.readStatus({
      room: "hallway",
      deviceType: "light",
      dataItem: "power"
    });
    expect(beforeApply.kind).toBe("read_success");
    if (beforeApply.kind === "read_success") {
      expect(beforeApply.dataItems[0]?.value).toBe(false);
    }

    const applied = service.applyControl({
      room: "hallway",
      deviceType: "light",
      controlItem: "power",
      requestedValue: true
    });
    expect(applied.kind).toBe("control_applied");

    const afterApply = service.readStatus({
      room: "hallway",
      deviceType: "light",
      dataItem: "power"
    });
    expect(afterApply.kind).toBe("read_success");
    if (afterApply.kind === "read_success") {
      expect(afterApply.dataItems[0]?.value).toBe(true);
    }
  });

  it("keeps repeated reads unchanged after a proposal without apply", () => {
    const service = new SimulatedDeviceService();
    service.proposeControl({
      room: "hallway",
      deviceType: "light",
      controlItem: "power",
      requestedValue: true
    });

    const first = service.readStatus({ room: "hallway", deviceType: "light", dataItem: "power" });
    const second = service.readStatus({ room: "hallway", deviceType: "light", dataItem: "power" });

    expect(first.kind).toBe("read_success");
    expect(second.kind).toBe("read_success");
    if (first.kind === "read_success" && second.kind === "read_success") {
      expect(first.dataItems[0]?.value).toBe(false);
      expect(second.dataItems[0]?.value).toBe(false);
    }
  });

  it("returns unavailable for reads and controls against offline devices without mutation", () => {
    const service = new SimulatedDeviceService();
    const read = service.readStatus({
      room: "kitchen",
      deviceType: "light",
      dataItem: "power"
    });
    const control = service.applyControl({
      room: "kitchen",
      deviceType: "light",
      controlItem: "power",
      requestedValue: true
    });

    expect(read.kind).toBe("unavailable");
    expect(control.kind).toBe("unavailable");
    expect(service.debugSnapshot().find((device) => device.deviceId === "device-light-kitchen")?.writableControls[0]?.currentValue).toBeUndefined();
  });

  it("rejects read-only sensor writes and unsupported controls while preserving values", () => {
    const service = new SimulatedDeviceService();
    const readOnly = service.proposeControl({
      room: "bedroom",
      deviceType: "environment_sensor",
      controlItem: "temperature",
      requestedValue: 19
    });
    const unsupported = service.proposeControl({
      room: "hallway",
      deviceType: "light",
      controlItem: "brightness",
      requestedValue: 40
    });

    expect(readOnly.kind).toBe("unsupported");
    if (readOnly.kind === "unsupported") {
      expect(readOnly.reason).toBe("read_only");
    }
    expect(unsupported.kind).toBe("unsupported");
    if (unsupported.kind === "unsupported") {
      expect(unsupported.reason).toBe("control_item_not_found");
    }

    const sensor = service.readStatus({
      room: "bedroom",
      deviceType: "environment_sensor",
      dataItem: "temperature"
    });
    expect(sensor.kind).toBe("read_success");
    if (sensor.kind === "read_success") {
      expect(sensor.dataItems[0]?.value).toBe(23.1);
    }
  });

  it("returns deterministic ambiguity and not-found outcomes", () => {
    const service = new SimulatedDeviceService();
    const ambiguous = service.readStatus({
      phrase: "What is the bedroom device doing?"
    });
    const notFound = service.readStatus({
      phrase: "Is the garage fan on?"
    });

    expect(ambiguous.kind).toBe("ambiguous");
    expect(notFound.kind).toBe("not_found");
  });

  it("returns invalid-value for unsupported requested values before mutation", () => {
    const service = new SimulatedDeviceService();
    const result = service.proposeControl({
      room: "hallway",
      deviceType: "light",
      controlItem: "power",
      requestedValue: "yes"
    });

    expect(result.kind).toBe("invalid_value");
    expect(service.debugSnapshot().find((device) => device.deviceId === "device-light-hallway")?.writableControls[0]?.currentValue).toBe(false);
  });

  it("debug snapshots reflect confirmed state changes and parse through public schemas", () => {
    const service = new SimulatedDeviceService({ clock: mutationClock });
    service.applyControl({
      room: "hallway",
      deviceType: "light",
      controlItem: "power",
      requestedValue: true
    });

    const snapshot = service.debugSnapshot();
    expect(snapshot.every((device) => simulatedDeviceContextSchema.safeParse(device).success)).toBe(true);
    expect(snapshot.find((device) => device.deviceId === "device-light-hallway")?.readableValues[0]?.value).toBe(true);
  });
});
