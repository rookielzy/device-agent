import { describe, expect, it } from "vitest";
import { timelineEventSchema } from "../../../src/contracts/task-contract.js";
import { TimelineBuilder } from "../../../src/domain/tasks/timeline.js";
import { createFixedClock, createIdSequence } from "../../fixtures/task-fixtures.js";

describe("TimelineBuilder", () => {
  it("creates schema-valid deterministic lifecycle events", () => {
    const timeline = new TimelineBuilder({
      clock: createFixedClock(),
      idGenerator: createIdSequence("evt")
    });

    timeline.requestReceived();
    timeline.modelInterpretation("succeeded", "Classified request");
    timeline.serviceValidation("succeeded", "Validated proposal");
    timeline.deviceResolution("succeeded", "Resolved device");
    timeline.simulatedRead("succeeded", "Read simulated values");
    timeline.platformAuth("succeeded", "Authenticated platform request");
    timeline.platformSearch("succeeded", "Searched platform equipment");
    timeline.platformDetail("succeeded", "Read platform detail");
    timeline.platformRuntimeRead("succeeded", "Read platform runtime");
    timeline.confirmationRequired("Waiting for confirmation");
    timeline.confirmationReceived("succeeded", "User confirmed");
    timeline.simulatedExecution("succeeded", "Applied stored control");
    timeline.finalOutcome("succeeded", "Returned result");

    expect(timeline.events.map((event) => event.eventId)).toEqual([
      "evt-001",
      "evt-002",
      "evt-003",
      "evt-004",
      "evt-005",
      "evt-006",
      "evt-007",
      "evt-008",
      "evt-009",
      "evt-010",
      "evt-011",
      "evt-012",
      "evt-013"
    ]);
    expect(timeline.events.every((event) => timelineEventSchema.safeParse(event).success)).toBe(true);
    expect(timeline.events.map((event) => event.at)).toEqual(Array(13).fill("2026-06-07T09:00:00.000Z"));
  });

  it("returns defensive event snapshots", () => {
    const timeline = new TimelineBuilder({
      clock: createFixedClock(),
      idGenerator: createIdSequence("evt")
    });
    timeline.requestReceived();

    const events = timeline.events;
    events[0]!.detail = "mutated outside";

    expect(timeline.events[0]?.detail).toBe("Received user text");
  });
});
