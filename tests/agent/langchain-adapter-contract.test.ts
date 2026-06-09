import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { StructuredOutputParsingError } from "langchain";
import {
  DEEPSEEK_INTERPRETER_SYSTEM_PROMPT,
  DEEPSEEK_PLATFORM_INTERPRETER_SYSTEM_PROMPT
} from "../../src/agent/agent-prompts.js";
import { agentProposalSchema } from "../../src/agent/agent-schemas.js";
import { LangChainDeepSeekInterpreter, type AgentInvoker } from "../../src/agent/langchain-deepseek-interpreter.js";
import { SimulatedDeviceService } from "../../src/domain/devices/simulated-device-service.js";
import {
  hallwayLightOnProposal,
  livingRoomStatusProposal
} from "../fixtures/task-fixtures.js";
import { sampleTextFor } from "../fixtures/sample-utterances.js";

describe("LangChainDeepSeekInterpreter contract", () => {
  it("returns normalized status proposals from mocked structured response", async () => {
    const calls: Parameters<AgentInvoker["invoke"]>[0][] = [];
    const interpreter = createInterpreter({
      structuredResponse: livingRoomStatusProposal,
      calls
    });

    const proposal = await interpreter.interpret({
      originalText: sampleTextFor("ae1-living-room-ac-status")
    });

    expect(proposal).toEqual(livingRoomStatusProposal);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.messages).toEqual([
      {
        role: "user",
        content: expect.stringContaining(sampleTextFor("ae1-living-room-ac-status"))
      }
    ]);
    expect(calls[0]?.messages[0]?.content).toContain("Interpret this user request");
  });

  it("returns normalized control proposals and does not mutate simulated state", async () => {
    const deviceService = new SimulatedDeviceService();
    const interpreter = createInterpreter({
      structuredResponse: hallwayLightOnProposal,
      deviceService
    });

    const proposal = await interpreter.interpret({
      originalText: sampleTextFor("ae2-hallway-light-on")
    });
    const after = deviceService.readStatus({
      room: "hallway",
      deviceType: "light",
      dataItem: "power"
    });

    expect(proposal).toEqual(hallwayLightOnProposal);
    expect(after.kind).toBe("read_success");
    if (after.kind === "read_success") {
      expect(after.dataItems[0]?.value).toBe(false);
    }
  });

  it("maps missing or invalid structured output to parse_failure", async () => {
    const missing = await createInterpreter({}).interpret({
      originalText: "Turn something on"
    });
    const invalid = await createInterpreter({
      structuredResponse: {
        kind: "control_request",
        target: {
          room: "hallway"
        }
      }
    }).interpret({
      originalText: "Turn something on"
    });

    expect(missing).toMatchObject({
      kind: "parse_failure",
      reason: "missing_structured_response"
    });
    expect(invalid).toMatchObject({
      kind: "parse_failure",
      reason: "schema_invalid"
    });
    expect(JSON.stringify(invalid)).not.toContain("tool_calls");
  });

  it("maps Zod validation errors to parse_failure without provider payloads", async () => {
    const interpreter = createInterpreter({
      error: new ZodError([])
    });

    const proposal = await interpreter.interpret({
      originalText: sampleTextFor("ae2-hallway-light-on")
    });

    expect(proposal).toMatchObject({
      kind: "parse_failure",
      reason: "schema_invalid"
    });
    expect(JSON.stringify(proposal)).not.toContain("raw");
  });

  it("maps LangChain structured parsing errors to sanitized parse_failure", async () => {
    const interpreter = createInterpreter({
      error: new StructuredOutputParsingError("AgentProposal", ["raw provider payload tool_calls"])
    });

    const proposal = await interpreter.interpret({
      originalText: sampleTextFor("ae2-hallway-light-on")
    });

    expect(proposal).toMatchObject({
      kind: "parse_failure",
      reason: "structured_output_parse_failure",
      detail: "LangChain could not parse model output as the proposal schema"
    });
    expect(JSON.stringify(proposal)).not.toContain("tool_calls");
  });

  it("sanitizes unknown adapter errors before returning proposals", async () => {
    const interpreter = createInterpreter({
      error: new Error("raw provider payload tool_calls request-id-123")
    });

    const proposal = await interpreter.interpret({
      originalText: sampleTextFor("ae2-hallway-light-on")
    });

    expect(proposal).toMatchObject({
      kind: "parse_failure",
      reason: "adapter_error",
      detail: "LangChain adapter failed to interpret the request"
    });
    expect(JSON.stringify(proposal)).not.toContain("tool_calls");
    expect(JSON.stringify(proposal)).not.toContain("request-id-123");
  });

  it("uses injected factory with configured model and api key without reading env at import time", async () => {
    const calls: unknown[] = [];
    const interpreter = new LangChainDeepSeekInterpreter({
      apiKey: "test-key",
      model: "deepseek-test",
      deviceService: new SimulatedDeviceService(),
      agentFactory: (input) => {
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

    const proposal = await interpreter.interpret({
      originalText: sampleTextFor("ae1-living-room-ac-status")
    });

    expect(proposal.kind).toBe("status_query");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      apiKey: "test-key",
      model: "deepseek-test",
      systemPrompt: DEEPSEEK_INTERPRETER_SYSTEM_PROMPT
    });
  });

  it("uses platform tools and platform prompt when real-platform mode is enabled", async () => {
    const calls: unknown[] = [];
    const interpreter = new LangChainDeepSeekInterpreter({
      apiKey: "test-key",
      model: "deepseek-test",
      deviceCapabilityMode: "platform",
      platformService: createPlatformService(),
      agentFactory: (input) => {
        calls.push(input);

        return {
          async invoke() {
            return {
              structuredResponse: {
                kind: "platform_status_query",
                result: {
                  kind: "unavailable",
                  reason: "metadata_unrecognized",
                  stage: "platform_runtime_read"
                }
              }
            };
          }
        };
      }
    });

    const proposal = await interpreter.interpret({
      originalText: "A 项目 1 楼财务室空调开着吗，现在多少度"
    });

    expect(proposal.kind).toBe("platform_status_query");
    expect(calls[0]).toMatchObject({
      systemPrompt: DEEPSEEK_PLATFORM_INTERPRETER_SYSTEM_PROMPT
    });
    expect((calls[0] as { tools: Array<{ name: string }> }).tools.map((tool) => tool.name)).toContain("read_platform_air_conditioner_status");
  });

  it("requires platform service when platform mode constructs a real agent", () => {
    expect(() =>
      new LangChainDeepSeekInterpreter({
        apiKey: "test-key",
        model: "deepseek-test",
        deviceCapabilityMode: "platform"
      })
    ).toThrow("Platform device capability mode requires a platformService");
  });

  it("maps malformed platform status structured output to sanitized parse_failure", async () => {
    const missingFields = await createInterpreter({
      structuredResponse: {
        kind: "platform_status_query",
        result: {
          kind: "platform_status_success"
        }
      }
    }).interpret({
      originalText: "A 项目 1 楼财务室空调开着吗，现在多少度"
    });
    const rawPayload = await createInterpreter({
      structuredResponse: {
        kind: "platform_status_query",
        result: {
          kind: "unavailable",
          reason: "platform_error",
          stage: "platform_detail",
          message: "raw provider payload tool_calls serialNumber"
        }
      }
    }).interpret({
      originalText: "A 项目 1 楼财务室空调开着吗，现在多少度"
    });

    expect(missingFields).toMatchObject({
      kind: "parse_failure",
      reason: "schema_invalid"
    });
    expect(rawPayload).toMatchObject({
      kind: "parse_failure",
      reason: "schema_invalid"
    });
    expect(JSON.stringify(rawPayload)).not.toContain("serialNumber");
    expect(JSON.stringify(rawPayload)).not.toContain("tool_calls");
  });

  it("keeps prompt and response schema aligned with provider-neutral proposal vocabulary", () => {
    expect(DEEPSEEK_INTERPRETER_SYSTEM_PROMPT).toContain("status_query");
    expect(DEEPSEEK_INTERPRETER_SYSTEM_PROMPT).toContain("control_request");
    expect(DEEPSEEK_INTERPRETER_SYSTEM_PROMPT).toContain("ambiguous");
    expect(DEEPSEEK_INTERPRETER_SYSTEM_PROMPT).toContain("never executes");
    expect(DEEPSEEK_INTERPRETER_SYSTEM_PROMPT).toContain("structured output");
    expect(DEEPSEEK_PLATFORM_INTERPRETER_SYSTEM_PROMPT).toContain("read-only");
    expect(DEEPSEEK_PLATFORM_INTERPRETER_SYSTEM_PROMPT).toContain("return-air temperature");

    expect(agentProposalSchema.safeParse(livingRoomStatusProposal).success).toBe(true);
    expect(agentProposalSchema.safeParse({
      kind: "platform_status_query",
      result: {
        kind: "unavailable",
        reason: "metadata_unrecognized",
        candidates: [],
        stage: "platform_runtime_read"
      }
    }).success).toBe(true);
    expect(
      agentProposalSchema.safeParse({
        ...livingRoomStatusProposal,
        tool_calls: []
      }).success
    ).toBe(false);
  });
});

function createInterpreter(options: {
  structuredResponse?: unknown;
  error?: Error;
  deviceService?: SimulatedDeviceService;
  calls?: Parameters<AgentInvoker["invoke"]>[0][];
}) {
  const agent: AgentInvoker = {
    async invoke(input) {
      options.calls?.push(input);

      if (options.error) {
        throw options.error;
      }

      return {
        ...(options.structuredResponse !== undefined ? { structuredResponse: options.structuredResponse } : {})
      };
    }
  };

  return new LangChainDeepSeekInterpreter({
    apiKey: "test-key",
    model: "deepseek-test",
    agent,
    ...(options.deviceService ? { deviceService: options.deviceService } : {})
  });
}

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
      return {
        kind: "unavailable" as const,
        reason: "platform_no_data" as const,
        message: "No data",
        stage: "platform_detail" as const
      };
    },
    async getRuntimeParams() {
      return [];
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
