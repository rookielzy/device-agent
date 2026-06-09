import { describe, expect, it, vi } from "vitest";
import { buildPlatformHeaders, JavaPlatformClient } from "../../../src/domain/platform/java-platform-client.js";
import { PlatformClientError, type PlatformClientConfig, type PlatformFetch } from "../../../src/domain/platform/platform-types.js";
import {
  financeRoomAirConditioner,
  financeRoomAirConditionerDetail,
  financeRoomPivotalParams,
  platformLoginResponse,
  platformProjectId,
  platformProjectOption
} from "../../fixtures/platform-api-fixtures.js";

const config: PlatformClientConfig = {
  userCenterBaseUrl: "https://user.example.test",
  iotBaseUrl: "https://iot.example.test/api",
  validationMobile: "13800000000",
  validationPassword: "secret-password",
  validationProjectId: String(platformProjectId),
  requestTimeoutMs: 1_000
};

describe("JavaPlatformClient", () => {
  it("logs in with validation credentials and stores the token response", async () => {
    const calls: FetchCall[] = [];
    const client = new JavaPlatformClient({
      config,
      fetch: createFetch(calls, [ok(platformLoginResponse)]),
      clock: () => 1_000
    });

    const session = await client.login();

    expect(session).toMatchObject({
      access_token: "access-token-001",
      token_type: "Bearer"
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://user.example.test/oauth/login");
    expect(calls[0]?.init.method).toBe("POST");
    expect(JSON.parse(calls[0]?.init.body ?? "{}")).toEqual({
      mobile: "13800000000",
      password: "secret-password"
    });
  });

  it("reuses unexpired tokens and refreshes nearly expired sessions", async () => {
    const calls: FetchCall[] = [];
    let now = 10_000;
    const client = new JavaPlatformClient({
      config,
      fetch: createFetch(calls, [
        ok({
          ...platformLoginResponse,
          expires_in: 120
        }),
        ok([financeRoomAirConditioner]),
        ok([financeRoomAirConditioner]),
        ok({
          ...platformLoginResponse,
          access_token: "access-token-002",
          expires_in: 120
        }),
        ok([financeRoomAirConditioner])
      ]),
      clock: () => now
    });

    await client.searchEquipment({ projectId: String(platformProjectId), alias: "财务室" });
    now = 40_000;
    await client.searchEquipment({ projectId: String(platformProjectId), alias: "财务室" });

    expect(calls.map((call) => new URL(call.url).pathname)).toEqual([
      "/oauth/login",
      "/api/option/equipment/simple",
      "/api/option/equipment/simple"
    ]);

    now = 80_000;
    await client.searchEquipment({ projectId: String(platformProjectId), alias: "财务室" });

    expect(calls.map((call) => new URL(call.url).pathname)).toEqual([
      "/oauth/login",
      "/api/option/equipment/simple",
      "/api/option/equipment/simple",
      "/oauth/login",
      "/api/option/equipment/simple"
    ]);
  });

  it("calls project, search, detail, and pivotal parameter endpoints with supported query inputs", async () => {
    const calls: FetchCall[] = [];
    const client = new JavaPlatformClient({
      config,
      fetch: createFetch(calls, [
        ok(platformLoginResponse),
        ok([platformProjectOption]),
        ok([financeRoomAirConditioner]),
        ok(financeRoomAirConditionerDetail),
        ok(financeRoomPivotalParams)
      ]),
      clock: () => 1_000
    });

    await expect(client.listProjectsOrAreas({ entityId: "10001", includeBusinessGrouping: "1" })).resolves.toEqual([platformProjectOption]);
    await expect(client.searchEquipment({
      projectId: String(platformProjectId),
      alias: "财务室",
      buildingId: "4001",
      equipmentTypeIds: ["2001", "2002"],
      filterMount: "1"
    })).resolves.toEqual([financeRoomAirConditioner]);
    await expect(client.getEquipment(String(financeRoomAirConditioner.id))).resolves.toEqual(financeRoomAirConditionerDetail);
    await expect(client.getPivotalParams(String(financeRoomAirConditioner.id))).resolves.toEqual(financeRoomPivotalParams);

    const searchUrl = new URL(calls[2]!.url);
    expect(searchUrl.pathname).toBe("/api/option/equipment/simple");
    expect(searchUrl.searchParams.get("projectId")).toBe(String(platformProjectId));
    expect(searchUrl.searchParams.get("alias")).toBe("财务室");
    expect(searchUrl.searchParams.get("buildingId")).toBe("4001");
    expect(searchUrl.searchParams.get("equipmentTypeIds")).toBe("2001,2002");
    expect(calls[2]?.init.headers?.Authorization).toBe("Bearer access-token-001");
  });

  it("builds bearer auth headers without using OpenAPI x-user-header samples", () => {
    expect(buildPlatformHeaders(platformLoginResponse)).toEqual({
      Authorization: "Bearer access-token-001"
    });
    expect(buildPlatformHeaders(platformLoginResponse)).not.toHaveProperty("x-user-header");
  });

  it("maps timeout, non-2xx, malformed JSON, and fetch rejection to sanitized failures", async () => {
    vi.useFakeTimers();
    try {
      const timeoutClient = new JavaPlatformClient({
        config: {
          ...config,
          requestTimeoutMs: 10
        },
        fetch: createFetch([], [
          ok(platformLoginResponse),
          neverSettlingResponse()
        ]),
        clock: () => 1_000
      });
      const timeoutPromise = timeoutClient.searchEquipment({ projectId: String(platformProjectId) });
      const timeoutAssertion = expect(timeoutPromise).rejects.toMatchObject({
        reason: "platform_timeout",
        operation: "search_equipment"
      });
      await vi.advanceTimersByTimeAsync(10);
      await timeoutAssertion;
    } finally {
      vi.useRealTimers();
    }

    const failureCases: Array<{ response: PlatformFetchResponse | Error; reason: PlatformClientError["reason"] }> = [
      { response: httpError(500), reason: "platform_error" },
      { response: malformedJson(), reason: "platform_error" },
      { response: new Error("network includes secret-password access-token-001 https://iot.example.test/api"), reason: "platform_error" }
    ];

    for (const failure of failureCases) {
      const client = new JavaPlatformClient({
        config,
        fetch: createFetch([], [ok(platformLoginResponse), failure.response]),
        clock: () => 1_000
      });

      try {
        await client.searchEquipment({ projectId: String(platformProjectId) });
        throw new Error("Expected platform request to fail");
      } catch (error) {
        expect(error).toBeInstanceOf(PlatformClientError);
        expect(error).toMatchObject({
          reason: failure.reason,
          operation: "search_equipment"
        });
        const serialized = JSON.stringify(error, ["name", "message", "reason", "operation"]);
        expect(serialized).not.toContain("secret-password");
        expect(serialized).not.toContain("access-token");
        expect(serialized).not.toContain("refresh-token");
        expect(serialized).not.toContain("https://iot.example.test");
        expect(serialized).not.toContain("13800000000");
      }
    }
  });

  it("gives the downstream request a fresh timeout budget after login refresh", async () => {
    vi.useFakeTimers();
    try {
      const calls: FetchCall[] = [];
      const client = new JavaPlatformClient({
        config: {
          ...config,
          requestTimeoutMs: 50
        },
        fetch: async (input, init) => {
          calls.push({
            url: String(input),
            init: init ?? {}
          });

          if (String(input).endsWith("/oauth/login")) {
            return new Promise((resolve) => {
              setTimeout(() => resolve(ok(platformLoginResponse)), 40);
            });
          }

          return new Promise((_, reject) => {
            init?.signal?.addEventListener("abort", () => reject(abortError()));
          });
        },
        clock: () => 1_000
      });

      const request = client.searchEquipment({ projectId: String(platformProjectId) });
      await vi.advanceTimersByTimeAsync(60);
      expect(calls).toHaveLength(2);
      expect(calls[1]?.init.signal?.aborted).toBe(false);

      const assertion = expect(request).rejects.toMatchObject({
        reason: "platform_timeout",
        operation: "search_equipment"
      });
      await vi.advanceTimersByTimeAsync(30);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("maps login failures to sanitized platform_auth_failed errors", async () => {
    const failureCases: Array<PlatformFetchResponse | Error> = [
      httpError(401),
      malformedJson(),
      new Error("login leaked secret-password 13800000000 https://user.example.test access-token-001")
    ];

    for (const response of failureCases) {
      const client = new JavaPlatformClient({
        config,
        fetch: createFetch([], [response]),
        clock: () => 1_000
      });

      try {
        await client.searchEquipment({ projectId: String(platformProjectId) });
        throw new Error("Expected login to fail");
      } catch (error) {
        expect(error).toBeInstanceOf(PlatformClientError);
        expect(error).toMatchObject({
          reason: "platform_auth_failed",
          operation: "login"
        });
        const serialized = JSON.stringify(error, ["name", "message", "reason", "operation"]);
        expect(serialized).not.toContain("secret-password");
        expect(serialized).not.toContain("13800000000");
        expect(serialized).not.toContain("https://user.example.test");
        expect(serialized).not.toContain("access-token");
      }
    }
  });

  it("distinguishes empty equipment detail from malformed detail payloads", async () => {
    const noDataClient = new JavaPlatformClient({
      config,
      fetch: createFetch([], [ok(platformLoginResponse), ok(null)]),
      clock: () => 1_000
    });
    const malformedClient = new JavaPlatformClient({
      config,
      fetch: createFetch([], [ok(platformLoginResponse), ok({ name: "" })]),
      clock: () => 1_000
    });

    await expect(noDataClient.getEquipment(String(financeRoomAirConditioner.id))).rejects.toMatchObject({
      reason: "platform_no_data",
      operation: "get_equipment"
    });
    await expect(malformedClient.getEquipment(String(financeRoomAirConditioner.id))).rejects.toMatchObject({
      reason: "platform_error",
      operation: "get_equipment"
    });
  });
});

type FetchCall = {
  url: string;
  init: NonNullable<Parameters<PlatformFetch>[1]>;
};

type QueuedFetchResponse = PlatformFetchResponse | {
  neverSettles: true;
};

type PlatformFetchResponse = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
};

function createFetch(calls: FetchCall[], responses: Array<QueuedFetchResponse | Error>): PlatformFetch {
  return async (input, init) => {
    calls.push({
      url: String(input),
      init: init ?? {}
    });

    if (responses.length === 0) {
      throw new Error("No fake fetch response queued");
    }

    const response = responses.shift()!;
    if (response instanceof Error) {
      throw response;
    }

    if (init?.signal?.aborted) {
      throw abortError();
    }

    if (isNeverSettlingResponse(response)) {
      return new Promise((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(abortError()));
      });
    }

    return response;
  };
}

function ok(body: unknown): PlatformFetchResponse {
  return {
    ok: true,
    status: 200,
    async json() {
      return body;
    }
  };
}

function httpError(status: number): PlatformFetchResponse {
  return {
    ok: false,
    status,
    async json() {
      return {
        message: "backend error"
      };
    }
  };
}

function malformedJson(): PlatformFetchResponse {
  return {
    ok: true,
    status: 200,
    async json() {
      throw new Error("malformed json");
    }
  };
}

function abortError(): Error {
  const error = new Error("aborted");
  error.name = "AbortError";
  return error;
}

function neverSettlingResponse(): QueuedFetchResponse {
  return {
    neverSettles: true
  };
}

function isNeverSettlingResponse(response: QueuedFetchResponse): response is { neverSettles: true } {
  return "neverSettles" in response;
}
