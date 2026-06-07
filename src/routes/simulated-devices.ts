import type { FastifyInstance } from "fastify";
import { parseSimulatedDeviceSnapshotResponse } from "../contracts/api-contract.js";
import type { SimulatedDeviceService } from "../domain/devices/simulated-device-service.js";

export type RegisterSimulatedDeviceRoutesOptions = {
  deviceService: Pick<SimulatedDeviceService, "debugSnapshot">;
};

export function registerSimulatedDeviceRoutes(
  app: FastifyInstance,
  options: RegisterSimulatedDeviceRoutesOptions
): void {
  app.get("/debug/simulated-devices", async (_request, reply) => {
    reply.send(parseSimulatedDeviceSnapshotResponse(options.deviceService.debugSnapshot()));
  });
}
