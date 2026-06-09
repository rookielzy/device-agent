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
      deviceCapabilityMode: "simulated",
      deepseek: {
        model: "deepseek-v4-flash"
      },
      enableDebugSimulatedDevices: false,
      trace: {
        enabled: false,
        includePayloads: false,
        sink: "stdout"
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
      deviceCapabilityMode: "simulated",
      deepseek: {
        apiKey: "test-key",
        model: "deepseek-v4-pro"
      },
      enableDebugSimulatedDevices: false,
      trace: {
        enabled: false,
        includePayloads: false,
        sink: "stdout"
      }
    });
  });

  it("parses explicit debug simulated device opt-in", () => {
    expect(parseEnv({ ENABLE_DEBUG_SIMULATED_DEVICES: "true" }).enableDebugSimulatedDevices).toBe(true);
    expect(parseEnv({ ENABLE_DEBUG_SIMULATED_DEVICES: "0" }).enableDebugSimulatedDevices).toBe(false);
  });

  it("parses explicit local agent trace settings", () => {
    expect(parseEnv({ ENABLE_AGENT_TRACE: "true" }).trace).toEqual({
      enabled: true,
      includePayloads: false,
      sink: "stdout"
    });
    expect(parseEnv({ ENABLE_AGENT_TRACE: "1", ENABLE_AGENT_TRACE_PAYLOADS: "true", AGENT_TRACE_SINK: "stderr" }).trace).toEqual({
      enabled: true,
      includePayloads: true,
      sink: "stderr"
    });
    expect(() => parseEnv({ AGENT_TRACE_SINK: "file" })).toThrow(ConfigError);
  });

  it("rejects invalid ports and unknown interpreter modes", () => {
    expect(() => parseEnv({ PORT: "70000" })).toThrow(ConfigError);
    expect(() => parseEnv({ AGENT_INTERPRETER_MODE: "live" })).toThrow(ConfigError);
  });

  it("parses simulated device-capability mode without platform config", () => {
    const config = parseEnv({
      AGENT_INTERPRETER_MODE: "deepseek",
      DEEPSEEK_API_KEY: "test-key",
      AGENT_DEVICE_CAPABILITY_MODE: "simulated"
    });

    expect(config.deviceCapabilityMode).toBe("simulated");
    expect(config.platform).toBeUndefined();
  });

  it("rejects real-platform mode without DeepSeek or platform credentials", () => {
    expect(() =>
      parseEnv({
        AGENT_DEVICE_CAPABILITY_MODE: "platform"
      })
    ).toThrow("AGENT_DEVICE_CAPABILITY_MODE=platform requires AGENT_INTERPRETER_MODE=deepseek");

    expect(() =>
      parseEnv({
        AGENT_INTERPRETER_MODE: "deepseek",
        DEEPSEEK_API_KEY: "test-key",
        AGENT_DEVICE_CAPABILITY_MODE: "platform"
      })
    ).toThrow(/PLATFORM_USER_CENTER_BASE_URL/);
  });

  it("parses real-platform mode with default project ID and supplied timeout", () => {
    const config = parseEnv({
      AGENT_INTERPRETER_MODE: "deepseek",
      DEEPSEEK_API_KEY: "test-key",
      AGENT_DEVICE_CAPABILITY_MODE: "platform",
      PLATFORM_USER_CENTER_BASE_URL: "https://user.example.test",
      PLATFORM_IOT_BASE_URL: "https://iot.example.test",
      PLATFORM_VALIDATION_MOBILE: "13800000000",
      PLATFORM_VALIDATION_PASSWORD: "secret",
      PLATFORM_REQUEST_TIMEOUT_MS: "2500"
    });

    expect(config.platform).toEqual({
      userCenterBaseUrl: "https://user.example.test",
      iotBaseUrl: "https://iot.example.test",
      validationMobile: "13800000000",
      validationPassword: "secret",
      validationProjectId: "270544150790145",
      requestTimeoutMs: 2500
    });
  });

  it("parses supplied project ID and rejects invalid request timeout config", () => {
    expect(parseEnv({
      AGENT_INTERPRETER_MODE: "deepseek",
      DEEPSEEK_API_KEY: "test-key",
      AGENT_DEVICE_CAPABILITY_MODE: "platform",
      PLATFORM_USER_CENTER_BASE_URL: "https://user.example.test",
      PLATFORM_IOT_BASE_URL: "https://iot.example.test",
      PLATFORM_VALIDATION_MOBILE: "13800000000",
      PLATFORM_VALIDATION_PASSWORD: "secret",
      PLATFORM_VALIDATION_PROJECT_ID: "123",
      PLATFORM_REQUEST_TIMEOUT_MS: "3000"
    }).platform?.validationProjectId).toBe("123");

    for (const timeout of ["0", "-1", "1.5"]) {
      expect(() =>
        parseEnv({
          AGENT_INTERPRETER_MODE: "deepseek",
          DEEPSEEK_API_KEY: "test-key",
          AGENT_DEVICE_CAPABILITY_MODE: "platform",
          PLATFORM_USER_CENTER_BASE_URL: "https://user.example.test",
          PLATFORM_IOT_BASE_URL: "https://iot.example.test",
          PLATFORM_VALIDATION_MOBILE: "13800000000",
          PLATFORM_VALIDATION_PASSWORD: "secret",
          PLATFORM_REQUEST_TIMEOUT_MS: timeout
        })
      ).toThrow(ConfigError);
    }
  });

  it("rejects platform mode on externally bound hosts and non-http platform URLs", () => {
    const validPlatformEnv = {
      AGENT_INTERPRETER_MODE: "deepseek",
      DEEPSEEK_API_KEY: "test-key",
      AGENT_DEVICE_CAPABILITY_MODE: "platform",
      PLATFORM_USER_CENTER_BASE_URL: "https://user.example.test",
      PLATFORM_IOT_BASE_URL: "https://iot.example.test",
      PLATFORM_VALIDATION_MOBILE: "13800000000",
      PLATFORM_VALIDATION_PASSWORD: "secret"
    };

    expect(() =>
      parseEnv({
        ...validPlatformEnv,
        HOST: "0.0.0.0"
      })
    ).toThrow("AGENT_DEVICE_CAPABILITY_MODE=platform is limited to localhost or 127.0.0.1");

    expect(() =>
      parseEnv({
        ...validPlatformEnv,
        PLATFORM_USER_CENTER_BASE_URL: "file:///tmp/user-center"
      })
    ).toThrow("PLATFORM_USER_CENTER_BASE_URL must be an absolute http(s) URL");

    expect(() =>
      parseEnv({
        ...validPlatformEnv,
        PLATFORM_IOT_BASE_URL: "iot.example.test"
      })
    ).toThrow("PLATFORM_IOT_BASE_URL must be an absolute http(s) URL");
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

  it("rejects non-success task results without a machine-readable reason", () => {
    for (const fixture of [
      ambiguousTaskResult,
      unavailableTaskResult,
      rejectedTaskResult,
      invalidValueTaskResult,
      expiredConfirmationTaskResult
    ]) {
      const missingReason = { ...fixture };
      delete (missingReason as Partial<typeof fixture>).outcomeReason;

      expect(taskResultSchema.safeParse(missingReason).success).toBe(false);
      expect(
        taskResultSchema.safeParse({
          ...fixture,
          outcomeReason: "none"
        }).success
      ).toBe(false);
    }
  });

  it("rejects blocked reasons on completed and pending task results", () => {
    expect(
      taskResultSchema.safeParse({
        ...statusQueryTaskResult,
        outcomeReason: "device_offline"
      }).success
    ).toBe(false);
    expect(
      taskResultSchema.safeParse({
        ...pendingControlTaskResult,
        outcomeReason: "invalid_control_value"
      }).success
    ).toBe(false);
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
