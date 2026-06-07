import type { AgentProposal } from "./agent-schemas.js";

export {
  agentProposalSchema,
  ambiguousProposalSchema,
  controlRequestProposalSchema,
  controlTargetSchema,
  deviceTargetSchema,
  parseAgentProposal,
  parseFailureProposalSchema,
  statusQueryProposalSchema,
  toControlTarget,
  toDeviceTarget,
  unsupportedProposalSchema,
  type AgentProposal,
  type AgentProposalKind,
  type ControlProposalTarget,
  type DeviceProposalTarget
} from "./agent-schemas.js";

export type AgentInterpreterInput = {
  originalText: string;
};

export type AgentInterpreter = {
  interpret(input: AgentInterpreterInput): AgentProposal | Promise<AgentProposal>;
};
