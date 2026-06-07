import type { SimulatedDeviceContext } from "../../src/contracts/device-contract.js";
import type { TaskResult } from "../../src/contracts/task-contract.js";

export const observedAt = "2026-06-07T08:30:00.000Z";

export const livingRoomAirConditioner: SimulatedDeviceContext = {
  deviceId: "device-ac-living-room",
  displayName: "Living Room Air Conditioner",
  room: "living room",
  type: "air_conditioner",
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
      observedAt
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
      observedAt
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
      observedAt
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
      observedAt
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
};

export const hallwayLight: SimulatedDeviceContext = {
  deviceId: "device-light-hallway",
  displayName: "Hallway Light",
  room: "hallway",
  type: "light",
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
      observedAt
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
};

export const bedroomSensor: SimulatedDeviceContext = {
  deviceId: "device-sensor-bedroom",
  displayName: "Bedroom Environmental Sensor",
  room: "bedroom",
  type: "environment_sensor",
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
      observedAt
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
      observedAt
    }
  ],
  writableControls: []
};

export const offlineKitchenLight: SimulatedDeviceContext = {
  deviceId: "device-light-kitchen",
  displayName: "Kitchen Light",
  room: "kitchen",
  type: "light",
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
};

const baseTimeline = [
  {
    eventId: "evt-001",
    stage: "request_received" as const,
    source: "client" as const,
    status: "succeeded" as const,
    at: "2026-06-07T08:31:00.000Z",
    detail: "Received user text"
  },
  {
    eventId: "evt-002",
    stage: "model_interpretation" as const,
    source: "model" as const,
    status: "succeeded" as const,
    at: "2026-06-07T08:31:01.000Z",
    detail: "Classified request into normalized task intent"
  },
  {
    eventId: "evt-003",
    stage: "device_resolution" as const,
    source: "service" as const,
    status: "succeeded" as const,
    at: "2026-06-07T08:31:02.000Z",
    detail: "Resolved simulated device context"
  }
];

export const statusQueryTaskResult: TaskResult = {
  taskId: "task-status-001",
  originalText: "Is the living room air conditioner running?",
  classification: "status_query",
  executionState: "completed",
  reply: "The living room air conditioner is on, cooling to 24 celsius. The room is currently 25.3 celsius.",
  userReply: "The living room air conditioner is on, cooling to 24 celsius. The room is currently 25.3 celsius.",
  plan: {
    summary: "Answer the living room air conditioner status from simulated readable values.",
    confidence: 0.94,
    steps: [
      {
        stepId: "step-1",
        description: "Resolve the living room air conditioner",
        status: "completed"
      },
      {
        stepId: "step-2",
        description: "Read power, mode, target temperature, and room temperature",
        status: "completed"
      }
    ]
  },
  selectedContext: {
    devices: [livingRoomAirConditioner],
    dataItems: [
      {
        deviceId: livingRoomAirConditioner.deviceId,
        itemId: "power",
        name: "Power",
        value: true,
        freshness: "fresh"
      },
      {
        deviceId: livingRoomAirConditioner.deviceId,
        itemId: "mode",
        name: "Mode",
        value: "cool",
        freshness: "fresh"
      },
      {
        deviceId: livingRoomAirConditioner.deviceId,
        itemId: "target_temperature",
        name: "Target Temperature",
        value: 24,
        freshness: "fresh"
      },
      {
        deviceId: livingRoomAirConditioner.deviceId,
        itemId: "room_temperature",
        name: "Room Temperature",
        value: 25.3,
        freshness: "fresh"
      }
    ],
    controlItems: [],
    candidates: []
  },
  selectedDataItems: [
    {
      deviceId: livingRoomAirConditioner.deviceId,
      itemId: "power",
      name: "Power",
      value: true,
      freshness: "fresh"
    }
  ],
  selectedControlItems: [],
  timeline: [
    ...baseTimeline,
    {
      eventId: "evt-004",
      stage: "simulated_read",
      source: "simulated_device",
      status: "succeeded",
      at: "2026-06-07T08:31:03.000Z",
      detail: "Read simulated air conditioner values"
    },
    {
      eventId: "evt-005",
      stage: "final_outcome",
      source: "service",
      status: "succeeded",
      at: "2026-06-07T08:31:04.000Z",
      detail: "Returned completed status query"
    }
  ]
};

export const pendingControlTaskResult: TaskResult = {
  taskId: "task-control-001",
  originalText: "Turn on the hallway light",
  classification: "control_request",
  executionState: "pending_confirmation",
  reply: "Please confirm: turn on the hallway light.",
  plan: {
    summary: "Prepare a confirmable control request for the hallway light.",
    confidence: 0.91,
    steps: [
      {
        stepId: "step-1",
        description: "Resolve the hallway light",
        status: "completed"
      },
      {
        stepId: "step-2",
        description: "Create a pending confirmation instead of mutating state",
        status: "completed"
      }
    ]
  },
  selectedContext: {
    devices: [hallwayLight],
    dataItems: [],
    controlItems: [
      {
        deviceId: hallwayLight.deviceId,
        controlId: "power",
        name: "Power",
        requestedValue: true,
        metadata: {
          kind: "boolean",
          label: "Power"
        }
      }
    ],
    candidates: []
  },
  selectedDataItems: [],
  selectedControlItems: [
    {
      deviceId: hallwayLight.deviceId,
      controlId: "power",
      name: "Power",
      requestedValue: true,
      metadata: {
        kind: "boolean",
        label: "Power"
      }
    }
  ],
  pendingControl: {
    pendingControlId: "pending-control-001",
    target: {
      deviceId: hallwayLight.deviceId,
      controlId: "power",
      name: "Power",
      requestedValue: true,
      metadata: {
        kind: "boolean",
        label: "Power"
      }
    },
    confirmationSummary: "Turn on the hallway light",
    expectedEffect: "The hallway light power value will change from off to on.",
    expiresAt: "2026-06-07T08:41:00.000Z"
  },
  timeline: [
    ...baseTimeline,
    {
      eventId: "evt-004",
      stage: "confirmation_required",
      source: "service",
      status: "waiting",
      at: "2026-06-07T08:31:03.000Z",
      detail: "Created pending control request; simulated state has not changed"
    },
    {
      eventId: "evt-005",
      stage: "final_outcome",
      source: "service",
      status: "waiting",
      at: "2026-06-07T08:31:04.000Z",
      detail: "Returned pending confirmation outcome"
    }
  ]
};

export const ambiguousTaskResult: TaskResult = {
  taskId: "task-ambiguous-001",
  originalText: "What is the bedroom device doing?",
  classification: "ambiguous",
  executionState: "needs_clarification",
  reply: "I found multiple bedroom devices. Which one should I use?",
  plan: {
    summary: "Ask for clarification because multiple simulated devices match the request.",
    confidence: 0.52,
    ambiguityReason: "The request mentions bedroom device but does not choose between sensor and other possible bedroom devices.",
    steps: [
      {
        stepId: "step-1",
        description: "Collect candidate bedroom devices",
        status: "completed"
      },
      {
        stepId: "step-2",
        description: "Avoid selecting an executable action",
        status: "completed"
      }
    ]
  },
  selectedContext: {
    devices: [],
    dataItems: [],
    controlItems: [],
    candidates: [bedroomSensor, hallwayLight]
  },
  selectedDataItems: [],
  selectedControlItems: [],
  timeline: [
    ...baseTimeline,
    {
      eventId: "evt-004",
      stage: "service_validation",
      source: "service",
      status: "blocked",
      at: "2026-06-07T08:31:03.000Z",
      detail: "Multiple candidates require clarification"
    },
    {
      eventId: "evt-005",
      stage: "final_outcome",
      source: "service",
      status: "blocked",
      at: "2026-06-07T08:31:04.000Z",
      detail: "Returned clarification request"
    }
  ]
};

export const unavailableTaskResult: TaskResult = {
  taskId: "task-unavailable-001",
  originalText: "Turn on the kitchen light",
  classification: "control_request",
  executionState: "unavailable",
  reply: "I cannot control the kitchen light because it is offline.",
  plan: {
    summary: "Report unavailable simulated device state instead of creating a pending control.",
    confidence: 0.88,
    steps: [
      {
        stepId: "step-1",
        description: "Resolve the kitchen light",
        status: "completed"
      },
      {
        stepId: "step-2",
        description: "Block control because the device is offline",
        status: "blocked"
      }
    ]
  },
  selectedContext: {
    devices: [offlineKitchenLight],
    dataItems: [],
    controlItems: [],
    candidates: []
  },
  selectedDataItems: [],
  selectedControlItems: [],
  timeline: [
    ...baseTimeline,
    {
      eventId: "evt-004",
      stage: "service_validation",
      source: "service",
      status: "blocked",
      at: "2026-06-07T08:31:03.000Z",
      detail: "Device is offline"
    },
    {
      eventId: "evt-005",
      stage: "final_outcome",
      source: "service",
      status: "blocked",
      at: "2026-06-07T08:31:04.000Z",
      detail: "Returned unavailable outcome without mutation"
    }
  ]
};

export const langChainSpecificPayload = {
  ...statusQueryTaskResult,
  messages: [{ role: "assistant", content: "raw message" }],
  tool_calls: [{ id: "call-001", name: "read_device" }],
  run: { id: "run-001" }
};
