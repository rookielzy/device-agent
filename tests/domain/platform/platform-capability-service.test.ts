import { describe, expect, it } from "vitest";
import { PlatformCapabilityService } from "../../../src/domain/platform/platform-capability-service.js";
import { PlatformClientError, type PlatformClient, type SearchEquipmentParams } from "../../../src/domain/platform/platform-types.js";
import {
  duplicateFinanceRoomAirConditioner,
  financeRoomAirConditioner,
  financeRoomAirConditionerDetail,
  financeRoomPivotalParams,
  offlineFinanceRoomAirConditionerDetail,
  platformEquipmentId,
  platformProjectId,
  unrecognizedTemperatureParams
} from "../../fixtures/platform-api-fixtures.js";

describe("PlatformCapabilityService", () => {
  it("resolves the target finance-room air conditioner and reads switch state plus return-air temperature", async () => {
    const client = createClient({
      searchResults: [[financeRoomAirConditioner]],
      runtimeParams: financeRoomPivotalParams
    });
    const service = createService(client);

    const result = await service.readAirConditionerStatus({
      projectName: "A 项目",
      room: "财务室",
      floor: "1楼",
      phrase: "A 项目 1 楼财务室空调开着吗，现在多少度"
    });

    expect(result).toMatchObject({
      kind: "platform_status_success",
      switchState: true,
      returnAirTemperature: 23.5
    });
    if (result.kind === "platform_status_success") {
      expect(result.device.displayName).toBe("财务室空调");
      expect(result.device.type).toBe("air_conditioner");
      expect(result.dataItems.map((item) => item.name)).toContain("回风温度");
      expect(result.dataItems.find((item) => item.name === "开关状态")?.value).toBe(true);
    }
    expect(client.searchCalls[0]).toEqual({
      projectId: String(platformProjectId),
      alias: "财务室"
    });
  });

  it("returns ambiguity when two matching air conditioners remain", async () => {
    const client = createClient({
      searchResults: [[financeRoomAirConditioner, duplicateFinanceRoomAirConditioner]]
    });
    const service = createService(client);

    const result = await service.readAirConditionerStatus({
      room: "财务室",
      deviceType: "air_conditioner"
    });

    expect(result).toMatchObject({
      kind: "ambiguous",
      reason: "ambiguous_target"
    });
    if (result.kind === "ambiguous") {
      expect(result.candidates.map((candidate) => candidate.deviceId)).toEqual([
        String(financeRoomAirConditioner.id),
        String(duplicateFinanceRoomAirConditioner.id)
      ]);
    }
  });

  it("continues when floor is missing if alias and type produce one result", async () => {
    const client = createClient({
      searchResults: [[financeRoomAirConditioner]],
      runtimeParams: financeRoomPivotalParams
    });
    const service = createService(client);

    const result = await service.readAirConditionerStatus({
      room: "财务室",
      deviceType: "air_conditioner"
    });

    expect(result.kind).toBe("platform_status_success");
  });

  it("does not invent buildingId from free-text floor and performs at most one broader fallback", async () => {
    const client = createClient({
      searchResults: [[], [financeRoomAirConditioner]],
      runtimeParams: financeRoomPivotalParams
    });
    const service = createService(client);

    const result = await service.readAirConditionerStatus({
      room: "财务室",
      floor: "1楼",
      deviceType: "air_conditioner"
    });

    expect(result.kind).toBe("platform_status_success");
    expect(client.searchCalls).toEqual([
      {
        projectId: String(platformProjectId),
        alias: "财务室"
      },
      {
        projectId: String(platformProjectId)
      }
    ]);
  });

  it("does not hard-filter configured-project results when optional project or building labels are absent", async () => {
    const { project: _project, building: _building, ...unlabeled } = financeRoomAirConditioner;
    const client = createClient({
      searchResults: [[unlabeled]],
      runtimeParams: financeRoomPivotalParams
    });
    const service = createService(client);

    const result = await service.readAirConditionerStatus({
      projectName: "A 项目",
      room: "财务室",
      floor: "1楼",
      deviceType: "air_conditioner"
    });

    expect(result.kind).toBe("platform_status_success");
  });

  it("returns metadata-unrecognized instead of fabricating a temperature from supply-air metadata", async () => {
    const client = createClient({
      searchResults: [[financeRoomAirConditioner]],
      runtimeParams: unrecognizedTemperatureParams
    });
    const service = createService(client);

    const result = await service.readAirConditionerStatus({
      room: "财务室",
      deviceType: "air_conditioner"
    });

    expect(result).toMatchObject({
      kind: "unavailable",
      reason: "metadata_unrecognized"
    });
    expect(JSON.stringify(result)).not.toContain("18.2");
  });

  it("uses runStatus for availability hints but not physical switch state when pivotal switch metadata is absent", async () => {
    const client = createClient({
      searchResults: [[financeRoomAirConditioner]],
      runtimeParams: [
        {
          name: "回风温度",
          enName: "returnAirTemperature",
          value: "24",
          unit: "℃",
          equipmentId: platformEquipmentId
        }
      ]
    });
    const service = createService(client);

    const result = await service.readAirConditionerStatus({
      room: "财务室",
      deviceType: "air_conditioner"
    });

    expect(result).toMatchObject({
      kind: "platform_status_success",
      returnAirTemperature: 24,
      runStatusHint: "running"
    });
    if (result.kind === "platform_status_success") {
      expect(result.switchState).toBeUndefined();
    }
  });

  it("maps timeout, no data, backend error, and offline detail into unavailable results", async () => {
    const timeout = await createService(createClient({
      searchError: new PlatformClientError("platform_timeout", "search_equipment", "safe")
    })).readAirConditionerStatus({ room: "财务室" });
    const noData = await createService(createClient({
      searchResults: [[]]
    })).readAirConditionerStatus({ room: "财务室" });
    const backend = await createService(createClient({
      searchResults: [[financeRoomAirConditioner]],
      detailError: new PlatformClientError("platform_error", "get_equipment", "safe")
    })).readAirConditionerStatus({ room: "财务室" });
    const offline = await createService(createClient({
      searchResults: [[financeRoomAirConditioner]],
      detail: offlineFinanceRoomAirConditionerDetail
    })).readAirConditionerStatus({ room: "财务室" });

    expect(timeout).toMatchObject({ kind: "unavailable", reason: "platform_timeout", stage: "platform_search" });
    expect(noData).toMatchObject({ kind: "unavailable", reason: "device_not_found", stage: "platform_search" });
    expect(backend).toMatchObject({ kind: "unavailable", reason: "platform_error", stage: "platform_detail" });
    expect(offline).toMatchObject({ kind: "unavailable", reason: "device_offline", stage: "platform_detail" });
    expect(backend).toMatchObject({ stage: "platform_detail" });
  });

  it("passes through basic runtime facts for non-air-conditioner equipment", async () => {
    const client = createClient({
      searchResults: [[
        {
          ...financeRoomAirConditioner,
          type: "环境传感器",
          name: "财务室温湿度传感器",
          alias: "财务室传感器"
        }
      ]],
      detail: {
        ...financeRoomAirConditionerDetail,
        type: "环境传感器",
        runStatus: 1
      },
      runtimeParams: unrecognizedTemperatureParams
    });
    const service = createService(client);

    const result = await service.readAirConditionerStatus({
      room: "财务室",
      deviceType: "generic"
    });

    expect(result.kind).toBe("platform_status_success");
    if (result.kind === "platform_status_success") {
      expect(result.device.type).toBe("generic");
      expect(result.dataItems.map((item) => item.name)).toEqual(["送风温度"]);
    }
  });
});

type FakeClient = PlatformClient & {
  searchCalls: SearchEquipmentParams[];
};

function createService(client: FakeClient): PlatformCapabilityService {
  return new PlatformCapabilityService({
    client,
    validationProjectId: String(platformProjectId)
  });
}

function createClient(options: {
  searchResults?: Array<typeof financeRoomAirConditioner[]>;
  searchError?: Error;
  detail?: typeof financeRoomAirConditionerDetail;
  detailError?: Error;
  runtimeParams?: typeof financeRoomPivotalParams;
  runtimeError?: Error;
}): FakeClient {
  const searchCalls: SearchEquipmentParams[] = [];
  const searchResults = [...(options.searchResults ?? [])];

  return {
    searchCalls,
    async login() {
      throw new Error("not used");
    },
    async listProjectsOrAreas() {
      return [];
    },
    async searchEquipment(params) {
      searchCalls.push(params);
      if (options.searchError) {
        throw options.searchError;
      }

      return searchResults.shift() ?? [];
    },
    async getEquipment() {
      if (options.detailError) {
        throw options.detailError;
      }

      return options.detail ?? financeRoomAirConditionerDetail;
    },
    async getPivotalParams() {
      if (options.runtimeError) {
        throw options.runtimeError;
      }

      return options.runtimeParams ?? financeRoomPivotalParams;
    }
  };
}
