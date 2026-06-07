import { describe, expect, it } from "vitest";
import { ConfigError, parseEnv } from "../../src/config/env.js";
import {
  selectedDeviceContextSchema,
  simulatedDeviceContextSchema,
  writableControlSchema
} from "../../src/contracts/device-contract.js";
import { taskResultSchema } from "../../src/contracts/task-contract.js";
import {
  ambiguousTaskResult,
  bedroomSensor,
  expiredConfirmationTaskResult,
  hallwayLight,
  invalidValueTaskResult,
  langChainSpecificPayload,
  livingRoomAirConditioner,
  offlineKitchenLight,
  pendingControlTaskResult,
  rejectedTaskResult,
  statusQueryTaskResult,
  unsupportedTaskResult,
  unavailableTaskResult
} from "../fixtures/contract-fixtures.js";

describe("environment configuration", () => {
  it("parses fake interpreter mode without DeepSeek credentials", () => {
    expect(parseEnv({})).toEqual({
      host: "127.0.0.1",
      port: 3000,
      interpreterMode: "fake",
      deepseek: {
        model: "deepseek-v4-flash"
      }
    });
  });

  it("rejects live DeepSeek mode without an API key", () => {
    expect(() =>
      parseEnv({
        AGENT_INTERPRETER_MODE: "deepseek"
      })
    ).toThrow(new ConfigError("DEEPSEEK_API_KEY is required when AGENT_INTERPRETER_MODE is deepseek"));
  });

  it("parses live DeepSeek mode with credentials and model", () => {
    expect(
      parseEnv({
        HOST: "0.0.0.0",
        PORT: "8080",
        AGENT_INTERPRETER_MODE: "deepseek",
        DEEPSEEK_API_KEY: "test-key",
        DEEPSEEK_MODEL: "deepseek-v4-pro"
      })
    ).toEqual({
      host: "0.0.0.0",
      port: 8080,
      interpreterMode: "deepseek",
      deepseek: {
        apiKey: "test-key",
        model: "deepseek-v4-pro"
      }
    });
  });

  it("rejects invalid ports and unknown interpreter modes", () => {
    expect(() => parseEnv({ PORT: "70000" })).toThrow(ConfigError);
    expect(() => parseEnv({ AGENT_INTERPRETER_MODE: "live" })).toThrow(ConfigError);
  });
});

describe("task result contract", () => {
  it("parses a valid status-query fixture", () => {
    const parsed = taskResultSchema.parse(statusQueryTaskResult);

    expect(parsed.classification).toBe("status_query");
    expect(parsed.executionState).toBe("completed");
    expect(parsed.outcomeReason).toBe("none");
    expect(parsed.selectedContext.dataItems).toHaveLength(4);
    expect(parsed.timeline.map((event) => event.stage)).toContain("simulated_read");
  });

  it("parses a valid pending-control fixture without claiming mutation", () => {
    const parsed = taskResultSchema.parse(pendingControlTaskResult);

    expect(parsed.executionState).toBe("pending_confirmation");
    expect(parsed.pendingControl?.confirmationSummary).toContain("hallway light");
    expect(parsed.timeline.map((event) => event.stage)).not.toContain("simulated_execution");
  });

  it("parses ambiguous and unavailable outcomes without selected executable actions", () => {
    const ambiguous = taskResultSchema.parse(ambiguousTaskResult);
    const unavailable = taskResultSchema.parse(unavailableTaskResult);

    expect(ambiguous.executionState).toBe("needs_clarification");
    expect(ambiguous.outcomeReason).toBe("ambiguous_target");
    expect(ambiguous.selectedControlItems).toHaveLength(0);
    expect(ambiguous.selectedContext.candidates.length).toBeGreaterThan(0);
    expect(unavailable.executionState).toBe("unavailable");
    expect(unavailable.outcomeReason).toBe("device_offline");
    expect(unavailable.pendingControl).toBeUndefined();
  });

  it("parses blocked outcomes with machine-readable reasons", () => {
    expect(taskResultSchema.parse(unsupportedTaskResult).outcomeReason).toBe("read_only_control");
    expect(taskResultSchema.parse(invalidValueTaskResult).outcomeReason).toBe("invalid_control_value");
    expect(taskResultSchema.parse(rejectedTaskResult).outcomeReason).toBe("control_rejected");
    expect(taskResultSchema.parse(expiredConfirmationTaskResult).outcomeReason).toBe("pending_control_expired");
  });

  it("rejects malformed task results missing classification or timeline", () => {
    const missingClassification = { ...statusQueryTaskResult };
    delete (missingClassification as Partial<typeof statusQueryTaskResult>).classification;

    const missingTimeline = { ...statusQueryTaskResult };
    delete (missingTimeline as Partial<typeof statusQueryTaskResult>).timeline;

    expect(taskResultSchema.safeParse(missingClassification).success).toBe(false);
    expect(taskResultSchema.safeParse(missingTimeline).success).toBe(false);
  });

  it("rejects invalid execution states", () => {
    expect(
      taskResultSchema.safeParse({
        ...statusQueryTaskResult,
        executionState: "mutated"
      }).success
    ).toBe(false);
  });

  it("rejects pending confirmation without pending control details", () => {
    const missingPendingControl = { ...pendingControlTaskResult };
    delete (missingPendingControl as Partial<typeof pendingControlTaskResult>).pendingControl;

    expect(taskResultSchema.safeParse(missingPendingControl).success).toBe(false);
  });

  it("rejects pending control details on non-pending outcomes", () => {
    expect(
      taskResultSchema.safeParse({
        ...statusQueryTaskResult,
        classification: "status_query",
        executionState: "completed",
        pendingControl: pendingControlTaskResult.pendingControl
      }).success
    ).toBe(false);
  });

  it("does not accept LangChain messages or tool-call payloads as public contract fields", () => {
    expect(taskResultSchema.safeParse(langChainSpecificPayload).success).toBe(false);
  });

  it("rejects provider-specific payloads nested inside selected context", () => {
    expect(
      taskResultSchema.safeParse({
        ...statusQueryTaskResult,
        selectedContext: {
          ...statusQueryTaskResult.selectedContext,
          devices: [
            {
              ...statusQueryTaskResult.selectedContext.devices[0],
              tool_calls: [{ id: "call-001" }]
            }
          ]
        }
      }).success
    ).toBe(false);
  });
});

describe("device context contract", () => {
  it("parses air-conditioner, light, sensor, and offline device contexts", () => {
    expect(simulatedDeviceContextSchema.parse(livingRoomAirConditioner).type).toBe("air_conditioner");
    expect(simulatedDeviceContextSchema.parse(hallwayLight).writableControls).toHaveLength(1);
    expect(simulatedDeviceContextSchema.parse(bedroomSensor).writableControls).toHaveLength(0);
    expect(simulatedDeviceContextSchema.parse(offlineKitchenLight).availability.online).toBe(false);
  });

  it("rejects unsupported value metadata on control descriptors", () => {
    expect(
      writableControlSchema.safeParse({
        controlId: "power",
        name: "Power",
        metadata: {
          kind: "object",
          label: "Power"
        },
        writable: true
      }).success
    ).toBe(false);
  });

  it("parses selected context embedded in a task result without provider internals", () => {
    const selectedContext = selectedDeviceContextSchema.parse(statusQueryTaskResult.selectedContext);

    expect(selectedContext.devices[0]?.deviceId).toBe("device-ac-living-room");
    expect(JSON.stringify(selectedContext)).not.toContain("tool_calls");
    expect(JSON.stringify(selectedContext)).not.toContain("messages");
  });
});
