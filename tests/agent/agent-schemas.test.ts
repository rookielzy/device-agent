import { describe, expect, it } from "vitest";
import { agentProposalSchema } from "../../src/agent/agent-schemas.js";

describe("agent proposal schemas", () => {
  it("rejects targets that have operation fields but no real device selector", () => {
    expect(
      agentProposalSchema.safeParse({
        kind: "status_query",
        target: {
          dataItem: "power"
        }
      }).success
    ).toBe(false);

    expect(
      agentProposalSchema.safeParse({
        kind: "control_request",
        target: {
          controlItem: "power",
          requestedValue: true
        }
      }).success
    ).toBe(false);
  });

  it("rejects mixed status and control intent payloads", () => {
    expect(
      agentProposalSchema.safeParse({
        kind: "control_request",
        target: {
          room: "hallway",
          deviceType: "light",
          dataItem: "power",
          controlItem: "power",
          requestedValue: true
        }
      }).success
    ).toBe(false);

    expect(
      agentProposalSchema.safeParse({
        kind: "status_query",
        target: {
          room: "hallway",
          deviceType: "light",
          controlItem: "power"
        }
      }).success
    ).toBe(false);
  });
});
