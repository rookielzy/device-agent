import { ChatDeepSeek } from "@langchain/deepseek";
import { createAgent, StructuredOutputParsingError } from "langchain";
import { ZodError } from "zod";
import type { AgentInterpreter, AgentInterpreterInput } from "./agent-interpreter.js";
import { buildInterpreterUserPrompt, DEEPSEEK_INTERPRETER_SYSTEM_PROMPT } from "./agent-prompts.js";
import {
  agentProposalSchema,
  parseAgentProposal,
  type AgentProposal
} from "./agent-schemas.js";
import { createDeviceTools, type DeviceToolSet } from "./device-tools.js";
import { SimulatedDeviceService } from "../domain/devices/simulated-device-service.js";

export type AgentInvoker = {
  invoke(input: { messages: Array<{ role: "user"; content: string }> }): Promise<{
    structuredResponse?: unknown;
  }>;
};

export type LangChainDeepSeekInterpreterOptions = {
  apiKey: string;
  model: string;
  deviceService?: Pick<SimulatedDeviceService, "readStatus" | "proposeControl" | "debugSnapshot">;
  agent?: AgentInvoker;
  agentFactory?: (input: CreateDeepSeekAgentInput) => AgentInvoker;
  timeoutMs?: number;
};

export type CreateDeepSeekAgentInput = {
  apiKey: string;
  model: string;
  tools: DeviceToolSet;
};

export class LangChainDeepSeekInterpreter implements AgentInterpreter {
  readonly #agent: AgentInvoker;
  readonly #timeoutMs: number;

  constructor(options: LangChainDeepSeekInterpreterOptions) {
    this.#timeoutMs = options.timeoutMs ?? 30_000;
    this.#agent =
      options.agent ??
      (options.agentFactory ?? createDeepSeekAgent)({
        apiKey: options.apiKey,
        model: options.model,
        tools: createDeviceTools(options.deviceService ?? new SimulatedDeviceService())
      });
  }

  async interpret(input: AgentInterpreterInput): Promise<AgentProposal> {
    try {
      const result = await withTimeout(
        this.#agent.invoke({
          messages: [
            {
              role: "user",
              content: buildInterpreterUserPrompt(input.originalText)
            }
          ]
        }),
        this.#timeoutMs
      );

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

      if (error instanceof InterpreterTimeoutError) {
        return parseFailure("adapter_timeout", "LangChain adapter timed out while interpreting the request");
      }

      if (error instanceof Error) {
        return parseFailure("adapter_error", "LangChain adapter failed to interpret the request");
      }

      return parseFailure("adapter_error", "LangChain adapter failed to interpret the request");
    }
  }
}

class InterpreterTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`LangChain adapter timed out after ${timeoutMs}ms`);
    this.name = "InterpreterTimeoutError";
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
    systemPrompt: DEEPSEEK_INTERPRETER_SYSTEM_PROMPT,
    responseFormat: agentProposalSchema
  });
}

function parseFailure(reason: string, detail: string): AgentProposal {
  return {
    kind: "parse_failure",
    reason,
    detail,
    confidence: 0
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new InterpreterTimeoutError(timeoutMs));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error);
      }
    );
  });
}
