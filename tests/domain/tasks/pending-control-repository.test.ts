import { describe, expect, it } from "vitest";
import { InMemoryPendingControlRepository } from "../../../src/domain/tasks/pending-control-repository.js";
import type { StoredPendingControl } from "../../../src/domain/tasks/task-types.js";
import { createMutableClock } from "../../fixtures/task-fixtures.js";
import { pendingControlTaskResult } from "../../fixtures/contract-fixtures.js";

const baseRecord: StoredPendingControl = {
  pendingControlId: "pending-001",
  taskId: "task-001",
  target: pendingControlTaskResult.pendingControl!.target,
  controlTarget: {
    deviceId: "device-light-hallway",
    controlItem: "power",
    requestedValue: true
  },
  confirmationSummary: "turn on the hallway light",
  expectedEffect: "Hallway Light power will change to true.",
  createdAt: "2026-06-07T09:00:00.000Z",
  expiresAt: "2026-06-07T09:10:00.000Z",
  status: "pending"
};

describe("InMemoryPendingControlRepository", () => {
  it("stores pending controls and returns defensive snapshots", () => {
    const repository = new InMemoryPendingControlRepository();

    const created = repository.create(baseRecord);
    created.confirmationSummary = "mutated outside";

    const loaded = repository.getByPendingControlId(baseRecord.pendingControlId);
    expect(loaded?.confirmationSummary).toBe(baseRecord.confirmationSummary);

    loaded!.target.name = "Changed outside";
    expect(repository.getByTaskId(baseRecord.taskId)?.target.name).toBe(baseRecord.target.name);
  });

  it("confirms a pending control exactly once", () => {
    const repository = new InMemoryPendingControlRepository();
    repository.create(baseRecord);

    const validation = repository.validatePending(baseRecord.pendingControlId);
    const first = repository.markConfirmed(baseRecord.pendingControlId);
    const second = repository.markConfirmed(baseRecord.pendingControlId);

    expect(validation.ok).toBe(true);
    if (validation.ok) {
      expect(validation.record.status).toBe("pending");
    }
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.record.status).toBe("confirmed");
    }
    expect(second).toMatchObject({
      ok: false,
      reason: "pending_control_already_confirmed"
    });
  });

  it("rejects a pending control exactly once", () => {
    const repository = new InMemoryPendingControlRepository();
    repository.create(baseRecord);

    const first = repository.markRejected(baseRecord.pendingControlId);
    const second = repository.markRejected(baseRecord.pendingControlId);

    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.record.status).toBe("rejected");
    }
    expect(second).toMatchObject({
      ok: false,
      reason: "pending_control_already_rejected"
    });
  });

  it("blocks missing and expired confirmations without executable records", () => {
    const mutable = createMutableClock(new Date("2026-06-07T09:11:00.000Z"));
    const repository = new InMemoryPendingControlRepository({ clock: mutable.clock });
    repository.create(baseRecord);

    expect(repository.markConfirmed("missing")).toEqual({
      ok: false,
      reason: "pending_control_missing"
    });
    expect(repository.markConfirmed(baseRecord.pendingControlId)).toMatchObject({
      ok: false,
      reason: "pending_control_expired",
      record: {
        status: "expired"
      }
    });
    expect(repository.markConfirmed(baseRecord.pendingControlId)).toMatchObject({
      ok: false,
      reason: "pending_control_expired"
    });
  });
});
