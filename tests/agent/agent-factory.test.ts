import { describe, expect, it } from "vitest";
import { createAgentInterpreter } from "../../src/agent/agent-factory.js";
import type { DeviceToolResult } from "../../src/agent/device-tools.js";
import { FakeInterpreter } from "../../src/agent/fake-interpreter.js";
import { LangChainDeepSeekInterpreter } from "../../src/agent/langchain-deepseek-interpreter.js";
import type { DeviceReadResult } from "../../src/domain/devices/device-results.js";
import { parseEnv, type AppConfig } from "../../src/config/env.js";
import { SimulatedDeviceService } from "../../src/domain/devices/simulated-device-service.js";
import { livingRoomStatusProposal } from "../fixtures/task-fixtures.js";

describe("createAgentInterpreter", () => {
  it("creates fake interpreter without requiring DeepSeek credentials", () => {
    const interpreter = createAgentInterpreter({
      config: parseEnv({
        AGENT_INTERPRETER_MODE: "fake"
      })
    });

    expect(interpreter).toBeInstanceOf(FakeInterpreter);
  });

  it("creates DeepSeek interpreter from parsed config and injected dependencies", async () => {
    const calls: unknown[] = [];
    const config: AppConfig = {
      host: "127.0.0.1",
      port: 3000,
      interpreterMode: "deepseek",
      deepseek: {
        apiKey: "test-key",
        model: "deepseek-test"
      },
      enableDebugSimulatedDevices: false
    };
    const interpreter = createAgentInterpreter({
      config,
      deviceService: new SimulatedDeviceService(),
      deepseekAgentFactory: (input) => {
        calls.push(input);

        return {
          async invoke() {
            return {
              structuredResponse: livingRoomStatusProposal
            };
          }
        };
      }
    });

    expect(interpreter).toBeInstanceOf(LangChainDeepSeekInterpreter);
    await interpreter.interpret({
      originalText: "Is the living room air conditioner running?"
    });
    expect(calls[0]).toMatchObject({
      apiKey: "test-key",
      model: "deepseek-test"
    });
  });

  it("passes injected device service into DeepSeek tool construction", async () => {
    const calls: string[] = [];
    const config: AppConfig = {
      host: "127.0.0.1",
      port: 3000,
      interpreterMode: "deepseek",
      deepseek: {
        apiKey: "test-key",
        model: "deepseek-test"
      },
      enableDebugSimulatedDevices: false
    };
    const deviceService = {
      readStatus(): DeviceReadResult {
        calls.push("readStatus");

        return {
          kind: "not_found",
          reason: "device_not_found",
          message: "stubbed service was used"
        };
      },
      proposeControl: new SimulatedDeviceService().proposeControl.bind(new SimulatedDeviceService()),
      debugSnapshot: new SimulatedDeviceService().debugSnapshot.bind(new SimulatedDeviceService())
    };
    let readTool: { invoke(input: unknown): Promise<DeviceToolResult> } | undefined;
    const interpreter = createAgentInterpreter({
      config,
      deviceService,
      deepseekAgentFactory: (input) => {
        readTool = input.tools[0] as { invoke(input: unknown): Promise<DeviceToolResult> };

        return {
          async invoke() {
            await readTool!.invoke({
              phrase: "Is the living room air conditioner running?"
            });

            return {
              structuredResponse: livingRoomStatusProposal
            };
          }
        };
      }
    });

    await interpreter.interpret({
      originalText: "Is the living room air conditioner running?"
    });

    expect(calls).toEqual(["readStatus"]);
  });

  it("keeps unknown interpreter modes rejected by parseEnv", () => {
    expect(() =>
      parseEnv({
        AGENT_INTERPRETER_MODE: "other"
      })
    ).toThrow();
  });
});
