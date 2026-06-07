import type {
  PendingControl,
  TaskOutcomeReason,
  TaskResult
} from "../../contracts/task-contract.js";
import type { ControlTarget } from "../devices/device-types.js";

export type Clock = () => Date;
export type IdGenerator = () => string;

export type PendingControlStatus = "pending" | "confirmed" | "rejected" | "expired";

export type StoredPendingControl = {
  pendingControlId: string;
  taskId: string;
  target: PendingControl["target"];
  controlTarget: ControlTarget;
  confirmationSummary: string;
  expectedEffect: string;
  createdAt: string;
  expiresAt?: string;
  status: PendingControlStatus;
};

export type PendingControlFailureReason =
  | "pending_control_missing"
  | "pending_control_expired"
  | "pending_control_already_confirmed"
  | "pending_control_already_rejected";

export type PendingControlTransitionResult =
  | {
      ok: true;
      record: StoredPendingControl;
    }
  | {
      ok: false;
      reason: PendingControlFailureReason;
      record?: StoredPendingControl;
    };

export function pendingFailureToOutcomeReason(reason: PendingControlFailureReason): TaskOutcomeReason {
  return reason;
}

export type TaskLookupResult =
  | {
      ok: true;
      task: TaskResult;
    }
  | {
      ok: false;
      reason: "task_not_found";
    };
