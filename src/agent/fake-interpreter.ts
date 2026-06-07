import type { AgentInterpreter, AgentInterpreterInput } from "./agent-interpreter.js";
import type { AgentProposal } from "./agent-schemas.js";

export class FakeInterpreter implements AgentInterpreter {
  interpret(input: AgentInterpreterInput): AgentProposal {
    return interpretFake(input.originalText);
  }
}

export function interpretFake(originalText: string): AgentProposal {
  const normalized = normalize(originalText);

  if (isNonsensical(normalized)) {
    return {
      kind: "parse_failure",
      reason: "missing_intent",
      detail: "No supported status or control intent was present",
      confidence: 0
    };
  }

  if (mentions(normalized, ["bedroom"]) && mentions(normalized, ["device"]) && asksStatus(normalized) && !mentionsBedroomType(normalized)) {
    return {
      kind: "status_query",
      target: {
        phrase: originalText
      },
      summary: "Resolve the bedroom device status if possible.",
      confidence: 0.52
    };
  }

  if (mentions(normalized, ["hallway", "hall"]) && mentions(normalized, ["humidity"])) {
    return {
      kind: "unsupported",
      reason: "Hallway light humidity is not a supported simulated-device operation.",
      target: {
        room: "hallway",
        deviceType: "light",
        dataItem: "humidity",
        phrase: originalText
      },
      confidence: 0.44
    };
  }

  if (mentions(normalized, ["bedroom"]) && mentions(normalized, ["sensor"]) && isControlIntent(normalized)) {
    return {
      kind: "control_request",
      target: {
        room: "bedroom",
        deviceType: "environment_sensor",
        controlItem: "temperature",
        requestedValue: inferNumber(normalized) ?? 19,
        phrase: originalText
      },
      summary: "Prepare the requested sensor write so service validation can reject read-only controls.",
      confidence: 0.7
    };
  }

  if (mentions(normalized, ["kitchen"]) && mentions(normalized, ["light", "lamp"]) && isControlIntent(normalized)) {
    return {
      kind: "control_request",
      target: {
        room: "kitchen",
        deviceType: "light",
        controlItem: "power",
        requestedValue: inferPower(normalized) ?? true,
        phrase: originalText
      },
      confirmationSummary: `${inferPower(normalized) === false ? "Turn off" : "Turn on"} the kitchen light`,
      summary: "Prepare a confirmable kitchen-light control request for service validation.",
      confidence: 0.88
    };
  }

  if (mentions(normalized, ["hallway", "hall"]) && mentions(normalized, ["light", "lamp"]) && isControlIntent(normalized)) {
    return {
      kind: "control_request",
      target: {
        room: "hallway",
        deviceType: "light",
        controlItem: "power",
        requestedValue: inferPower(normalized) ?? true,
        phrase: originalText
      },
      confirmationSummary: `${inferPower(normalized) === false ? "turn off" : "turn on"} the hallway light`,
      summary: "Prepare a confirmable hallway-light control request.",
      confidence: 0.91
    };
  }

  if (mentions(normalized, ["living room"]) && mentions(normalized, ["air conditioner", "aircon", "ac"]) && asksStatus(normalized)) {
    return {
      kind: "status_query",
      target: {
        room: "living room",
        deviceType: "air_conditioner",
        phrase: originalText
      },
      summary: "Answer the living room air conditioner status from simulated readable values.",
      confidence: 0.94
    };
  }

  if (asksStatus(normalized)) {
    return {
      kind: "unsupported",
      reason: "No supported simulated status target was recognized.",
      target: {
        phrase: originalText
      },
      confidence: 0.35
    };
  }

  return {
    kind: "parse_failure",
    reason: "missing_intent",
    detail: "No supported status or control intent was present",
    confidence: 0
  };
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function isNonsensical(normalized: string): boolean {
  return normalized.length === 0 || mentions(normalized, ["blue banana", "entropy please", "nonsense"]);
}

function mentions(value: string, terms: string[]): boolean {
  return terms.some((term) => value.includes(term));
}

function asksStatus(value: string): boolean {
  return (
    /(^|\s)(is|are|what|how|show|tell|status|running|doing)(\s|$)/.test(value) ||
    value.includes("current")
  );
}

function isControlIntent(value: string): boolean {
  return /(^|\s)(turn|switch|set|enable|disable|start|stop)(\s|$)/.test(value);
}

function mentionsBedroomType(value: string): boolean {
  return mentions(value, ["sensor", "light", "lamp"]);
}

function inferPower(value: string): boolean | undefined {
  if (/\b(on|enable|enabled|start|turn on|switch on)\b/.test(value)) {
    return true;
  }

  if (/\b(off|disable|disabled|stop|turn off|switch off)\b/.test(value)) {
    return false;
  }

  return undefined;
}

function inferNumber(value: string): number | undefined {
  const match = /\b(\d+(?:\.\d+)?)\b/.exec(value);

  return match?.[1] ? Number(match[1]) : undefined;
}
