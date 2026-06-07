import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { parseApiResponse } from "../contracts/api-contract.js";
import { simulatedDeviceContextSchema } from "../contracts/device-contract.js";
import type { SimulatedDeviceService } from "../domain/devices/simulated-device-service.js";

export type SimulatedDeviceRoutesOptions = {
  simulatedDeviceService: SimulatedDeviceService;
};

const simulatedDevicesSnapshotSchema = z.object({
  devices: z.array(simulatedDeviceContextSchema)
}).strict();

export const registerSimulatedDeviceRoutes: FastifyPluginAsync<SimulatedDeviceRoutesOptions> = async (app, options) => {
  app.get("/debug/simulated-devices", async () => {
    return parseApiResponse(simulatedDevicesSnapshotSchema, {
      devices: options.simulatedDeviceService.debugSnapshot()
    });
  });
};

export type SimulatedDevicesSnapshot = z.infer<typeof simulatedDevicesSnapshotSchema>;
