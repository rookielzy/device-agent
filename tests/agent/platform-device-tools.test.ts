import { describe, expect, it } from "vitest";
import { createPlatformDeviceTools } from "../../src/agent/platform-device-tools.js";
import type { PlatformCapabilityService } from "../../src/domain/platform/platform-capability-service.js";
import {
  financeRoomAirConditioner,
  financeRoomAirConditionerDetail,
  financeRoomPivotalParams
} from "../fixtures/platform-api-fixtures.js";

describe("platform device tools", () => {
  it("serializes successful search, detail, runtime, and status fixture results", async () => {
    const tools = createPlatformDeviceTools(createService({
      statusResult: {
        kind: "platform_status_success",
        device: {
          deviceId: String(financeRoomAirConditioner.id),
          displayName: "财务室空调",
          room: "财务室",
          type: "air_conditioner",
          availability: { online: true },
          capabilities: ["platform_read"],
          readableValues: [],
          writableControls: []
        },
        dataItems: [],
        switchState: true,
        returnAirTemperature: 23.5,
        runStatusHint: "running"
      }
    }));

    await expect(invokeTool(tools[1], { room: "财务室", deviceType: "air_conditioner" })).resolves.toMatchObject({
      kind: "search_success",
      candidates: [
        {
          device: {
            deviceId: String(financeRoomAirConditioner.id)
          }
        }
      ]
    });
    await expect(invokeTool(tools[2], { equipmentId: String(financeRoomAirConditioner.id) })).resolves.toMatchObject({
      id: financeRoomAirConditioner.id
    });
    await expect(invokeTool(tools[3], { equipmentId: String(financeRoomAirConditioner.id) })).resolves.toEqual(financeRoomPivotalParams);
    await expect(invokeTool(tools[4], { room: "财务室", deviceType: "air_conditioner" })).resolves.toMatchObject({
      kind: "platform_status_success",
      returnAirTemperature: 23.5
    });
  });

  it("serializes ambiguous, not-found, timeout, and metadata-unrecognized results with stable reason fields", async () => {
    const tools = createPlatformDeviceTools(createService({
      statusResult: {
        kind: "unavailable",
        reason: "metadata_unrecognized",
        message: "metadata unavailable",
        stage: "platform_runtime_read"
      },
      searchResult: {
        kind: "ambiguous",
        reason: "ambiguous_target",
        candidates: [],
        message: "Multiple matching platform devices were found.",
        stage: "platform_search"
      }
    }));

    await expect(invokeTool(tools[1], { room: "财务室" })).resolves.toMatchObject({
      kind: "ambiguous",
      reason: "ambiguous_target"
    });
    await expect(invokeTool(tools[4], { room: "财务室" })).resolves.toMatchObject({
      kind: "unavailable",
      reason: "metadata_unrecognized"
    });

    const unavailableTools = createPlatformDeviceTools(createService({
      searchResult: {
        kind: "unavailable",
        reason: "platform_timeout",
        message: "Platform equipment search failed.",
        stage: "platform_search"
      },
      statusResult: {
        kind: "unavailable",
        reason: "device_not_found",
        message: "No matching platform device was found.",
        stage: "platform_search"
      }
    }));

    await expect(invokeTool(unavailableTools[1], { room: "财务室" })).resolves.toMatchObject({
      kind: "unavailable",
      reason: "platform_timeout"
    });
    await expect(invokeTool(unavailableTools[4], { room: "财务室" })).resolves.toMatchObject({
      kind: "unavailable",
      reason: "device_not_found"
    });
  });
});

function invokeTool(tool: unknown, input: unknown): Promise<unknown> {
  return (tool as { invoke(input: unknown): Promise<unknown> }).invoke(input);
}

function createService(options: {
  searchResult?: Awaited<ReturnType<PlatformCapabilityService["searchDevices"]>>;
  statusResult: Awaited<ReturnType<PlatformCapabilityService["readAirConditionerStatus"]>>;
}): Pick<PlatformCapabilityService, "listProjectsOrAreas" | "searchDevices" | "getEquipmentDetail" | "getRuntimeParams" | "readAirConditionerStatus"> {
  return {
    async listProjectsOrAreas() {
      return {
        kind: "project_list_success" as const,
        projects: []
      };
    },
    async searchDevices() {
      return options.searchResult ?? {
        kind: "search_success",
        raw: [financeRoomAirConditioner],
        candidates: [
          {
            raw: financeRoomAirConditioner,
            device: {
              deviceId: String(financeRoomAirConditioner.id),
              displayName: "财务室空调",
              room: "财务室",
              type: "air_conditioner",
              availability: { online: true },
              capabilities: ["platform_read"],
              readableValues: [],
              writableControls: []
            }
          }
        ]
      };
    },
    async getEquipmentDetail() {
      return financeRoomAirConditionerDetail;
    },
    async getRuntimeParams() {
      return financeRoomPivotalParams;
    },
    async readAirConditionerStatus() {
      return options.statusResult;
    }
  };
}
