import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createRuntimeApp, startServer } from "../../src/server.js";
import type { AppConfig } from "../../src/config/env.js";
import { closeApp, parseTaskResponse } from "./api-test-helpers.js";
import { livingRoomStatusProposal } from "../fixtures/task-fixtures.js";

describe("server runtime wiring", () => {
  it("constructs the runtime app in fake mode without DeepSeek credentials", async () => {
    const runtime = createRuntimeApp({
      env: {
        AGENT_INTERPRETER_MODE: "fake",
        HOST: "127.0.0.1",
        PORT: "3000"
      }
    });

    try {
      const response = await runtime.app.inject({
        method: "POST",
        url: "/tasks",
        payload: {
          text: "Is the living room air conditioner running?"
        }
      });
      const task = parseTaskResponse(response.payload);

      expect(runtime.config).toMatchObject({
        host: "127.0.0.1",
        port: 3000,
        interpreterMode: "fake"
      });
      expect(task.executionState).toBe("completed");
    } finally {
      await closeApp(runtime.app);
    }
  });

  it("builds DeepSeek mode from parsed config and injected factory", async () => {
    const calls: unknown[] = [];
    const config: AppConfig = {
      host: "127.0.0.1",
      port: 3000,
      interpreterMode: "deepseek",
      deepseek: {
        apiKey: "test-key",
        model: "deepseek-test"
      }
    };
    const runtime = createRuntimeApp({
      config,
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

    try {
      const response = await runtime.app.inject({
        method: "POST",
        url: "/tasks",
        payload: {
          text: "Is the living room air conditioner running?"
        }
      });

      expect(parseTaskResponse(response.payload).executionState).toBe("completed");
      expect(calls[0]).toMatchObject({
        apiKey: "test-key",
        model: "deepseek-test"
      });
    } finally {
      await closeApp(runtime.app);
    }
  });

  it("keeps DeepSeek missing-key failures in config parsing instead of routes", () => {
    expect(() =>
      createRuntimeApp({
        env: {
          AGENT_INTERPRETER_MODE: "deepseek",
          HOST: "127.0.0.1",
          PORT: "3000"
        }
      })
    ).toThrow("DEEPSEEK_API_KEY is required");
  });

  it("surfaces listen failures to the startup caller", async () => {
    const runtime = createRuntimeApp({
      env: {
        AGENT_INTERPRETER_MODE: "fake",
        HOST: "127.0.0.1",
        PORT: "3000"
      }
    });
    const listenCalls: unknown[] = [];
    runtime.app.listen = ((options: unknown) => {
      listenCalls.push(options);

      return Promise.reject(new Error("listen failed"));
    }) as typeof runtime.app.listen;

    try {
      await expect(
        startServer({
          runtime
        })
      ).rejects.toThrow("listen failed");
      expect(listenCalls).toEqual([
        {
          host: "127.0.0.1",
          port: 3000
        }
      ]);
    } finally {
      await closeApp(runtime.app);
    }
  });

  it("points package startup scripts at the emitted server entry", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };
    const startScript = packageJson.scripts.start;
    if (!startScript) {
      throw new Error("package.json is missing start script");
    }
    const startTarget = startScript.match(/^node (?<target>.+)$/)?.groups?.target;

    expect(startTarget).toBe("dist/src/server.js");
    expect(packageJson.scripts["dev:server"]).toContain("node dist/src/server.js");
  });
});
