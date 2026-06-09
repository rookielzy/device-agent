import type {
  EquipmentResp,
  EquipmentSingleResp,
  PivotalParamConfigValueResp,
  PlatformLoginResponse,
  UniversalFold
} from "../../src/contracts/platform-contract.js";

export const platformProjectId = 270544150790145;
export const platformEquipmentId = 99887766;

export const platformLoginResponse: PlatformLoginResponse = {
  access_token: "access-token-001",
  token_type: "Bearer",
  refresh_token: "refresh-token-001",
  expires_in: 7200,
  scope: "iot"
};

export const platformProjectOption: UniversalFold = {
  id: platformProjectId,
  name: "A 项目",
  parentId: 10001
};

export const financeRoomAirConditioner: EquipmentSingleResp = {
  id: platformEquipmentId,
  name: "一楼财务室空调",
  alias: "财务室空调",
  modelId: 1001,
  model: "VRF Indoor",
  typeId: 2001,
  type: "空调",
  serialNumber: "AC-FIN-001",
  templateId: 3001,
  projectId: platformProjectId,
  project: "A 项目",
  buildingId: 4001,
  building: "1楼",
  businessGroupingId: 5001,
  businessGrouping: "楼控系统"
};

export const duplicateFinanceRoomAirConditioner: EquipmentSingleResp = {
  ...financeRoomAirConditioner,
  id: 99887767,
  name: "一楼财务室备用空调",
  alias: "财务室备用空调",
  serialNumber: "AC-FIN-002"
};

export const financeRoomAirConditionerDetail: EquipmentResp = {
  ...financeRoomAirConditioner,
  gatewayId: 7001,
  gateway: "finance-room-gateway",
  runStatus: 2,
  status: 1,
  entityId: 10001,
  entity: "EK Admin",
  hasUnrecoveredAlarm: 0
};

export const offlineFinanceRoomAirConditionerDetail: EquipmentResp = {
  ...financeRoomAirConditionerDetail,
  runStatus: 0
};

export const financeRoomPivotalParams: PivotalParamConfigValueResp[] = [
  {
    name: "开关状态",
    enName: "powerSwitch",
    value: "1",
    unit: "",
    equipment: "一楼财务室空调",
    equipmentId: platformEquipmentId,
    splitGroup: "运行参数",
    splitGroupId: 11,
    splitGroupSort: 1
  },
  {
    name: "回风温度",
    enName: "returnAirTemperature",
    value: "23.5",
    unit: "℃",
    equipment: "一楼财务室空调",
    equipmentId: platformEquipmentId,
    splitGroup: "运行参数",
    splitGroupId: 11,
    splitGroupSort: 2
  },
  {
    name: "送风温度",
    enName: "supplyAirTemperature",
    value: "18.2",
    unit: "℃",
    equipment: "一楼财务室空调",
    equipmentId: platformEquipmentId,
    splitGroup: "运行参数",
    splitGroupId: 11,
    splitGroupSort: 3
  }
];

export const unrecognizedTemperatureParams: PivotalParamConfigValueResp[] = [
  {
    name: "送风温度",
    enName: "supplyAirTemperature",
    value: "18.2",
    unit: "℃",
    equipment: "一楼财务室空调",
    equipmentId: platformEquipmentId
  }
];
