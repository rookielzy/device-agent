import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { CreateAgentInterpreterOptions } from "../../src/agent/agent-factory.js";
import type { AgentInterpreter } from "../../src/agent/agent-interpreter.js";
import { buildApp } from "../../src/app.js";
import { parseEnv } from "../../src/config/env.js";
import { createRuntimeDependencies, shouldExposeDebugRoutes, startServer } from "../../src/server.js";
import { createFixedInterpreter, livingRoomStatusProposal } from "../fixtures/task-fixtures.js";

describe("server runtime wiring", () => {
  it("points package startup scripts at the emitted server entrypoint", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts.start).toBe("node dist/src/server.js");
    expect(packageJson.scripts.dev).toContain("node dist/src/server.js");
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
      expect(options.deviceService?.debugSnapshot().length).toBeGreaterThan(0);

      return createFixedInterpreter(livingRoomStatusProposal);
    });

    createRuntimeDependencies(config, {
      agentInterpreterFactory: factory
    });

    expect(factory).toHaveBeenCalledOnce();
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
