import {
  taskResultSchema,
  type TaskResult
} from "../../contracts/task-contract.js";
import type { TaskLookupResult } from "./task-types.js";

export type TaskRepository = {
  save(task: TaskResult): TaskResult;
  get(taskId: string): TaskLookupResult;
  list(): TaskResult[];
};

export class InMemoryTaskRepository implements TaskRepository {
  readonly #tasks = new Map<string, TaskResult>();

  save(task: TaskResult): TaskResult {
    const parsed = taskResultSchema.parse(task);
    const snapshot = structuredClone(parsed);
    this.#tasks.set(snapshot.taskId, snapshot);

    return structuredClone(snapshot);
  }

  get(taskId: string): TaskLookupResult {
    const task = this.#tasks.get(taskId);

    if (!task) {
      return {
        ok: false,
        reason: "task_not_found"
      };
    }

    return {
      ok: true,
      task: structuredClone(task)
    };
  }

  list(): TaskResult[] {
    return structuredClone([...this.#tasks.values()]);
  }
}
