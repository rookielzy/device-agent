import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type {
  PlatformCapabilityService,
  PlatformDeviceQuery,
  PlatformSearchResult,
  PlatformStatusResult
} from "../domain/platform/platform-capability-service.js";
import { noopTracer, traceTimed, type Tracer } from "../observability/trace.js";

const platformQuerySchema = z.object({
  projectId: z.string().min(1).optional(),
  projectName: z.string().min(1).optional(),
  room: z.string().min(1).optional(),
  floor: z.string().min(1).optional(),
  deviceName: z.string().min(1).optional(),
  deviceType: z.enum(["air_conditioner", "generic"]).optional(),
  dataItem: z.string().min(1).optional(),
  phrase: z.string().min(1).optional()
}).strict();

const equipmentIdSchema = z.object({
  equipmentId: z.string().min(1)
}).strict();

export type PlatformDeviceToolSet = ReturnType<typeof createPlatformDeviceTools>;

export function createPlatformDeviceTools(platformService: Pick<
  PlatformCapabilityService,
  "listProjectsOrAreas" | "searchDevices" | "getEquipmentDetail" | "getRuntimeParams" | "readAirConditionerStatus"
>, tracer: Tracer = noopTracer) {
  return [
    tool(
      async () => traceTimed(
        tracer,
        "agent.tool.platform_device",
        "list_projects_or_areas",
        {
          toolName: "list_platform_projects_or_areas"
        },
        async () => {
          tracer.payload("debug", "agent.tool.platform_device", "list_projects_or_areas.input", {
            input: {}
          });
          const result = await platformService.listProjectsOrAreas();
          tracer.emit(toolResultLevel(result), "agent.tool.platform_device", "list_projects_or_areas.completed", summarizePlatformResult(result));
          tracer.payload("debug", "agent.tool.platform_device", "list_projects_or_areas.output", {
            output: result
          });

          return result;
        }
      ),
      {
        name: "list_platform_projects_or_areas",
        description: "List real-platform project or area options for inspection in read-only mode.",
        schema: z.object({}).strict()
      }
    ),
    tool(
      async (query) => traceTimed(
        tracer,
        "agent.tool.platform_device",
        "search_equipment",
        {
          toolName: "search_platform_equipment",
          query: summarizePlatformQuery(query)
        },
        async () => {
          tracer.payload("debug", "agent.tool.platform_device", "search_equipment.input", {
            input: query
          });
          const result = serializeSearchResult(await platformService.searchDevices(toPlatformDeviceQuery(query)));
          tracer.emit(toolResultLevel(result), "agent.tool.platform_device", "search_equipment.completed", summarizePlatformResult(result));
          tracer.payload("debug", "agent.tool.platform_device", "search_equipment.output", {
            output: result
          });

          return result;
        }
      ),
      {
        name: "search_platform_equipment",
        description: "Search real-platform equipment candidates by project, room, floor, device name, or device type. Read-only.",
        schema: platformQuerySchema
      }
    ),
    tool(
      async ({ equipmentId }) => traceTimed(
        tracer,
        "agent.tool.platform_device",
        "get_equipment_detail",
        {
          toolName: "get_platform_equipment_detail",
          equipmentId
        },
        async () => {
          tracer.payload("debug", "agent.tool.platform_device", "get_equipment_detail.input", {
            input: {
              equipmentId
            }
          });
          const result = await platformService.getEquipmentDetail(equipmentId);
          tracer.emit(toolResultLevel(result), "agent.tool.platform_device", "get_equipment_detail.completed", summarizePlatformResult(result));
          tracer.payload("debug", "agent.tool.platform_device", "get_equipment_detail.output", {
            output: result
          });

          return result;
        }
      ),
      {
        name: "get_platform_equipment_detail",
        description: "Fetch one real-platform equipment detail record by id. Read-only.",
        schema: equipmentIdSchema
      }
    ),
    tool(
      async ({ equipmentId }) => traceTimed(
        tracer,
        "agent.tool.platform_device",
        "get_runtime_params",
        {
          toolName: "get_platform_runtime_parameters",
          equipmentId
        },
        async () => {
          tracer.payload("debug", "agent.tool.platform_device", "get_runtime_params.input", {
            input: {
              equipmentId
            }
          });
          const result = await platformService.getRuntimeParams(equipmentId);
          tracer.emit(toolResultLevel(result), "agent.tool.platform_device", "get_runtime_params.completed", summarizePlatformResult(result));
          tracer.payload("debug", "agent.tool.platform_device", "get_runtime_params.output", {
            output: result
          });

          return result;
        }
      ),
      {
        name: "get_platform_runtime_parameters",
        description: "Fetch pivotal runtime parameters for one real-platform equipment id. Read-only.",
        schema: equipmentIdSchema
      }
    ),
    tool(
      async (query) => traceTimed(
        tracer,
        "agent.tool.platform_device",
        "read_air_conditioner_status",
        {
          toolName: "read_platform_air_conditioner_status",
          query: summarizePlatformQuery(query)
        },
        async () => {
          tracer.payload("debug", "agent.tool.platform_device", "read_air_conditioner_status.input", {
            input: query
          });
          const result = serializeStatusResult(await platformService.readAirConditionerStatus(toPlatformDeviceQuery(query)));
          tracer.emit(toolResultLevel(result), "agent.tool.platform_device", "read_air_conditioner_status.completed", summarizePlatformResult(result));
          tracer.payload("debug", "agent.tool.platform_device", "read_air_conditioner_status.output", {
            output: result
          });

          return result;
        }
      ),
      {
        name: "read_platform_air_conditioner_status",
        description: "Resolve one air conditioner and read switch state plus return-air temperature from real-platform runtime parameters. Read-only; return ambiguity instead of guessing.",
        schema: platformQuerySchema
      }
    )
  ];
}

function serializeSearchResult(result: PlatformSearchResult): PlatformSearchResult {
  return result;
}

function serializeStatusResult(result: PlatformStatusResult): PlatformStatusResult {
  return result;
}

export function toPlatformDeviceQuery(input: z.infer<typeof platformQuerySchema>): PlatformDeviceQuery {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined)
  ) as PlatformDeviceQuery;
}

function summarizePlatformQuery(query: unknown) {
  if (!isRecord(query)) {
    return {
      shape: typeof query
    };
  }

  return {
    projectId: stringField(query.projectId),
    projectName: stringField(query.projectName),
    room: stringField(query.room),
    floor: stringField(query.floor),
    deviceName: stringField(query.deviceName),
    deviceType: stringField(query.deviceType),
    dataItem: stringField(query.dataItem),
    phraseLength: typeof query.phrase === "string" ? query.phrase.length : undefined
  };
}

function summarizePlatformResult(result: unknown) {
  if (Array.isArray(result)) {
    return {
      kind: "runtime_parameters",
      itemCount: result.length
    };
  }

  if (!isRecord(result)) {
    return {
      kind: typeof result
    };
  }

  switch (result.kind) {
    case "project_list_success":
      return {
        kind: result.kind,
        projectCount: Array.isArray(result.projects) ? result.projects.length : undefined
      };
    case "search_success":
      return {
        kind: result.kind,
        candidateCount: Array.isArray(result.candidates) ? result.candidates.length : undefined,
        rawCount: Array.isArray(result.raw) ? result.raw.length : undefined
      };
    case "platform_status_success":
      return {
        kind: result.kind,
        deviceId: isRecord(result.device) ? stringField(result.device.deviceId) : undefined,
        dataItemCount: Array.isArray(result.dataItems) ? result.dataItems.length : undefined,
        hasSwitchState: typeof result.switchState === "boolean",
        hasReturnAirTemperature: typeof result.returnAirTemperature === "number"
      };
    case "ambiguous":
      return {
        kind: result.kind,
        reason: stringField(result.reason),
        candidateCount: Array.isArray(result.candidates) ? result.candidates.length : undefined,
        stage: stringField(result.stage)
      };
    case "unavailable":
      return {
        kind: result.kind,
        reason: stringField(result.reason),
        stage: stringField(result.stage),
        deviceId: isRecord(result.device) ? stringField(result.device.deviceId) : undefined,
        candidateCount: Array.isArray(result.candidates) ? result.candidates.length : undefined
      };
    default:
      return {
        kind: "equipment_detail",
        equipmentId: stringField(result.id),
        namePresent: typeof result.name === "string"
      };
  }
}

function toolResultLevel(result: unknown): "info" | "warn" {
  if (isRecord(result) && (result.kind === "unavailable" || result.kind === "ambiguous")) {
    return "warn";
  }

  return "info";
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
