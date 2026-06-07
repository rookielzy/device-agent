import { describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { apiErrorSchema } from "../../src/contracts/api-contract.js";
import { simulatedDeviceContextSchema, type SimulatedDeviceContext } from "../../src/contracts/device-contract.js";
import { taskResultSchema, type TaskResult } from "../../src/contracts/task-contract.js";
import { hallwayLightOnProposal } from "../fixtures/task-fixtures.js";
import { createTestApi } from "./api-test-helpers.js";
import type { SimulatedDevicesSnapshot } from "../../src/routes/simulated-devices.js";

describe("Simulated device debug HTTP API", () => {
  it("returns public simulated device contexts and offline availability", async () => {
    const api = createTestApi([]);

    try {
      const response = await api.app.inject({
        method: "GET",
        url: "/debug/simulated-devices"
      });
      const snapshot = response.json<SimulatedDevicesSnapshot>();

      expect(response.statusCode).toBe(200);
      expect(snapshot.devices.every((device) => simulatedDeviceContextSchema.safeParse(device).success)).toBe(true);
      expect(snapshot.devices.map((device) => device.type)).toEqual(expect.arrayContaining([
        "air_conditioner",
        "environment_sensor",
        "light"
      ]));
      expect(snapshot.devices.map((device) => device.deviceId)).toEqual(expect.arrayContaining([
        "device-ac-living-room",
        "device-sensor-bedroom",
        "device-light-hallway",
        "device-light-kitchen"
      ]));
      expect(kitchenLight(snapshot.devices)?.availability).toMatchObject({
        online: false,
        reason: expect.any(String)
      });
      expect(JSON.stringify(snapshot)).not.toContain("provider");
      expect(JSON.stringify(snapshot)).not.toContain("iot_adapter");
    } finally {
      await api.app.close();
    }
  });

  it("reflects confirmed controls and ignores pending or rejected controls", async () => {
    const confirmApi = createTestApi([hallwayLightOnProposal]);
    const rejectApi = createTestApi([hallwayLightOnProposal]);
    const pendingApi = createTestApi([hallwayLightOnProposal]);

    try {
      const confirmPending = taskResultSchema.parse((await confirmApi.app.inject({
        method: "POST",
        url: "/tasks",
        payload: { text: "Turn on the hallway light" }
      })).json<TaskResult>());
      const beforeConfirm = await devices(confirmApi.app);
      await confirmApi.app.inject({
        method: "POST",
        url: `/tasks/${confirmPending.taskId}/confirm`
      });
      const afterConfirm = await devices(confirmApi.app);

      const rejectPending = taskResultSchema.parse((await rejectApi.app.inject({
        method: "POST",
        url: "/tasks",
        payload: { text: "Turn on the hallway light" }
      })).json<TaskResult>());
      await rejectApi.app.inject({
        method: "POST",
        url: `/tasks/${rejectPending.taskId}/reject`
      });
      const afterReject = await devices(rejectApi.app);

      await pendingApi.app.inject({
        method: "POST",
        url: "/tasks",
        payload: { text: "Turn on the hallway light" }
      });
      const afterPending = await devices(pendingApi.app);

      expect(hallwayPower(beforeConfirm)).toBe(false);
      expect(hallwayPower(afterConfirm)).toBe(true);
      expect(hallwayPower(afterReject)).toBe(false);
      expect(hallwayPower(afterPending)).toBe(false);
    } finally {
      await confirmApi.app.close();
      await rejectApi.app.close();
      await pendingApi.app.close();
    }
  });

  it("normalizes unsupported debug snapshot methods into ApiError", async () => {
    const api = createTestApi([]);

    try {
      const response = await api.app.inject({
        method: "POST",
        url: "/debug/simulated-devices"
      });

      expect(response.statusCode).toBe(405);
      expect(apiErrorSchema.parse(response.json()).error).toMatchObject({
        code: "method_not_allowed",
        statusCode: 405
      });
    } finally {
      await api.app.close();
    }
  });
});

async function devices(app: FastifyInstance): Promise<SimulatedDeviceContext[]> {
  const response = await app.inject({
    method: "GET",
    url: "/debug/simulated-devices"
  });

  return response.json<SimulatedDevicesSnapshot>().devices;
}

function hallwayPower(devices: SimulatedDeviceContext[]): boolean | undefined {
  return devices.find((device) => device.deviceId === "device-light-hallway")?.readableValues.find((item) => item.itemId === "power")?.value as boolean | undefined;
}

function kitchenLight(devices: SimulatedDeviceContext[]): SimulatedDeviceContext | undefined {
  return devices.find((device) => device.deviceId === "device-light-kitchen");
}
