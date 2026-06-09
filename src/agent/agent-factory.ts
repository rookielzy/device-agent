import type { AppConfig } from "../config/env.js";
import { SimulatedDeviceService } from "../domain/devices/simulated-device-service.js";
import type { AgentInterpreter } from "./agent-interpreter.js";
import type { PlatformCapabilityService } from "../domain/platform/platform-capability-service.js";
import { FakeInterpreter } from "./fake-interpreter.js";
import {
  LangChainDeepSeekInterpreter,
  type AgentInvoker,
  type CreateDeepSeekAgentInput
} from "./langchain-deepseek-interpreter.js";
import type { Tracer } from "../observability/trace.js";

export type CreateAgentInterpreterOptions = {
  config: AppConfig;
  deviceService?: Pick<SimulatedDeviceService, "readStatus" | "proposeControl" | "debugSnapshot">;
  platformService?: Pick<PlatformCapabilityService, "listProjectsOrAreas" | "searchDevices" | "getEquipmentDetail" | "getRuntimeParams" | "readAirConditionerStatus">;
  deepseekAgent?: AgentInvoker;
  deepseekAgentFactory?: (input: CreateDeepSeekAgentInput) => AgentInvoker;
  tracer?: Tracer;
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
        deviceCapabilityMode: options.config.deviceCapabilityMode,
        ...(options.deviceService ? { deviceService: options.deviceService } : {}),
        ...(options.platformService ? { platformService: options.platformService } : {}),
        ...(options.deepseekAgent ? { agent: options.deepseekAgent } : {}),
        ...(options.deepseekAgentFactory ? { agentFactory: options.deepseekAgentFactory } : {}),
        ...(options.tracer ? { tracer: options.tracer } : {})
      });
  }
}
