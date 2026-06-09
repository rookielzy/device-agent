import { describe, expect, it } from "vitest";
import {
  equipmentRespSchema,
  equipmentSingleRespSchema,
  pivotalParamConfigValueRespSchema,
  platformLoginResponseSchema,
  universalFoldSchema
} from "../../src/contracts/platform-contract.js";
import {
  financeRoomAirConditioner,
  financeRoomAirConditionerDetail,
  financeRoomPivotalParams,
  platformLoginResponse,
  platformProjectOption
} from "../fixtures/platform-api-fixtures.js";

describe("platform API contracts", () => {
  it("parses representative OpenAPI-derived platform payloads", () => {
    expect(platformLoginResponseSchema.parse(platformLoginResponse).access_token).toBe("access-token-001");
    expect(universalFoldSchema.parse(platformProjectOption).id).toBe(270544150790145);
    expect(equipmentSingleRespSchema.parse(financeRoomAirConditioner).alias).toContain("财务室");
    expect(equipmentRespSchema.parse(financeRoomAirConditionerDetail).runStatus).toBe(2);
    expect(pivotalParamConfigValueRespSchema.parse(financeRoomPivotalParams[0]).name).toBe("开关状态");
  });

  it("preserves extra backend fields after validating required identifiers", () => {
    const parsed = equipmentSingleRespSchema.parse({
      ...financeRoomAirConditioner,
      backendOnlyField: {
        raw: true
      }
    });

    expect(parsed).toMatchObject({
      backendOnlyField: {
        raw: true
      }
    });
  });

  it("rejects malformed platform payloads missing IDs or pivotal parameter names", () => {
    expect(equipmentSingleRespSchema.safeParse({
      ...financeRoomAirConditioner,
      id: undefined
    }).success).toBe(false);
    expect(equipmentRespSchema.safeParse({
      ...financeRoomAirConditionerDetail,
      name: ""
    }).success).toBe(false);
    expect(pivotalParamConfigValueRespSchema.safeParse({
      ...financeRoomPivotalParams[0],
      name: undefined
    }).success).toBe(false);
  });
});
