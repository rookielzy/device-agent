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
    messages?: AgentMessageLike[];
    output?: unknown;
    content?: unknown;
  }>;
};

type AgentMessageLike = {
  content?: unknown;
  text?: unknown;
  kwargs?: {
    content?: unknown;
  };
  lc_kwargs?: {
    content?: unknown;
  };
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

      return parseAgentResult(result);
    } catch (error) {
      if (error instanceof ZodError) {
        return parseFailure("schema_invalid", error.issues[0]?.message ?? "structured proposal failed validation");
      }

      if (error instanceof MissingModelProposalError) {
        return parseFailure("missing_structured_response", "LangChain agent did not return structuredResponse or assistant JSON content");
      }

      if (error instanceof ModelOutputJsonParseError) {
        return parseFailure("structured_output_parse_failure", "LangChain agent returned content that was not valid proposal JSON");
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
    temperature: 0,
    modelKwargs: {
      response_format: {
        type: "json_object"
      }
    }
  });

  return createAgent({
    model,
    tools: input.tools,
    systemPrompt: input.systemPrompt
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

function parseAgentResult(result: Awaited<ReturnType<AgentInvoker["invoke"]>>): AgentProposal {
  if (result.structuredResponse !== undefined) {
    return parseAgentProposal(result.structuredResponse);
  }

  const content = extractAgentContent(result);
  if (content === undefined) {
    throw new MissingModelProposalError();
  }

  return parseAgentProposal(parseJsonContent(content));
}

function extractAgentContent(result: Awaited<ReturnType<AgentInvoker["invoke"]>>): unknown {
  if (result.output !== undefined) {
    return result.output;
  }

  if (result.content !== undefined) {
    return result.content;
  }

  const lastMessage = result.messages?.[result.messages.length - 1];
  if (!lastMessage) {
    return undefined;
  }

  return lastMessage.content ?? lastMessage.text ?? lastMessage.kwargs?.content ?? lastMessage.lc_kwargs?.content;
}

function parseJsonContent(content: unknown): unknown {
  if (isRecord(content)) {
    return content;
  }

  const text = contentToText(content);
  if (!text) {
    throw new MissingModelProposalError();
  }

  try {
    return JSON.parse(jsonObjectText(text));
  } catch {
    throw new ModelOutputJsonParseError();
  }
}

function contentToText(content: unknown): string | undefined {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return undefined;
  }

  const text = content.flatMap((part) => {
    if (typeof part === "string") {
      return [part];
    }

    if (!isRecord(part)) {
      return [];
    }

    if (typeof part.text === "string") {
      return [part.text];
    }

    if (typeof part.content === "string") {
      return [part.content];
    }

    return [];
  }).join("");

  return text.trim() ? text : undefined;
}

function jsonObjectText(text: string): string {
  let trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced?.[1]) {
    trimmed = fenced[1].trim();
  }

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");

  return start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

class MissingModelProposalError extends Error {
  constructor() {
    super("Missing model proposal content");
  }
}

class ModelOutputJsonParseError extends Error {
  constructor() {
    super("Model proposal content was not valid JSON");
  }
}
