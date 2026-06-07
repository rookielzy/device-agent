import { describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { FakeInterpreter } from "../../src/agent/fake-interpreter.js";
import { buildApp } from "../../src/app.js";
import { simulatedDeviceContextSchema } from "../../src/contracts/device-contract.js";
import { taskResultSchema, type TaskResult } from "../../src/contracts/task-contract.js";
import { SimulatedDeviceService } from "../../src/domain/devices/simulated-device-service.js";
import { TaskService } from "../../src/domain/tasks/task-service.js";
import { createFixedClock, createIdSequence } from "../fixtures/task-fixtures.js";
import { sampleUtterances } from "../fixtures/sample-utterances.js";

describe("Agent Plan Contract HTTP acceptance examples", () => {
  it("covers status, confirmed control, unconfirmed/rejected control, offline control, and ambiguity over HTTP", async () => {
    const clock = createFixedClock();
    const simulatedDeviceService = new SimulatedDeviceService({ clock });
    const taskService = new TaskService({
      interpreter: new FakeInterpreter(),
      deviceService: simulatedDeviceService,
      clock,
      taskIdGenerator: createIdSequence("task"),
      pendingControlIdGenerator: createIdSequence("pending"),
      timelineEventIdGenerator: createIdSequence("evt")
    });
    const app = buildApp({
      dependencies: {
        taskService,
        simulatedDeviceService
      }
    });

    try {
      const status = await createTask(app, textFor("ae1-living-room-ac-status"));
      expect(status.executionState).toBe("completed");
      expect(status.selectedDataItems.map((item) => item.itemId)).toEqual([
        "power",
        "mode",
        "target_temperature",
        "room_temperature"
      ]);
      expect(status.timeline.some((event) => event.source === "simulated_device")).toBe(true);

      const confirmedPending = await createTask(app, textFor("ae2-hallway-light-on"));
      const beforeConfirm = await debugDevices(app);
      const confirmed = taskResultSchema.parse((await app.inject({
        method: "POST",
        url: `/tasks/${confirmedPending.taskId}/confirm`
      })).json<TaskResult>());
      const afterConfirm = await debugDevices(app);
      expect(confirmedPending.executionState).toBe("pending_confirmation");
      expect(confirmed.executionState).toBe("completed");
      expect(hallwayPower(beforeConfirm)).toBe(false);
      expect(hallwayPower(afterConfirm)).toBe(true);

      const unconfirmedPending = await createTask(app, textFor("ae3-unconfirmed-hallway-light"));
      const afterSecondPending = await debugDevices(app);
      const rejected = taskResultSchema.parse((await app.inject({
        method: "POST",
        url: `/tasks/${unconfirmedPending.taskId}/reject`
      })).json<TaskResult>());
      const afterReject = await debugDevices(app);
      expect(unconfirmedPending.executionState).toBe("pending_confirmation");
      expect(rejected.executionState).toBe("rejected");
      expect(hallwayPower(afterSecondPending)).toBe(true);
      expect(hallwayPower(afterReject)).toBe(true);

      const offline = await createTask(app, textFor("ae4-offline-kitchen-light"));
      expect(offline.executionState).toBe("unavailable");
      expect(offline.outcomeReason).toBe("device_offline");
      expect(offline.pendingControl).toBeUndefined();
      expect(offline.timeline.map((event) => event.stage)).not.toContain("simulated_execution");

      const ambiguous = await createTask(app, textFor("ae5-vague-bedroom-device"));
      expect(ambiguous.executionState).toBe("needs_clarification");
      expect(ambiguous.outcomeReason).toBe("ambiguous_target");
      expect(ambiguous.selectedContext.candidates.length).toBeGreaterThan(1);

      const devices = await debugDevices(app);
      expect(devices.every((device) => simulatedDeviceContextSchema.safeParse(device).success)).toBe(true);
    } finally {
      await app.close();
    }
  });
});

async function createTask(app: FastifyInstance, text: string): Promise<TaskResult> {
  const response = await app.inject({
    method: "POST",
    url: "/tasks",
    payload: { text }
  });

  expect(response.statusCode).toBe(201);

  return taskResultSchema.parse(response.json<TaskResult>());
}

async function debugDevices(app: FastifyInstance) {
  const response = await app.inject({
    method: "GET",
    url: "/debug/simulated-devices"
  });

  return response.json<{ devices: unknown[] }>().devices.map((device) => simulatedDeviceContextSchema.parse(device));
}

function hallwayPower(devices: Array<{ deviceId: string; readableValues: Array<{ itemId: string; value?: unknown }> }>): boolean | undefined {
  return devices.find((device) => device.deviceId === "device-light-hallway")?.readableValues.find((item) => item.itemId === "power")?.value as boolean | undefined;
}

function textFor(id: string): string {
  const utterance = sampleUtterances.find((candidate) => candidate.id === id);

  if (!utterance) {
    throw new Error(`Missing sample utterance ${id}`);
  }

  return utterance.text;
}
