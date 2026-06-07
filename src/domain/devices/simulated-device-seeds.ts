import {
  simulatedDeviceContextSchema,
  type SimulatedDeviceContext
} from "../../contracts/device-contract.js";
import type { SimulatedDeviceSeed } from "./device-types.js";

export const defaultObservedAt = "2026-06-07T08:30:00.000Z";

export const simulatedDeviceSeeds: SimulatedDeviceSeed[] = [
  {
    deviceId: "device-ac-living-room",
    displayName: "Living Room Air Conditioner",
    room: "living room",
    type: "air_conditioner",
    aliases: ["living room ac", "living room aircon", "air conditioner"],
    availability: {
      online: true
    },
    capabilities: ["read_power", "read_mode", "read_temperature", "set_power", "set_mode", "set_temperature"],
    readableValues: [
      {
        itemId: "power",
        name: "Power",
        metadata: {
          kind: "boolean",
          label: "Power"
        },
        value: true,
        freshness: "fresh",
        observedAt: defaultObservedAt
      },
      {
        itemId: "mode",
        name: "Mode",
        metadata: {
          kind: "enum",
          label: "Mode",
          options: ["cool", "heat", "fan", "dry"]
        },
        value: "cool",
        freshness: "fresh",
        observedAt: defaultObservedAt
      },
      {
        itemId: "target_temperature",
        name: "Target Temperature",
        metadata: {
          kind: "number",
          label: "Target temperature",
          unit: "celsius",
          min: 16,
          max: 30,
          step: 1
        },
        value: 24,
        freshness: "fresh",
        observedAt: defaultObservedAt
      },
      {
        itemId: "room_temperature",
        name: "Room Temperature",
        metadata: {
          kind: "number",
          label: "Room temperature",
          unit: "celsius"
        },
        value: 25.3,
        freshness: "fresh",
        observedAt: defaultObservedAt
      }
    ],
    writableControls: [
      {
        controlId: "power",
        name: "Power",
        metadata: {
          kind: "boolean",
          label: "Power"
        },
        currentValue: true,
        writable: true
      },
      {
        controlId: "mode",
        name: "Mode",
        metadata: {
          kind: "enum",
          label: "Mode",
          options: ["cool", "heat", "fan", "dry"]
        },
        currentValue: "cool",
        writable: true
      },
      {
        controlId: "target_temperature",
        name: "Target Temperature",
        metadata: {
          kind: "number",
          label: "Target temperature",
          unit: "celsius",
          min: 16,
          max: 30,
          step: 1
        },
        currentValue: 24,
        writable: true
      }
    ]
  },
  {
    deviceId: "device-light-hallway",
    displayName: "Hallway Light",
    room: "hallway",
    type: "light",
    aliases: ["hall light", "hallway lamp"],
    availability: {
      online: true
    },
    capabilities: ["read_power", "set_power"],
    readableValues: [
      {
        itemId: "power",
        name: "Power",
        metadata: {
          kind: "boolean",
          label: "Power"
        },
        value: false,
        freshness: "fresh",
        observedAt: defaultObservedAt
      }
    ],
    writableControls: [
      {
        controlId: "power",
        name: "Power",
        metadata: {
          kind: "boolean",
          label: "Power"
        },
        currentValue: false,
        writable: true
      }
    ]
  },
  {
    deviceId: "device-light-kitchen",
    displayName: "Kitchen Light",
    room: "kitchen",
    type: "light",
    aliases: ["kitchen lamp"],
    availability: {
      online: false,
      reason: "Device has not reported heartbeat in 15 minutes"
    },
    capabilities: ["read_power", "set_power"],
    readableValues: [
      {
        itemId: "power",
        name: "Power",
        metadata: {
          kind: "boolean",
          label: "Power"
        },
        freshness: "unknown"
      }
    ],
    writableControls: [
      {
        controlId: "power",
        name: "Power",
        metadata: {
          kind: "boolean",
          label: "Power"
        },
        writable: true
      }
    ]
  },
  {
    deviceId: "device-sensor-bedroom",
    displayName: "Bedroom Environmental Sensor",
    room: "bedroom",
    type: "environment_sensor",
    aliases: ["bedroom sensor", "bedroom temperature sensor", "bedroom humidity sensor"],
    availability: {
      online: true
    },
    capabilities: ["read_temperature", "read_humidity"],
    readableValues: [
      {
        itemId: "temperature",
        name: "Temperature",
        metadata: {
          kind: "number",
          label: "Temperature",
          unit: "celsius"
        },
        value: 23.1,
        freshness: "fresh",
        observedAt: defaultObservedAt
      },
      {
        itemId: "humidity",
        name: "Humidity",
        metadata: {
          kind: "number",
          label: "Humidity",
          unit: "percent"
        },
        value: 48,
        freshness: "fresh",
        observedAt: defaultObservedAt
      }
    ],
    writableControls: []
  },
  {
    deviceId: "device-light-bedroom",
    displayName: "Bedroom Light",
    room: "bedroom",
    type: "light",
    aliases: ["bedroom lamp"],
    availability: {
      online: true
    },
    capabilities: ["read_power", "set_power"],
    readableValues: [
      {
        itemId: "power",
        name: "Power",
        metadata: {
          kind: "boolean",
          label: "Power"
        },
        value: true,
        freshness: "fresh",
        observedAt: defaultObservedAt
      }
    ],
    writableControls: [
      {
        controlId: "power",
        name: "Power",
        metadata: {
          kind: "boolean",
          label: "Power"
        },
        currentValue: true,
        writable: true
      }
    ]
  }
];

export function toSimulatedDeviceContext(seed: SimulatedDeviceSeed): SimulatedDeviceContext {
  const { aliases: _aliases, ...context } = seed;

  return simulatedDeviceContextSchema.parse(structuredClone(context));
}

export function createSeedCatalog(seeds: SimulatedDeviceSeed[] = simulatedDeviceSeeds): SimulatedDeviceContext[] {
  return seeds.map(toSimulatedDeviceContext);
}
