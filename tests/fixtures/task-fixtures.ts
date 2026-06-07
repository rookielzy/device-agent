import type { AgentInterpreter, AgentProposal } from "../../src/agent/agent-interpreter.js";

export function createSequenceInterpreter(proposals: AgentProposal[]): AgentInterpreter {
  const queue = [...proposals];

  return {
    interpret() {
      const next = queue.shift();

      if (!next) {
        throw new Error("No fake proposal queued");
      }

      return next;
    }
  };
}

export function createFixedInterpreter(proposal: AgentProposal): AgentInterpreter {
  return createSequenceInterpreter([proposal]);
}

export function createIdSequence(prefix: string): () => string {
  let next = 1;

  return () => `${prefix}-${String(next++).padStart(3, "0")}`;
}

export const fixedNow = new Date("2026-06-07T09:00:00.000Z");

export function createFixedClock(now = fixedNow): () => Date {
  return () => new Date(now);
}

export function createMutableClock(initial = fixedNow): {
  clock: () => Date;
  set: (next: Date) => void;
} {
  let current = initial;

  return {
    clock: () => new Date(current),
    set: (next) => {
      current = next;
    }
  };
}

export const livingRoomStatusProposal: AgentProposal = {
  kind: "status_query",
  target: {
    room: "living room",
    deviceType: "air_conditioner",
    phrase: "Is the living room air conditioner running?"
  },
  summary: "Answer the living room air conditioner status from simulated readable values.",
  confidence: 0.94
};

export const vagueBedroomStatusProposal: AgentProposal = {
  kind: "status_query",
  target: {
    phrase: "What is the bedroom device doing?"
  },
  summary: "Resolve the bedroom device status if possible.",
  confidence: 0.52
};

export const offlineKitchenControlProposal: AgentProposal = {
  kind: "control_request",
  target: {
    room: "kitchen",
    deviceType: "light",
    controlItem: "power",
    requestedValue: true
  },
  confirmationSummary: "Turn on the kitchen light",
  confidence: 0.88
};

export const hallwayLightOnProposal: AgentProposal = {
  kind: "control_request",
  target: {
    room: "hallway",
    deviceType: "light",
    controlItem: "power",
    requestedValue: true
  },
  confirmationSummary: "turn on the hallway light",
  summary: "Prepare a confirmable hallway-light control request.",
  confidence: 0.91
};

export const readOnlySensorControlProposal: AgentProposal = {
  kind: "control_request",
  target: {
    room: "bedroom",
    deviceType: "environment_sensor",
    controlItem: "temperature",
    requestedValue: 19
  },
  confidence: 0.7
};

export const invalidHallwayControlProposal: AgentProposal = {
  kind: "control_request",
  target: {
    room: "hallway",
    deviceType: "light",
    controlItem: "power",
    requestedValue: "yes"
  },
  confidence: 0.8
};

export const parseFailureProposal: AgentProposal = {
  kind: "parse_failure",
  reason: "missing_intent",
  detail: "No supported status or control intent was present",
  confidence: 0
};
