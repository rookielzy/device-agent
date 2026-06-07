import { describe, expect, it } from "vitest";
import { InMemoryTaskRepository } from "../../../src/domain/tasks/task-repository.js";
import {
  pendingControlTaskResult,
  statusQueryTaskResult
} from "../../fixtures/contract-fixtures.js";

describe("InMemoryTaskRepository", () => {
  it("saves and retrieves task results by task id", () => {
    const repository = new InMemoryTaskRepository();

    repository.save(statusQueryTaskResult);
    const result = repository.get(statusQueryTaskResult.taskId);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.task.executionState).toBe("completed");
    }
  });

  it("updates existing task snapshots", () => {
    const repository = new InMemoryTaskRepository();
    const { pendingControl: _pendingControl, ...rejectedTask } = pendingControlTaskResult;

    repository.save(pendingControlTaskResult);
    repository.save({
      ...rejectedTask,
      executionState: "rejected",
      outcomeReason: "control_rejected"
    });

    const result = repository.get(pendingControlTaskResult.taskId);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.task.executionState).toBe("rejected");
    }
  });

  it("returns a not-found result for unknown tasks", () => {
    const repository = new InMemoryTaskRepository();

    expect(repository.get("missing-task")).toEqual({
      ok: false,
      reason: "task_not_found"
    });
  });

  it("defensively snapshots records on save and read", () => {
    const repository = new InMemoryTaskRepository();
    const saved = repository.save(statusQueryTaskResult);
    saved.reply = "mutated outside";

    const first = repository.get(statusQueryTaskResult.taskId);
    expect(first.ok).toBe(true);
    if (first.ok) {
      first.task.reply = "mutated again";
    }

    const second = repository.get(statusQueryTaskResult.taskId);
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.task.reply).toBe(statusQueryTaskResult.reply);
    }
  });

  it("rejects invalid task result objects", () => {
    const repository = new InMemoryTaskRepository();

    expect(() =>
      repository.save({
        ...statusQueryTaskResult,
        timeline: []
      })
    ).toThrow();
  });
});
