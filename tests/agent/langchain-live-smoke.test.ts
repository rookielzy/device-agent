import { describe, expect, it } from "vitest";
import { LangChainDeepSeekInterpreter } from "../../src/agent/langchain-deepseek-interpreter.js";
import { agentProposalSchema } from "../../src/agent/agent-schemas.js";
import { shouldRunDeepSeekLiveSmoke } from "../../src/agent/live-smoke.js";
import { sampleTextFor } from "../fixtures/sample-utterances.js";

const shouldRunLiveSmoke = shouldRunDeepSeekLiveSmoke();
const describeLive = shouldRunLiveSmoke ? describe : describe.skip;

describe("DeepSeek live smoke gate", () => {
  it("requires both explicit opt-in and an API key", () => {
    expect(shouldRunDeepSeekLiveSmoke({})).toBe(false);
    expect(shouldRunDeepSeekLiveSmoke({ DEEPSEEK_LIVE_SMOKE: "1" })).toBe(false);
    expect(shouldRunDeepSeekLiveSmoke({ DEEPSEEK_API_KEY: "test-key" })).toBe(false);
    expect(shouldRunDeepSeekLiveSmoke({ DEEPSEEK_LIVE_SMOKE: "1", DEEPSEEK_API_KEY: "test-key" })).toBe(true);
  });
});

describeLive("LangChain DeepSeek live smoke", () => {
  it("returns coarse valid proposals for one status query and one control request", async () => {
    const interpreter = new LangChainDeepSeekInterpreter({
      apiKey: process.env.DEEPSEEK_API_KEY!,
      model: process.env.DEEPSEEK_MODEL || "deepseek-v4-flash"
    });

    const status = await interpreter.interpret({
      originalText: sampleTextFor("ae1-living-room-ac-status")
    });
    const control = await interpreter.interpret({
      originalText: sampleTextFor("ae2-hallway-light-on")
    });

    expect(agentProposalSchema.safeParse(status).success).toBe(true);
    expect(agentProposalSchema.safeParse(control).success).toBe(true);
    expect(status.kind).toBe("status_query");
    expect(control.kind).toBe("control_request");
  }, 60_000);
});
