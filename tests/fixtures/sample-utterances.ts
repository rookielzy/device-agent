import type { AgentProposal, AgentProposalKind } from "../../src/agent/agent-interpreter.js";
import {
  hallwayLightOnProposal,
  livingRoomStatusProposal,
  offlineKitchenControlProposal,
  parseFailureProposal,
  readOnlySensorControlProposal,
  vagueBedroomStatusProposal
} from "./task-fixtures.js";

export type SampleUtterance = {
  id: string;
  text: string;
  expectedKind: AgentProposalKind;
  expectedProposal: Partial<AgentProposal>;
  targetHint?: string;
};

export const sampleUtterances = [
  {
    id: "ae1-living-room-ac-status",
    text: "Is the living room air conditioner running?",
    expectedKind: livingRoomStatusProposal.kind,
    expectedProposal: livingRoomStatusProposal,
    targetHint: "living room air conditioner"
  },
  {
    id: "ae2-hallway-light-on",
    text: "Turn on the hallway light",
    expectedKind: hallwayLightOnProposal.kind,
    expectedProposal: hallwayLightOnProposal,
    targetHint: "hallway light"
  },
  {
    id: "ae3-unconfirmed-hallway-light",
    text: "Please switch the hallway lamp on but wait for confirmation",
    expectedKind: hallwayLightOnProposal.kind,
    expectedProposal: hallwayLightOnProposal,
    targetHint: "hallway light"
  },
  {
    id: "ae4-offline-kitchen-light",
    text: "Turn on the kitchen light",
    expectedKind: offlineKitchenControlProposal.kind,
    expectedProposal: offlineKitchenControlProposal,
    targetHint: "kitchen light"
  },
  {
    id: "ae5-vague-bedroom-device",
    text: "What is the bedroom device doing?",
    expectedKind: vagueBedroomStatusProposal.kind,
    expectedProposal: vagueBedroomStatusProposal,
    targetHint: "bedroom"
  },
  {
    id: "read-only-bedroom-sensor-write",
    text: "Set the bedroom sensor temperature to 19",
    expectedKind: readOnlySensorControlProposal.kind,
    expectedProposal: readOnlySensorControlProposal,
    targetHint: "bedroom sensor"
  },
  {
    id: "unsupported-sensor-write",
    text: "Set the hallway light humidity to 40 percent",
    expectedKind: "unsupported",
    expectedProposal: {
      kind: "unsupported",
      reason: "Hallway light humidity is not a supported simulated-device operation.",
      target: {
        room: "hallway",
        deviceType: "light",
        dataItem: "humidity"
      }
    },
    targetHint: "hallway light humidity"
  },
  {
    id: "nonsensical-input",
    text: "Blue banana entropy please",
    expectedKind: parseFailureProposal.kind,
    expectedProposal: parseFailureProposal
  }
] satisfies SampleUtterance[];

export const sampleUtteranceTexts = sampleUtterances.map((utterance) => utterance.text);

export function sampleTextFor(id: string): string {
  const utterance = sampleUtterances.find((candidate) => candidate.id === id);

  if (!utterance) {
    throw new Error(`Missing sample utterance ${id}`);
  }

  return utterance.text;
}
