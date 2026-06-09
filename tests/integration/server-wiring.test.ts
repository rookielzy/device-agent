import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { CreateAgentInterpreterOptions } from "../../src/agent/agent-factory.js";
import type { AgentInterpreter } from "../../src/agent/agent-interpreter.js";
import { buildApp } from "../../src/app.js";
import { parseEnv } from "../../src/config/env.js";
import { createRuntimeDependencies, isDirectExecutionPath, shouldExposeDebugRoutes, startServer } from "../../src/server.js";
import { createFixedInterpreter, livingRoomStatusProposal } from "../fixtures/task-fixtures.js";
import { financeRoomAirConditionerDetail, financeRoomPivotalParams } from "../fixtures/platform-api-fixtures.js";

describe("server runtime wiring", () => {
  it("points package startup scripts at the emitted server entrypoint", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts.start).toBe("node dist/src/server.js");
    expect(packageJson.scripts.dev).toContain("node dist/src/server.js");
  });

  it("detects direct execution for relative emitted server paths", () => {
    const cwd = process.cwd();
    const moduleUrl = new URL(`file://${cwd}/dist/src/server.js`).href;

    expect(isDirectExecutionPath("dist/src/server.js", moduleUrl)).toBe(true);
    expect(isDirectExecutionPath(`${cwd}/dist/src/server.js`, moduleUrl)).toBe(true);
    expect(isDirectExecutionPath("dist/src/app.js", moduleUrl)).toBe(false);
  });

  it("imports app construction without listening or requiring DeepSeek credentials", async () => {
    const app = buildApp({
      config: parseEnv({
        AGENT_INTERPRETER_MODE: "fake",
        PORT: "3000"
      })
    });
    const listenSpy = vi.spyOn(app, "listen");

    try {
      expect(listenSpy).not.toHaveBeenCalled();
    } finally {
      listenSpy.mockRestore();
      await app.close();
    }
  });

  it("constructs fake-mode dependencies without DEEPSEEK_API_KEY", async () => {
    const config = parseEnv({
      AGENT_INTERPRETER_MODE: "fake",
      PORT: "3000"
    });
    const dependencies = createRuntimeDependencies(config);
    const result = await dependencies.taskService.createTask("Is the living room air conditioner running?");

    expect(result.executionState).toBe("completed");
    expect(result.selectedContext.devices[0]?.deviceId).toBe("device-ac-living-room");
  });

  it("passes parsed DeepSeek model and API key through the interpreter factory", () => {
    const config = parseEnv({
      AGENT_INTERPRETER_MODE: "deepseek",
      DEEPSEEK_API_KEY: "test-key",
      DEEPSEEK_MODEL: "deepseek-test-model",
      PORT: "3000"
    });
    const factory = vi.fn((options: CreateAgentInterpreterOptions): AgentInterpreter => {
      expect(options.config.deepseek.apiKey).toBe("test-key");
      expect(options.config.deepseek.model).toBe("deepseek-test-model");
      expect(options.config.deviceCapabilityMode).toBe("simulated");
      expect(options.deviceService?.debugSnapshot().length).toBeGreaterThan(0);

      return createFixedInterpreter(livingRoomStatusProposal);
    });

    createRuntimeDependencies(config, {
      agentInterpreterFactory: factory
    });

    expect(factory).toHaveBeenCalledOnce();
  });

  it("constructs platform-mode dependencies with injected platform service and factory wiring", async () => {
    const config = parseEnv({
      AGENT_INTERPRETER_MODE: "deepseek",
      AGENT_DEVICE_CAPABILITY_MODE: "platform",
      DEEPSEEK_API_KEY: "test-key",
      PLATFORM_USER_CENTER_BASE_URL: "https://user.example.test",
      PLATFORM_IOT_BASE_URL: "https://iot.example.test",
      PLATFORM_VALIDATION_MOBILE: "13800000000",
      PLATFORM_VALIDATION_PASSWORD: "secret",
      PORT: "3000"
    });
    const platformService = createPlatformService();
    const factory = vi.fn((options: CreateAgentInterpreterOptions): AgentInterpreter => {
      expect(options.config.deviceCapabilityMode).toBe("platform");
      expect(options.platformService).toBe(platformService);

      return createFixedInterpreter({
        kind: "platform_status_query",
        result: {
          kind: "platform_status_success",
          device: {
            deviceId: "99887766",
            displayName: "财务室空调",
            room: "财务室",
            type: "air_conditioner",
            availability: { online: true },
            capabilities: ["platform_read"],
            readableValues: [],
            writableControls: []
          },
          dataItems: [
            {
              deviceId: "99887766",
              itemId: "returnairtemperature",
              name: "回风温度",
              value: 23.5,
              metadata: {
                kind: "number",
                label: "回风温度",
                unit: "℃"
              },
              freshness: "fresh"
            }
          ],
          returnAirTemperature: 23.5
        }
      });
    });

    const dependencies = createRuntimeDependencies(config, {
      platformCapabilityService: platformService,
      agentInterpreterFactory: factory
    });
    const result = await dependencies.taskService.createTask("A 项目 1 楼财务室空调开着吗，现在多少度");

    expect(factory).toHaveBeenCalledOnce();
    expect(result.executionState).toBe("completed");
    expect(result.timeline.map((event) => event.stage)).toContain("platform_runtime_read");
  });

  it("gates debug routes for externally bound runtime servers unless explicitly enabled", async () => {
    const hiddenConfig = parseEnv({
      HOST: "0.0.0.0",
      PORT: "3000",
      AGENT_INTERPRETER_MODE: "fake"
    });
    const enabledConfig = parseEnv({
      HOST: "0.0.0.0",
      PORT: "3000",
      AGENT_INTERPRETER_MODE: "fake",
      ENABLE_DEBUG_SIMULATED_DEVICES: "true"
    });
    const hiddenApp = buildApp({
      dependencies: createRuntimeDependencies(hiddenConfig),
      exposeDebugRoutes: shouldExposeDebugRoutes(hiddenConfig)
    });
    const enabledApp = buildApp({
      dependencies: createRuntimeDependencies(enabledConfig),
      exposeDebugRoutes: shouldExposeDebugRoutes(enabledConfig)
    });

    try {
      const hidden = await hiddenApp.inject({
        method: "GET",
        url: "/debug/simulated-devices"
      });
      const enabled = await enabledApp.inject({
        method: "GET",
        url: "/debug/simulated-devices"
      });

      expect(hidden.statusCode).toBe(404);
      expect(enabled.statusCode).toBe(200);
    } finally {
      await hiddenApp.close();
      await enabledApp.close();
    }
  });

  it("keeps debug routes enabled for localhost runtime defaults", async () => {
    const config = parseEnv({
      HOST: "127.0.0.1",
      PORT: "3000",
      AGENT_INTERPRETER_MODE: "fake"
    });
    const app = buildApp({
      dependencies: createRuntimeDependencies(config),
      exposeDebugRoutes: shouldExposeDebugRoutes(config)
    });

    try {
      const response = await app.inject({
        method: "GET",
        url: "/debug/simulated-devices"
      });

      expect(response.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it("listens with configured host and port and surfaces listen failures", async () => {
    const listen = vi.fn(async () => "http://127.0.0.1:3999");
    const close = vi.fn(async () => undefined);
    const app = {
      listen,
      close
    };
    const config = parseEnv({
      HOST: "127.0.0.1",
      PORT: "3999",
      AGENT_INTERPRETER_MODE: "fake"
    });

    const started = await startServer({
      config,
      app: app as never
    });

    expect(started.address).toBe("http://127.0.0.1:3999");
    expect(listen).toHaveBeenCalledWith({
      host: "127.0.0.1",
      port: 3999
    });

    const failingApp = {
      listen: vi.fn(async () => {
        throw new Error("port unavailable");
      })
    };

    await expect(startServer({
      config,
      app: failingApp as never
    })).rejects.toThrow("port unavailable");
  });
});

function createPlatformService() {
  return {
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
      return financeRoomAirConditionerDetail;
    },
    async getRuntimeParams() {
      return financeRoomPivotalParams;
    },
    async readAirConditionerStatus() {
      return {
        kind: "unavailable" as const,
        reason: "metadata_unrecognized" as const,
        message: "metadata unavailable",
        stage: "platform_runtime_read" as const
      };
    }
  };
}
