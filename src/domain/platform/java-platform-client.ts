import {
  equipmentRespSchema,
  equipmentSingleRespListSchema,
  pivotalParamConfigValueRespListSchema,
  platformLoginResponseSchema,
  universalFoldListSchema
} from "../../contracts/platform-contract.js";
import type {
  EquipmentResp,
  EquipmentSingleResp,
  PivotalParamConfigValueResp,
  PlatformLoginResponse,
  UniversalFold
} from "../../contracts/platform-contract.js";
import {
  PlatformClientError,
  type ListProjectsOrAreasParams,
  type PlatformAuthSession,
  type PlatformClient,
  type PlatformClientConfig,
  type PlatformFetch,
  type SearchEquipmentParams
} from "./platform-types.js";

const TOKEN_REFRESH_SKEW_MS = 60_000;

export class JavaPlatformClient implements PlatformClient {
  readonly #config: PlatformClientConfig;
  readonly #fetch: PlatformFetch;
  readonly #clock: () => number;
  #session: PlatformAuthSession | undefined;

  constructor(options: {
    config: PlatformClientConfig;
    fetch?: PlatformFetch;
    clock?: () => number;
  }) {
    this.#config = options.config;
    this.#fetch = options.fetch ?? nativeFetch;
    this.#clock = options.clock ?? (() => Date.now());
  }

  async login(): Promise<PlatformAuthSession> {
    const now = this.#clock();
    if (this.#session && this.#session.expiresAtMs - TOKEN_REFRESH_SKEW_MS > now) {
      return this.#session;
    }

    const response = await this.#requestJson({
      baseUrl: this.#config.userCenterBaseUrl,
      path: "/oauth/login",
      method: "POST",
      operation: "login",
      auth: false,
      body: {
        mobile: this.#config.validationMobile,
        password: this.#config.validationPassword
      }
    });
    const login = parseOrThrow(
      () => platformLoginResponseSchema.parse(response),
      "platform_auth_failed",
      "login"
    );
    const session = toSession(login, now);
    this.#session = session;

    return session;
  }

  async listProjectsOrAreas(params: ListProjectsOrAreasParams = {}): Promise<UniversalFold[]> {
    const response = await this.#requestJson({
      baseUrl: this.#config.iotBaseUrl,
      path: "/option/project",
      method: "GET",
      operation: "list_projects_or_areas",
      auth: true,
      query: params
    });

    return parseOrThrow(
      () => universalFoldListSchema.parse(unwrapPlatformData(response)),
      "platform_error",
      "list_projects_or_areas"
    );
  }

  async searchEquipment(params: SearchEquipmentParams): Promise<EquipmentSingleResp[]> {
    const response = await this.#requestJson({
      baseUrl: this.#config.iotBaseUrl,
      path: "/option/equipment/simple",
      method: "GET",
      operation: "search_equipment",
      auth: true,
      query: {
        ...params,
        equipmentTypeIds: params.equipmentTypeIds?.join(",")
      }
    });

    return parseOrThrow(
      () => equipmentSingleRespListSchema.parse(unwrapPlatformData(response)),
      "platform_error",
      "search_equipment"
    );
  }

  async getEquipment(id: string): Promise<EquipmentResp> {
    const response = await this.#requestJson({
      baseUrl: this.#config.iotBaseUrl,
      path: "/equipment/get",
      method: "GET",
      operation: "get_equipment",
      auth: true,
      query: {
        id
      }
    });
    const data = unwrapPlatformData(response);

    if (data === null || data === undefined) {
      throw new PlatformClientError("platform_no_data", "get_equipment", safeMessage("get_equipment"));
    }

    return parseOrThrow(
      () => equipmentRespSchema.parse(data),
      "platform_error",
      "get_equipment"
    );
  }

  async getPivotalParams(equipmentId: string): Promise<PivotalParamConfigValueResp[]> {
    const response = await this.#requestJson({
      baseUrl: this.#config.iotBaseUrl,
      path: "/pivotal/param/get",
      method: "GET",
      operation: "get_pivotal_params",
      auth: true,
      query: {
        equipmentId
      }
    });

    return parseOrThrow(
      () => pivotalParamConfigValueRespListSchema.parse(unwrapPlatformData(response)),
      "platform_error",
      "get_pivotal_params"
    );
  }

  async #requestJson(input: {
    baseUrl: string;
    path: string;
    method: "GET" | "POST";
    operation: string;
    auth: boolean;
    query?: Record<string, string | string[] | undefined>;
    body?: Record<string, string>;
  }): Promise<unknown> {
    const headers: Record<string, string> = {
      Accept: "application/json"
    };
    if (input.body) {
      headers["Content-Type"] = "application/json";
    }
    if (input.auth) {
      Object.assign(headers, buildPlatformHeaders(await this.login()));
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#config.requestTimeoutMs);
    try {
      const response = await this.#fetch(buildUrl(input.baseUrl, input.path, input.query), {
        method: input.method,
        headers,
        ...(input.body ? { body: JSON.stringify(input.body) } : {}),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new PlatformClientError(reasonForHttpFailure(input.operation), input.operation, safeMessage(input.operation));
      }

      return await response.json();
    } catch (error) {
      if (error instanceof PlatformClientError) {
        throw error;
      }

      if (isAbortError(error)) {
        throw new PlatformClientError("platform_timeout", input.operation, safeMessage(input.operation));
      }

      throw new PlatformClientError(reasonForThrownFailure(input.operation), input.operation, safeMessage(input.operation));
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function buildPlatformHeaders(session: Pick<PlatformLoginResponse, "access_token" | "token_type">): Record<string, string> {
  return {
    Authorization: `${session.token_type} ${session.access_token}`
  };
}

function nativeFetch(input: string | URL, init?: Parameters<PlatformFetch>[1]): ReturnType<PlatformFetch> {
  return fetch(input, init);
}

function toSession(login: PlatformLoginResponse, nowMs: number): PlatformAuthSession {
  return {
    ...login,
    expiresAtMs: nowMs + login.expires_in * 1000
  };
}

function parseOrThrow<T>(
  parse: () => T,
  reason: PlatformClientError["reason"],
  operation: string
): T {
  try {
    return parse();
  } catch {
    throw new PlatformClientError(reason, operation, safeMessage(operation));
  }
}

function unwrapPlatformData(response: unknown): unknown {
  if (
    response !== null &&
    typeof response === "object" &&
    "data" in response
  ) {
    return (response as { data: unknown }).data;
  }

  return response;
}

function buildUrl(baseUrl: string, path: string, query: Record<string, string | string[] | undefined> = {}): string {
  const url = new URL(path.replace(/^\/+/, ""), normalizeBaseUrl(baseUrl));

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === "") {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        url.searchParams.append(key, item);
      }
      continue;
    }

    url.searchParams.set(key, value);
  }

  return url.toString();
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
}

function reasonForHttpFailure(operation: string): PlatformClientError["reason"] {
  return operation === "login" ? "platform_auth_failed" : "platform_error";
}

function reasonForThrownFailure(operation: string): PlatformClientError["reason"] {
  return operation === "login" ? "platform_auth_failed" : "platform_error";
}

function safeMessage(operation: string): string {
  return `Platform request failed during ${operation}.`;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
