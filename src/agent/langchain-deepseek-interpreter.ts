import { ChatDeepSeek } from "@langchain/deepseek";
import { createAgent, StructuredOutputParsingError } from "langchain";
import { ZodError } from "zod";
import type { AgentInterpreter, AgentInterpreterInput } from "./agent-interpreter.js";
import {
  buildInterpreterUserPrompt,
  DEEPSEEK_INTERPRETER_SYSTEM_PROMPT,
  DEEPSEEK_PLATFORM_INTERPRETER_SYSTEM_PROMPT
} from "./agent-prompts.js";
import {
  agentProposalSchema,
  parseAgentProposal,
  type AgentProposal
} from "./agent-schemas.js";
import { createDeviceTools, type DeviceToolSet } from "./device-tools.js";
import { createPlatformDeviceTools, type PlatformDeviceToolSet } from "./platform-device-tools.js";
import { SimulatedDeviceService } from "../domain/devices/simulated-device-service.js";
import type { PlatformCapabilityService } from "../domain/platform/platform-capability-service.js";

export type AgentInvoker = {
  invoke(input: { messages: Array<{ role: "user"; content: string }> }): Promise<{
    structuredResponse?: unknown;
  }>;
};

export type LangChainDeepSeekInterpreterOptions = {
  apiKey: string;
  model: string;
  deviceService?: Pick<SimulatedDeviceService, "readStatus" | "proposeControl" | "debugSnapshot">;
  platformService?: Pick<PlatformCapabilityService, "listProjectsOrAreas" | "searchDevices" | "getEquipmentDetail" | "getRuntimeParams" | "readAirConditionerStatus">;
  deviceCapabilityMode?: "simulated" | "platform";
  agent?: AgentInvoker;
  agentFactory?: (input: CreateDeepSeekAgentInput) => AgentInvoker;
};

export type CreateDeepSeekAgentInput = {
  apiKey: string;
  model: string;
  tools: DeviceToolSet | PlatformDeviceToolSet;
  systemPrompt: string;
};

export class LangChainDeepSeekInterpreter implements AgentInterpreter {
  readonly #agent: AgentInvoker;

  constructor(options: LangChainDeepSeekInterpreterOptions) {
    const deviceCapabilityMode = options.deviceCapabilityMode ?? "simulated";
    this.#agent =
      options.agent ??
      (options.agentFactory ?? createDeepSeekAgent)({
        apiKey: options.apiKey,
        model: options.model,
        tools: deviceCapabilityMode === "platform"
          ? createPlatformDeviceTools(requirePlatformService(options.platformService))
          : createDeviceTools(options.deviceService ?? new SimulatedDeviceService()),
        systemPrompt: deviceCapabilityMode === "platform"
          ? DEEPSEEK_PLATFORM_INTERPRETER_SYSTEM_PROMPT
          : DEEPSEEK_INTERPRETER_SYSTEM_PROMPT
      });
    this.#deviceCapabilityMode = deviceCapabilityMode;
  }

  readonly #deviceCapabilityMode: "simulated" | "platform";

  async interpret(input: AgentInterpreterInput): Promise<AgentProposal> {
    try {
      const result = await this.#agent.invoke({
        messages: [
          {
            role: "user",
            content: buildInterpreterUserPrompt(input.originalText, {
              platformMode: this.#deviceCapabilityMode === "platform"
            })
          }
        ]
      });

      if (result.structuredResponse === undefined) {
        return parseFailure("missing_structured_response", "LangChain agent did not return structuredResponse");
      }

      return parseAgentProposal(result.structuredResponse);
    } catch (error) {
      if (error instanceof ZodError) {
        return parseFailure("schema_invalid", error.issues[0]?.message ?? "structured proposal failed validation");
      }

      if (error instanceof StructuredOutputParsingError) {
        return parseFailure("structured_output_parse_failure", "LangChain could not parse model output as the proposal schema");
      }

      if (error instanceof Error) {
        return parseFailure("adapter_error", "LangChain adapter failed to interpret the request");
      }

      return parseFailure("adapter_error", "LangChain adapter failed to interpret the request");
    }
  }
}

export function createDeepSeekAgent(input: CreateDeepSeekAgentInput): AgentInvoker {
  const model = new ChatDeepSeek({
    apiKey: input.apiKey,
    model: input.model,
    temperature: 0
  });

  return createAgent({
    model,
    tools: input.tools,
    systemPrompt: input.systemPrompt,
    responseFormat: agentProposalSchema
  });
}

function requirePlatformService(
  platformService: LangChainDeepSeekInterpreterOptions["platformService"]
): Pick<PlatformCapabilityService, "listProjectsOrAreas" | "searchDevices" | "getEquipmentDetail" | "getRuntimeParams" | "readAirConditionerStatus"> {
  if (!platformService) {
    throw new Error("Platform device capability mode requires a platformService");
  }

  return platformService;
}

function parseFailure(reason: string, detail: string): AgentProposal {
  return {
    kind: "parse_failure",
    reason,
    detail,
    confidence: 0
  };
}
