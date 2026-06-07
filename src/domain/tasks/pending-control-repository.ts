import type {
  PendingControlFailureReason,
  PendingControlTransitionResult,
  StoredPendingControl
} from "./task-types.js";
import type { Clock } from "./task-types.js";

const defaultClock: Clock = () => new Date();

export type PendingControlRepository = {
  create(record: StoredPendingControl): StoredPendingControl;
  getByPendingControlId(pendingControlId: string): StoredPendingControl | undefined;
  getByTaskId(taskId: string): StoredPendingControl | undefined;
  validatePending(pendingControlId: string): PendingControlTransitionResult;
  markConfirmed(pendingControlId: string): PendingControlTransitionResult;
  markRejected(pendingControlId: string): PendingControlTransitionResult;
};

export class InMemoryPendingControlRepository implements PendingControlRepository {
  readonly #records = new Map<string, StoredPendingControl>();
  readonly #clock: Clock;

  constructor(options: { clock?: Clock } = {}) {
    this.#clock = options.clock ?? defaultClock;
  }

  create(record: StoredPendingControl): StoredPendingControl {
    const snapshot = structuredClone(record);
    this.#records.set(snapshot.pendingControlId, snapshot);

    return structuredClone(snapshot);
  }

  getByPendingControlId(pendingControlId: string): StoredPendingControl | undefined {
    return this.#snapshot(this.#records.get(pendingControlId));
  }

  getByTaskId(taskId: string): StoredPendingControl | undefined {
    const record = [...this.#records.values()].find((candidate) => candidate.taskId === taskId);

    return this.#snapshot(record);
  }

  validatePending(pendingControlId: string): PendingControlTransitionResult {
    const record = this.#records.get(pendingControlId);

    if (!record) {
      return {
        ok: false,
        reason: "pending_control_missing"
      };
    }

    const blocked = this.#blockedReason(record);
    if (blocked) {
      return {
        ok: false,
        reason: blocked,
        record: this.#snapshot(record)
      };
    }

    return {
      ok: true,
      record: this.#snapshot(record)!
    };
  }

  markConfirmed(pendingControlId: string): PendingControlTransitionResult {
    return this.#transition(pendingControlId, "confirmed");
  }

  markRejected(pendingControlId: string): PendingControlTransitionResult {
    return this.#transition(pendingControlId, "rejected");
  }

  #transition(pendingControlId: string, nextStatus: "confirmed" | "rejected"): PendingControlTransitionResult {
    const record = this.#records.get(pendingControlId);

    if (!record) {
      return {
        ok: false,
        reason: "pending_control_missing"
      };
    }

    const blocked = this.#blockedReason(record);
    if (blocked) {
      return {
        ok: false,
        reason: blocked,
        record: this.#snapshot(record)
      };
    }

    record.status = nextStatus;

    return {
      ok: true,
      record: this.#snapshot(record)!
    };
  }

  #blockedReason(record: StoredPendingControl): PendingControlFailureReason | undefined {
    if (record.status === "confirmed") {
      return "pending_control_already_confirmed";
    }

    if (record.status === "rejected") {
      return "pending_control_already_rejected";
    }

    if (record.status === "expired") {
      return "pending_control_expired";
    }

    if (record.expiresAt && Date.parse(record.expiresAt) <= this.#clock().getTime()) {
      record.status = "expired";

      return "pending_control_expired";
    }

    return undefined;
  }

  #snapshot<T extends StoredPendingControl | undefined>(record: T): T {
    return record ? structuredClone(record) : record;
  }
}
