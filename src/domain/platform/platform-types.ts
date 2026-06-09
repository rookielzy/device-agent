import type {
  EquipmentResp,
  EquipmentSingleResp,
  PivotalParamConfigValueResp,
  PlatformLoginResponse,
  UniversalFold
} from "../../contracts/platform-contract.js";

export type PlatformClientConfig = {
  userCenterBaseUrl: string;
  iotBaseUrl: string;
  validationMobile: string;
  validationPassword: string;
  validationProjectId: string;
  requestTimeoutMs: number;
};

export type PlatformFetch = (
  input: string | URL,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  }
) => Promise<PlatformFetchResponse>;

export type PlatformFetchResponse = {
  ok: boolean;
  status: number;
  statusText?: string;
  json(): Promise<unknown>;
};

export type PlatformAuthSession = PlatformLoginResponse & {
  expiresAtMs: number;
};

export type PlatformClientFailureReason =
  | "platform_auth_failed"
  | "platform_timeout"
  | "platform_error"
  | "platform_no_data";

export class PlatformClientError extends Error {
  readonly reason: PlatformClientFailureReason;
  readonly operation: string;

  constructor(reason: PlatformClientFailureReason, operation: string, message: string) {
    super(message);
    this.name = "PlatformClientError";
    this.reason = reason;
    this.operation = operation;
  }
}

export type SearchEquipmentParams = {
  projectId: string;
  businessGroupingId?: string;
  buildingId?: string;
  alias?: string;
  equipmentTypeId?: string;
  equipmentTypeIds?: string[];
  virtual?: "0" | "1";
  filterMount?: "0" | "1";
};

export type ListProjectsOrAreasParams = {
  entityId?: string;
  includeBusinessGrouping?: "0" | "1";
};

export type PlatformClient = {
  login(): Promise<PlatformAuthSession>;
  listProjectsOrAreas(params?: ListProjectsOrAreasParams): Promise<UniversalFold[]>;
  searchEquipment(params: SearchEquipmentParams): Promise<EquipmentSingleResp[]>;
  getEquipment(id: string): Promise<EquipmentResp>;
  getPivotalParams(equipmentId: string): Promise<PivotalParamConfigValueResp[]>;
};
