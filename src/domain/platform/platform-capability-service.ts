import type {
  SelectedDataItem,
  SimulatedDeviceContext
} from "../../contracts/device-contract.js";
import type {
  EquipmentResp,
  EquipmentSingleResp,
  PivotalParamConfigValueResp,
  UniversalFold
} from "../../contracts/platform-contract.js";
import {
  equipmentMatchesConstraints,
  equipmentToDeviceContext,
  hasAirConditionerText,
  isReturnAirTemperatureDataItem,
  isSupplyAirTemperatureDataItem,
  isSwitchDataItem,
  runStatusHint,
  runtimeFactsFor
} from "./platform-mappers.js";
import {
  PlatformClientError,
  type PlatformClient
} from "./platform-types.js";

export type PlatformDeviceQuery = {
  projectId?: string;
  projectName?: string;
  room?: string;
  floor?: string;
  deviceName?: string;
  deviceType?: "air_conditioner" | "generic";
  dataItem?: string;
  phrase?: string;
};

export type PlatformCandidate = {
  device: SimulatedDeviceContext;
  raw: EquipmentSingleResp;
};

export type PlatformStatusSuccess = {
  kind: "platform_status_success";
  device: SimulatedDeviceContext;
  dataItems: SelectedDataItem[];
  switchState?: boolean;
  returnAirTemperature?: number;
  runStatusHint?: "unknown" | "offline" | "online" | "running" | "stopped";
};

export type PlatformFailureStage =
  | "platform_auth"
  | "platform_search"
  | "platform_detail"
  | "platform_runtime_read";

export type PlatformStatusAmbiguous = {
  kind: "ambiguous";
  reason: "ambiguous_target";
  candidates: SimulatedDeviceContext[];
  message: string;
  stage: "platform_search";
};

export type PlatformStatusUnavailable = {
  kind: "unavailable";
  reason:
    | "platform_auth_failed"
    | "platform_timeout"
    | "platform_error"
    | "platform_no_data"
    | "device_not_found"
    | "device_offline"
    | "metadata_unrecognized";
  device?: SimulatedDeviceContext;
  candidates?: SimulatedDeviceContext[];
  message: string;
  stage: PlatformFailureStage;
};

export type PlatformProjectListResult =
  | {
      kind: "project_list_success";
      projects: UniversalFold[];
    }
  | PlatformStatusUnavailable;

export type PlatformSearchResult =
  | {
      kind: "search_success";
      candidates: PlatformCandidate[];
      raw: EquipmentSingleResp[];
    }
  | PlatformStatusAmbiguous
  | PlatformStatusUnavailable;

export type PlatformStatusResult =
  | PlatformStatusSuccess
  | PlatformStatusAmbiguous
  | PlatformStatusUnavailable;

export class PlatformCapabilityService {
  readonly #client: PlatformClient;
  readonly #validationProjectId: string;

  constructor(options: {
    client: PlatformClient;
    validationProjectId: string;
  }) {
    this.#client = options.client;
    this.#validationProjectId = options.validationProjectId;
  }

  async listProjectsOrAreas(): Promise<PlatformProjectListResult> {
    try {
      return {
        kind: "project_list_success",
        projects: await this.#client.listProjectsOrAreas()
      };
    } catch (error) {
      return unavailableFromClientError(error, "Platform project or area list is unavailable.", "platform_search");
    }
  }

  async searchDevices(query: PlatformDeviceQuery): Promise<PlatformSearchResult> {
    const projectId = query.projectId ?? this.#validationProjectId;

    try {
      const primary = await this.#client.searchEquipment({
        projectId,
        ...(query.room ? { alias: query.room } : {})
      });
      const primaryMatches = filterEquipment(primary, query);

      if (primaryMatches.length > 0) {
        return toSearchOutcome(primary, primaryMatches);
      }

      const fallback = await this.#client.searchEquipment({ projectId });
      const fallbackMatches = filterEquipment(fallback, query);

      return toSearchOutcome(fallback, fallbackMatches);
    } catch (error) {
      return unavailableFromClientError(error, "Platform equipment search failed.", "platform_search");
    }
  }

  async getEquipmentDetail(equipmentId: string): Promise<EquipmentResp | PlatformStatusUnavailable> {
    try {
      return await this.#client.getEquipment(equipmentId);
    } catch (error) {
      return unavailableFromClientError(error, "Platform equipment detail is unavailable.", "platform_detail");
    }
  }

  async getRuntimeParams(equipmentId: string): Promise<PivotalParamConfigValueResp[] | PlatformStatusUnavailable> {
    try {
      return await this.#client.getPivotalParams(equipmentId);
    } catch (error) {
      return unavailableFromClientError(error, "Platform runtime parameters are unavailable.", "platform_runtime_read");
    }
  }

  async readAirConditionerStatus(query: PlatformDeviceQuery): Promise<PlatformStatusResult> {
    const search = await this.searchDevices({
      ...query,
      deviceType: query.deviceType ?? "air_conditioner"
    });

    if (search.kind !== "search_success") {
      return search;
    }

    if (search.candidates.length === 0) {
      return {
        kind: "unavailable",
        reason: "device_not_found",
        message: "No matching platform device was found.",
        stage: "platform_search"
      };
    }

    if (search.candidates.length > 1) {
      return {
        kind: "ambiguous",
        reason: "ambiguous_target",
        candidates: search.candidates.map((candidate) => candidate.device),
        message: "Multiple matching platform devices were found.",
        stage: "platform_search"
      };
    }

    const candidate = search.candidates[0]!;
    const detail = await this.getEquipmentDetail(String(candidate.raw.id));
    if (isUnavailable(detail)) {
      return {
        ...detail,
        device: candidate.device
      };
    }

    const runHint = runStatusHint(detail.runStatus);
    const deviceWithoutRuntime = equipmentToDeviceContext({
      equipment: candidate.raw,
      detail
    });

    if (runHint === "offline" || runHint === "unknown") {
      return {
        kind: "unavailable",
        reason: "device_offline",
        device: deviceWithoutRuntime,
        message: `${deviceWithoutRuntime.displayName} is offline or has unknown platform status.`,
        stage: "platform_detail"
      };
    }

    const runtimeParams = await this.getRuntimeParams(String(candidate.raw.id));
    if (isUnavailable(runtimeParams)) {
      return {
        ...runtimeParams,
        device: deviceWithoutRuntime
      };
    }

    if (runtimeParams.length === 0) {
      return {
        kind: "unavailable",
        reason: "platform_no_data",
        device: deviceWithoutRuntime,
        message: "Current runtime data is unavailable.",
        stage: "platform_runtime_read"
      };
    }

    const facts = runtimeFactsFor(String(candidate.raw.id), runtimeParams);
    const device = equipmentToDeviceContext({
      equipment: candidate.raw,
      detail,
      runtimeValues: facts.readableValues
    });

    if (hasAirConditionerText(candidate.raw) && facts.returnAirTemperature === undefined) {
      return {
        kind: "unavailable",
        reason: "metadata_unrecognized",
        device: deviceWithoutRuntime,
        message: "The current return-air temperature cannot be determined from available platform metadata.",
        stage: "platform_runtime_read"
      };
    }

    return {
      kind: "platform_status_success",
      device,
      dataItems: publicPlatformDataItems(facts.dataItems, device.type),
      ...(facts.switchState !== undefined ? { switchState: facts.switchState.value } : {}),
      ...(facts.returnAirTemperature !== undefined ? { returnAirTemperature: facts.returnAirTemperature.value } : {}),
      ...(runHint ? { runStatusHint: runHint } : {})
    };
  }
}

function filterEquipment(equipment: EquipmentSingleResp[], query: PlatformDeviceQuery): EquipmentSingleResp[] {
  const deviceName = query.deviceName;
  const room = query.room ?? extractRoom(query.phrase);

  return equipment.filter((candidate) => {
    if (deviceName && !contains(candidate.name, deviceName) && !contains(candidate.alias, deviceName)) {
      return false;
    }

    return equipmentMatchesConstraints({
      equipment: candidate,
      ...(room ? { room } : {}),
      ...(query.deviceType ? { deviceType: query.deviceType } : {})
    });
  });
}

function toSearchOutcome(raw: EquipmentSingleResp[], matches: EquipmentSingleResp[]): PlatformSearchResult {
  if (matches.length === 0) {
    return {
      kind: "search_success",
      candidates: [],
      raw
    };
  }

  const candidates = matches.map((equipment) => ({
    device: equipmentToDeviceContext({ equipment }),
    raw: equipment
  }));

  return {
    kind: "search_success",
    candidates,
    raw
  };
}

function unavailableFromClientError(error: unknown, fallbackMessage: string, stage: PlatformFailureStage): PlatformStatusUnavailable {
  if (error instanceof PlatformClientError) {
    return {
      kind: "unavailable",
      reason: error.reason,
      message: fallbackMessage,
      stage: error.reason === "platform_auth_failed" ? "platform_auth" : stage
    };
  }

  return {
    kind: "unavailable",
    reason: "platform_error",
    message: fallbackMessage,
    stage
  };
}

function isUnavailable<T>(value: T | PlatformStatusUnavailable): value is PlatformStatusUnavailable {
  return typeof value === "object" && value !== null && "kind" in value && value.kind === "unavailable";
}

function publicPlatformDataItems(dataItems: SelectedDataItem[], deviceType: SimulatedDeviceContext["type"]): SelectedDataItem[] {
  if (deviceType !== "air_conditioner") {
    return dataItems;
  }

  return dataItems.filter((item) => {
    return isSwitchDataItem(item) || isReturnAirTemperatureDataItem(item) || !isAirConditionerTemperatureItem(item);
  });
}

function isAirConditionerTemperatureItem(item: SelectedDataItem): boolean {
  return isSupplyAirTemperatureDataItem(item) || isReturnAirTemperatureDataItem(item);
}

function extractRoom(phrase: string | undefined): string | undefined {
  if (!phrase) {
    return undefined;
  }

  const match = phrase.match(/([\p{Script=Han}A-Za-z0-9_-]*财务室)/u);

  return match?.[1] ?? undefined;
}

function contains(value: string | undefined, needle: string): boolean {
  return value?.toLowerCase().replace(/\s+/g, "").includes(needle.toLowerCase().replace(/\s+/g, "")) ?? false;
}
