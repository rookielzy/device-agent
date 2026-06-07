import { describe, expect, it } from "vitest";
import {
  closeApp,
  createApiTestApp,
  hallwayPowerFromDebug,
  kitchenLightFromDebug,
  parseApiErrorResponse,
  parseDebugDeviceResponse,
  parseTaskResponse
} from "./api-test-helpers.js";
import {
  hallwayLightOnProposal
} from "../fixtures/task-fixtures.js";

describe("Simulated device debug API", () => {
  it("returns a read-only snapshot of the simulated device catalog", async () => {
    const { app } = createApiTestApp();

    try {
      const response = await app.inject({
        method: "GET",
        url: "/debug/simulated-devices"
      });
      const devices = parseDebugDeviceResponse(response.payload);

      expect(response.statusCode).toBe(200);
      expect(devices.map((device) => device.deviceId)).toEqual([
        "device-ac-living-room",
        "device-light-hallway",
        "device-light-kitchen",
        "device-sensor-bedroom",
        "device-light-bedroom"
      ]);
      expect(devices.find((device) => device.deviceId === "device-ac-living-room")?.readableValues).toHaveLength(4);
      expect(devices.find((device) => device.deviceId === "device-sensor-bedroom")?.type).toBe("environment_sensor");
    } finally {
      await closeApp(app);
    }
  });

  it("reflects confirmed controls through the same shared device service", async () => {
    const { app } = createApiTestApp({
      proposals: [hallwayLightOnProposal]
    });

    try {
      const pending = parseTaskResponse(
        (
          await app.inject({
            method: "POST",
            url: "/tasks",
            payload: {
              text: "Turn on the hallway light"
            }
          })
        ).payload
      );
      const before = parseDebugDeviceResponse(
        (
          await app.inject({
            method: "GET",
            url: "/debug/simulated-devices"
          })
        ).payload
      );

      await app.inject({
        method: "POST",
        url: `/tasks/${pending.taskId}/confirm`,
        payload: {}
      });
      const after = parseDebugDeviceResponse(
        (
          await app.inject({
            method: "GET",
            url: "/debug/simulated-devices"
          })
        ).payload
      );

      expect(hallwayPowerFromDebug(before)).toBe(false);
      expect(hallwayPowerFromDebug(after)).toBe(true);
    } finally {
      await closeApp(app);
    }
  });

  it("remains unchanged after unconfirmed and rejected pending controls", async () => {
    const { app } = createApiTestApp({
      proposals: [hallwayLightOnProposal, hallwayLightOnProposal]
    });

    try {
      const firstPending = parseTaskResponse(
        (
          await app.inject({
            method: "POST",
            url: "/tasks",
            payload: {
              text: "Turn on the hallway light"
            }
          })
        ).payload
      );
      const unconfirmed = parseDebugDeviceResponse(
        (
          await app.inject({
            method: "GET",
            url: "/debug/simulated-devices"
          })
        ).payload
      );

      await app.inject({
        method: "POST",
        url: `/tasks/${firstPending.taskId}/reject`,
        payload: {}
      });
      const rejected = parseDebugDeviceResponse(
        (
          await app.inject({
            method: "GET",
            url: "/debug/simulated-devices"
          })
        ).payload
      );

      expect(hallwayPowerFromDebug(unconfirmed)).toBe(false);
      expect(hallwayPowerFromDebug(rejected)).toBe(false);
    } finally {
      await closeApp(app);
    }
  });

  it("exposes offline availability without adding write/debug mutation endpoints", async () => {
    const { app } = createApiTestApp();

    try {
      const snapshot = parseDebugDeviceResponse(
        (
          await app.inject({
            method: "GET",
            url: "/debug/simulated-devices"
          })
        ).payload
      );
      const putResponse = await app.inject({
        method: "PUT",
        url: "/debug/simulated-devices",
        payload: {
          devices: []
        }
      });

      expect(kitchenLightFromDebug(snapshot)?.availability).toEqual({
        online: false,
        reason: "Device has not reported heartbeat in 15 minutes"
      });
      expect(putResponse.statusCode).toBe(404);
      expect(parseApiErrorResponse(putResponse.payload).error.code).toBe("not_found");
    } finally {
      await closeApp(app);
    }
  });
});
