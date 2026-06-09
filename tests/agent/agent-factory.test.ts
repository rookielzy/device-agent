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
      deviceCapabilityMode: "simulated",
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
      deviceCapabilityMode: "simulated",
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

  it("passes platform service into DeepSeek tool construction when platform mode is configured", async () => {
    const calls: string[] = [];
    const config: AppConfig = {
      host: "127.0.0.1",
      port: 3000,
      interpreterMode: "deepseek",
      deviceCapabilityMode: "platform",
      deepseek: {
        apiKey: "test-key",
        model: "deepseek-test"
      },
      platform: {
        userCenterBaseUrl: "https://user.example.test",
        iotBaseUrl: "https://iot.example.test",
        validationMobile: "13800000000",
        validationPassword: "secret",
        validationProjectId: "270544150790145",
        requestTimeoutMs: 5000
      },
      enableDebugSimulatedDevices: false
    };
    const platformService = {
      async listProjectsOrAreas() {
        return {
          kind: "project_list_success" as const,
          projects: []
        };
      },
      async searchDevices() {
        return {
          kind: "search_success" as const,
          raw: [],
          candidates: []
        };
      },
      async getEquipmentDetail() {
        return {
          kind: "unavailable" as const,
          reason: "platform_no_data" as const,
          message: "No data",
          stage: "platform_detail" as const
        };
      },
      async getRuntimeParams() {
        return [];
      },
      async readAirConditionerStatus() {
        calls.push("readAirConditionerStatus");

        return {
          kind: "unavailable" as const,
          reason: "metadata_unrecognized" as const,
          message: "metadata unavailable",
          stage: "platform_runtime_read" as const
        };
      }
    };
    let readStatusTool: { invoke(input: unknown): Promise<unknown> } | undefined;
    const interpreter = createAgentInterpreter({
      config,
      platformService,
      deepseekAgentFactory: (input) => {
        readStatusTool = input.tools.find((candidate) => candidate.name === "read_platform_air_conditioner_status") as typeof readStatusTool;

        return {
          async invoke() {
            await readStatusTool!.invoke({
              room: "财务室",
              deviceType: "air_conditioner"
            });

            return {
              structuredResponse: {
                kind: "platform_status_query",
                result: {
                  kind: "unavailable",
                  reason: "metadata_unrecognized",
                  stage: "platform_runtime_read"
                }
              }
            };
          }
        };
      }
    });

    await interpreter.interpret({
      originalText: "A 项目 1 楼财务室空调开着吗，现在多少度"
    });

    expect(calls).toEqual(["readAirConditionerStatus"]);
  });

  it("keeps unknown interpreter modes rejected by parseEnv", () => {
    expect(() =>
      parseEnv({
        AGENT_INTERPRETER_MODE: "other"
      })
    ).toThrow();
  });
});
