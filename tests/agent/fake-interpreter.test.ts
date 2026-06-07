import { describe, expect, it } from "vitest";
import { agentProposalSchema } from "../../src/agent/agent-interpreter.js";
import { FakeInterpreter } from "../../src/agent/fake-interpreter.js";
import { TaskService } from "../../src/domain/tasks/task-service.js";
import { sampleUtterances } from "../fixtures/sample-utterances.js";
import {
  createFixedClock,
  createIdSequence
} from "../fixtures/task-fixtures.js";

describe("FakeInterpreter", () => {
  it("maps sample utterances to normalized proposals without credentials or network", () => {
    const interpreter = new FakeInterpreter();

    for (const sample of sampleUtterances) {
      const proposal = interpreter.interpret({ originalText: sample.text });

      expect(agentProposalSchema.safeParse(proposal).success).toBe(true);
      expect(proposal.kind).toBe(sample.expectedKind);
      expect(proposal).toMatchObject(sample.expectedProposal);
    }
  });

  it("returns an air-conditioner status query for AE1", () => {
    const proposal = new FakeInterpreter().interpret({
      originalText: "Is the living room air conditioner running?"
    });

    expect(proposal).toMatchObject({
      kind: "status_query",
      target: {
        room: "living room",
        deviceType: "air_conditioner"
      }
    });
  });

  it("returns a confirmable hallway-light control proposal without execution claims", () => {
    const proposal = new FakeInterpreter().interpret({
      originalText: "Turn on the hallway light"
    });

    expect(proposal).toMatchObject({
      kind: "control_request",
      target: {
        room: "hallway",
        deviceType: "light",
        controlItem: "power",
        requestedValue: true
      }
    });
    expect(JSON.stringify(proposal)).not.toContain("executed");
  });

  it("feeds TaskService sample utterances through offline task outcomes", async () => {
    const service = new TaskService({
      interpreter: new FakeInterpreter(),
      clock: createFixedClock(),
      taskIdGenerator: createIdSequence("task"),
      pendingControlIdGenerator: createIdSequence("pending"),
      timelineEventIdGenerator: createIdSequence("evt")
    });

    const status = await service.createTask("Is the living room air conditioner running?");
    const pending = await service.createTask("Turn on the hallway light");
    const ambiguous = await service.createTask("What is the bedroom device doing?");
    const offline = await service.createTask("Turn on the kitchen light");
    const parseFailure = await service.createTask("Blue banana entropy please");

    expect(status.executionState).toBe("completed");
    expect(pending.executionState).toBe("pending_confirmation");
    expect(pending.timeline.map((event) => event.stage)).not.toContain("simulated_execution");
    expect(ambiguous.executionState).toBe("needs_clarification");
    expect(offline.executionState).toBe("unavailable");
    expect(offline.outcomeReason).toBe("device_offline");
    expect(parseFailure.outcomeReason).toBe("parse_failure");
  });
});
