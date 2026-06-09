import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type {
  PlatformCapabilityService,
  PlatformDeviceQuery,
  PlatformSearchResult,
  PlatformStatusResult
} from "../domain/platform/platform-capability-service.js";

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
>) {
  return [
    tool(
      async () => platformService.listProjectsOrAreas(),
      {
        name: "list_platform_projects_or_areas",
        description: "List real-platform project or area options for inspection in read-only mode.",
        schema: z.object({}).strict()
      }
    ),
    tool(
      async (query) => serializeSearchResult(await platformService.searchDevices(toPlatformDeviceQuery(query))),
      {
        name: "search_platform_equipment",
        description: "Search real-platform equipment candidates by project, room, floor, device name, or device type. Read-only.",
        schema: platformQuerySchema
      }
    ),
    tool(
      async ({ equipmentId }) => platformService.getEquipmentDetail(equipmentId),
      {
        name: "get_platform_equipment_detail",
        description: "Fetch one real-platform equipment detail record by id. Read-only.",
        schema: equipmentIdSchema
      }
    ),
    tool(
      async ({ equipmentId }) => platformService.getRuntimeParams(equipmentId),
      {
        name: "get_platform_runtime_parameters",
        description: "Fetch pivotal runtime parameters for one real-platform equipment id. Read-only.",
        schema: equipmentIdSchema
      }
    ),
    tool(
      async (query) => serializeStatusResult(await platformService.readAirConditionerStatus(toPlatformDeviceQuery(query))),
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
