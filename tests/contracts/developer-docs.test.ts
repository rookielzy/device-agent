import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  executionStateSchema,
  taskOutcomeReasonSchema,
  timelineSourceSchema,
  timelineStageSchema
} from "../../src/contracts/task-contract.js";
import { sampleTextFor } from "../fixtures/sample-utterances.js";

const readme = readFileSync("README.md", "utf8");
const contractDoc = readFileSync("docs/contracts/agent-plan-contract.md", "utf8");
const openApi = JSON.parse(readFileSync("docs/openapi/device-agent.openapi.json", "utf8")) as {
  components: {
    schemas: Record<string, { enum?: string[] }>;
  };
};

describe("developer documentation regression", () => {
  it("keeps README quickstart examples tied to covered fake-mode utterances", () => {
    expect(readme).toContain(sampleTextFor("ae1-living-room-ac-status"));
    expect(readme).toContain(sampleTextFor("ae2-hallway-light-on"));
    expect(readme).toContain("AGENT_INTERPRETER_MODE=fake");
    expect(readme).toContain("does not require `DEEPSEEK_API_KEY`");
    expect(readme).toContain("POST /tasks/:taskId/confirm");
    expect(readme).toContain("POST /tasks/:taskId/reject");
    expect(readme).toContain("GET /debug/simulated-devices");
  });

  it("documents default offline checks and opt-in live DeepSeek smoke validation", () => {
    expect(readme).toContain("pnpm typecheck");
    expect(readme).toContain("pnpm test");
    expect(readme).toContain("DEEPSEEK_LIVE_SMOKE=1");
    expect(readme).toContain("DEEPSEEK_API_KEY=...");
    expect(readme).toContain("tests/agent/langchain-live-smoke.test.ts");
    expect(readme).toContain("network access, model availability, and provider cost");
  });

  it("surfaces V1 operational limits instead of presenting fake mode as production-ready", () => {
    expect(readme).toContain("in-memory");
    expect(readme).toContain("request or handler timeout");
    expect(readme).toContain("Authentication, authorization, CORS, rate limiting");
    expect(contractDoc).toContain("unbounded in-memory task growth");
    expect(contractDoc).toContain("request or handler timeout hardening");
  });

  it("keeps contract vocabulary aligned with exported task schemas", () => {
    for (const state of executionStateSchema.options) {
      expect(contractDoc).toContain(state);
    }

    for (const stage of timelineStageSchema.options) {
      expect(contractDoc).toContain(stage);
    }

    for (const outcomeReason of taskOutcomeReasonSchema.options) {
      expect(contractDoc).toContain(outcomeReason);
    }
  });

  it("keeps OpenAPI public enums aligned with exported task schemas", () => {
    expect(openApi.components.schemas.ExecutionState?.enum).toEqual(executionStateSchema.options);
    expect(openApi.components.schemas.TaskOutcomeReason?.enum).toEqual(taskOutcomeReasonSchema.options);
    expect(openApi.components.schemas.TimelineStage?.enum).toEqual(timelineStageSchema.options);
    expect(openApi.components.schemas.TimelineSource?.enum).toEqual(timelineSourceSchema.options);
  });

  it("documents the provider-neutral boundary and simulated-device debug envelope", () => {
    expect(contractDoc).toContain("TaskResult");
    expect(contractDoc).toContain("ApiError");
    expect(contractDoc).toContain('{ "devices": [...] }');
    expect(contractDoc).toContain("LangChain messages");
    expect(contractDoc).toContain("tool-call objects");
    expect(contractDoc).toContain("DeepSeek raw payloads");
    expect(contractDoc).toContain("Live smoke validation is manual and opt-in");
  });
});
