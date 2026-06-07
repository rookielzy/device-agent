import type { AppConfig } from "../config/env.js";
import { SimulatedDeviceService } from "../domain/devices/simulated-device-service.js";
import type { AgentInterpreter } from "./agent-interpreter.js";
import { FakeInterpreter } from "./fake-interpreter.js";
import {
  LangChainDeepSeekInterpreter,
  type AgentInvoker,
  type CreateDeepSeekAgentInput
} from "./langchain-deepseek-interpreter.js";

export type CreateAgentInterpreterOptions = {
  config: AppConfig;
  deviceService?: Pick<SimulatedDeviceService, "readStatus" | "proposeControl" | "debugSnapshot">;
  deepseekAgent?: AgentInvoker;
  deepseekAgentFactory?: (input: CreateDeepSeekAgentInput) => AgentInvoker;
};

export function createAgentInterpreter(options: CreateAgentInterpreterOptions): AgentInterpreter {
  switch (options.config.interpreterMode) {
    case "fake":
      return new FakeInterpreter();
    case "deepseek":
      if (!options.config.deepseek.apiKey) {
        throw new Error("DeepSeek interpreter requires an apiKey in parsed AppConfig");
      }

      return new LangChainDeepSeekInterpreter({
        apiKey: options.config.deepseek.apiKey,
        model: options.config.deepseek.model,
        ...(options.deviceService ? { deviceService: options.deviceService } : {}),
        ...(options.deepseekAgent ? { agent: options.deepseekAgent } : {}),
        ...(options.deepseekAgentFactory ? { agentFactory: options.deepseekAgentFactory } : {})
      });
  }
}
