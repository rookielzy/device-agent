import { describe, expect, it } from "vitest";
import { taskResultSchema, type TaskResult } from "../../src/contracts/task-contract.js";
import { createTestApi } from "./api-test-helpers.js";

describe("platform capability task API", () => {
  it("creates a completed platform status task for the target utterance", async () => {
    const api = createTestApi([
      {
        kind: "platform_status_query",
        result: {
          kind: "platform_status_success",
          device: platformDevice("99887766", "财务室空调"),
          dataItems: [
            {
              deviceId: "99887766",
              itemId: "powerswitch",
              name: "开关状态",
              value: true,
              metadata: {
                kind: "boolean",
                label: "开关状态"
              },
              freshness: "fresh"
            },
            {
              deviceId: "99887766",
              itemId: "returnairtemperature",
              name: "回风温度",
              value: 23.5,
              metadata: {
                kind: "number",
                label: "回风温度",
                unit: "℃"
              },
              freshness: "fresh"
            }
          ],
          switchState: true,
          returnAirTemperature: 23.5,
          runStatusHint: "running"
        }
      }
    ]);

    try {
      const response = await api.app.inject({
        method: "POST",
        url: "/tasks",
        payload: { text: "A 项目 1 楼财务室空调开着吗，现在多少度" }
      });
      const result = taskResultSchema.parse(response.json<TaskResult>());

      expect(response.statusCode).toBe(201);
      expect(result.executionState).toBe("completed");
      expect(result.outcomeReason).toBe("none");
      expect(result.selectedDataItems.map((item) => [item.name, item.value])).toEqual([
        ["开关状态", true],
        ["回风温度", 23.5]
      ]);
      expect(result.timeline.map((event) => event.stage)).toContain("platform_runtime_read");
      expect(JSON.stringify(result)).not.toContain("runtimeParams");
      expect(JSON.stringify(result)).not.toContain("serialNumber");
    } finally {
      await api.app.close();
    }
  });

  it("returns clarification for duplicate platform equipment matches", async () => {
    const api = createTestApi([
      {
        kind: "platform_status_query",
        result: {
          kind: "ambiguous",
          reason: "ambiguous_target",
          candidates: [
            platformDevice("99887766", "财务室空调"),
            platformDevice("99887767", "财务室备用空调")
          ],
          stage: "platform_search"
        }
      }
    ]);

    try {
      const response = await api.app.inject({
        method: "POST",
        url: "/tasks",
        payload: { text: "财务室空调现在多少度" }
      });
      const result = taskResultSchema.parse(response.json<TaskResult>());

      expect(response.statusCode).toBe(201);
      expect(result.executionState).toBe("needs_clarification");
      expect(result.outcomeReason).toBe("ambiguous_target");
      expect(result.selectedContext.candidates.map((candidate) => candidate.displayName)).toEqual([
        "财务室空调",
        "财务室备用空调"
      ]);
    } finally {
      await api.app.close();
    }
  });
});

function platformDevice(deviceId: string, displayName: string) {
  return {
    deviceId,
    displayName,
    room: "财务室",
    type: "air_conditioner" as const,
    availability: {
      online: true
    },
    capabilities: ["platform_read", "read_air_conditioner_status"],
    readableValues: [],
    writableControls: []
  };
}
