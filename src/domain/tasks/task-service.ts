import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import {
  taskResultSchema,
  type ExecutionState,
  type PendingControl,
  type StructuredPlan,
  type TaskClassification,
  type TaskOutcomeReason,
  type TaskResult,
  type TimelineEvent,
  type TimelineStatus
} from "../../contracts/task-contract.js";
import type {
  PublicValue,
  SelectedDataItem,
  SelectedDeviceContext,
  SimulatedDeviceContext
} from "../../contracts/device-contract.js";
import {
  type AgentInterpreter,
  type AgentProposal,
  parseAgentProposal
} from "../../agent/agent-interpreter.js";
import type {
  AmbiguousResult,
  DeviceControlApplyResult,
  DeviceControlProposalResult,
  DeviceReadResult,
  InvalidValueResult,
  NotFoundResult,
  UnavailableResult,
  UnsupportedResult
} from "../devices/device-results.js";
import { SimulatedDeviceService } from "../devices/simulated-device-service.js";
import type { ControlTarget, DeviceTarget } from "../devices/device-types.js";
import {
  InMemoryPendingControlRepository,
  type PendingControlRepository
} from "./pending-control-repository.js";
import {
  InMemoryTaskRepository,
  type TaskRepository
} from "./task-repository.js";
import { TimelineBuilder } from "./timeline.js";
import {
  pendingFailureToOutcomeReason,
  type Clock,
  type IdGenerator,
  type StoredPendingControl
} from "./task-types.js";

const defaultClock: Clock = () => new Date();

export type TaskServiceOptions = {
  interpreter: AgentInterpreter;
  deviceService?: SimulatedDeviceService;
  taskRepository?: TaskRepository;
  pendingControlRepository?: PendingControlRepository;
  clock?: Clock;
  taskIdGenerator?: IdGenerator;
  pendingControlIdGenerator?: IdGenerator;
  timelineEventIdGenerator?: IdGenerator;
  pendingControlTtlMs?: number;
};

export class TaskService {
  readonly #interpreter: AgentInterpreter;
  readonly #deviceService: SimulatedDeviceService;
  readonly #taskRepository: TaskRepository;
  readonly #pendingControlRepository: PendingControlRepository;
  readonly #clock: Clock;
  readonly #taskIdGenerator: IdGenerator;
  readonly #pendingControlIdGenerator: IdGenerator;
  readonly #timelineEventIdGenerator: IdGenerator;
  readonly #pendingControlTtlMs: number | undefined;

  constructor(options: TaskServiceOptions) {
    this.#interpreter = options.interpreter;
    this.#deviceService = options.deviceService ?? new SimulatedDeviceService({
      ...(options.clock ? { clock: options.clock } : {})
    });
    this.#taskRepository = options.taskRepository ?? new InMemoryTaskRepository();
    this.#pendingControlRepository =
      options.pendingControlRepository ?? new InMemoryPendingControlRepository({
        ...(options.clock ? { clock: options.clock } : {})
      });
    this.#clock = options.clock ?? defaultClock;
    this.#taskIdGenerator = options.taskIdGenerator ?? (() => `task-${randomUUID()}`);
    this.#pendingControlIdGenerator = options.pendingControlIdGenerator ?? (() => `pending-${randomUUID()}`);
    this.#timelineEventIdGenerator = options.timelineEventIdGenerator ?? (() => `evt-${randomUUID()}`);
    this.#pendingControlTtlMs = options.pendingControlTtlMs;
  }

  get taskRepository(): TaskRepository {
    return this.#taskRepository;
  }

  get pendingControlRepository(): PendingControlRepository {
    return this.#pendingControlRepository;
  }

  async createTask(originalText: string): Promise<TaskResult> {
    const taskId = this.#taskIdGenerator();
    const timeline = this.#newTimeline();
    timeline.requestReceived();

    let proposal: AgentProposal;
    try {
      proposal = parseAgentProposal(await this.#interpreter.interpret({ originalText }));
      timeline.modelInterpretation(proposal.kind === "parse_failure" ? "failed" : "succeeded", interpretationDetail(proposal));
    } catch (error) {
      timeline.modelInterpretation("failed", formatProposalParseError(error));

      return this.#saveTask({
        taskId,
        originalText,
        classification: "unsupported",
        executionState: "failed",
        outcomeReason: "parse_failure",
        reply: "I could not understand that request well enough to use a simulated device.",
        plan: planFor({
          summary: "Stop because the interpreter proposal could not be normalized.",
          confidence: 0,
          steps: [
            ["step-1", "Receive user request", "completed"],
            ["step-2", "Normalize interpreter proposal", "blocked"]
          ]
        }),
        selectedContext: emptySelectedContext(),
        selectedDataItems: [],
        selectedControlItems: [],
        timeline: finalEvents(timeline, "failed", "Returned parse failure outcome")
      });
    }

    switch (proposal.kind) {
      case "status_query":
        return this.#createStatusTask(taskId, originalText, proposal, timeline);
      case "control_request":
        return this.#createControlTask(taskId, originalText, proposal, timeline);
      case "ambiguous":
        timeline.serviceValidation("blocked", proposal.reason);

        return this.#saveTask({
          taskId,
          originalText,
          classification: "ambiguous",
          executionState: "needs_clarification",
          outcomeReason: "ambiguous_target",
          reply: "I found multiple possible devices. Please clarify which one to use.",
          plan: planFor({
            summary: proposal.summary ?? "Ask for clarification before selecting a simulated device.",
            confidence: proposal.confidence ?? 0.5,
            ambiguityReason: proposal.reason,
            steps: [
              ["step-1", "Interpret possible targets", "completed"],
              ["step-2", "Avoid selecting an executable action", "blocked"]
            ]
          }),
          selectedContext: {
            devices: [],
            dataItems: [],
            controlItems: [],
            candidates: proposal.candidates
          },
          selectedDataItems: [],
          selectedControlItems: [],
          timeline: finalEvents(timeline, "blocked", "Returned clarification request")
        });
      case "unsupported":
        timeline.serviceValidation("blocked", proposal.reason);

        return this.#saveTask({
          taskId,
          originalText,
          classification: "unsupported",
          executionState: "failed",
          outcomeReason: "unsupported_request",
          reply: "That request is not supported by the simulated device service.",
          plan: planFor({
            summary: proposal.summary ?? "Stop because the request is outside supported simulated-device behavior.",
            confidence: proposal.confidence ?? 0.4,
            steps: [
              ["step-1", "Interpret request", "completed"],
              ["step-2", "Block unsupported request", "blocked"]
            ]
          }),
          selectedContext: emptySelectedContext(),
          selectedDataItems: [],
          selectedControlItems: [],
          timeline: finalEvents(timeline, "blocked", "Returned unsupported request outcome")
        });
      case "parse_failure":
        timeline.serviceValidation("failed", proposal.detail ?? proposal.reason);

        return this.#saveTask({
          taskId,
          originalText,
          classification: "unsupported",
          executionState: "failed",
          outcomeReason: "parse_failure",
          reply: "I could not understand that request well enough to use a simulated device.",
          plan: planFor({
            summary: proposal.summary ?? "Stop because the interpreter reported a parse failure.",
            confidence: proposal.confidence ?? 0,
            steps: [
              ["step-1", "Interpret request", "blocked"],
              ["step-2", "Avoid selecting device state", "blocked"]
            ]
          }),
          selectedContext: emptySelectedContext(),
          selectedDataItems: [],
          selectedControlItems: [],
          timeline: finalEvents(timeline, "failed", "Returned parse failure outcome")
        });
    }
  }

  getTask(taskId: string) {
    return this.#taskRepository.get(taskId);
  }

  confirmTask(taskId: string): TaskResult {
    const stored = this.#taskRepository.get(taskId);
    const pending = this.#pendingControlRepository.getByTaskId(taskId);

    if (!stored.ok || !pending) {
      return this.#confirmationFailureTask({
        taskId,
        originalText: stored.ok ? stored.task.originalText : "Confirm pending control",
        ...(stored.ok ? { baseTask: stored.task } : {}),
        outcomeReason: "pending_control_missing",
        reply: "I could not find a pending control to confirm.",
        detail: "No pending control exists for this task"
      });
    }

    const transition = this.#pendingControlRepository.markConfirmed(pending.pendingControlId);
    if (!transition.ok) {
      return this.#blockedConfirmationTask({
        baseTask: stored.task,
        pending: transition.record ?? pending,
        outcomeReason: pendingFailureToOutcomeReason(transition.reason),
        reply: replyForPendingFailure(transition.reason),
        detail: detailForPendingFailure(transition.reason)
      });
    }

    const timeline = this.#timelineFrom(stored.task.timeline);
    timeline.confirmationReceived("succeeded", "User confirmed pending control");
    const applied = this.#deviceService.applyControl(transition.record.controlTarget);

    if (applied.kind === "control_applied") {
      timeline.simulatedExecution("succeeded", `Applied ${applied.controlItem.name} on ${applied.device.displayName}`);

      return this.#saveTask({
        ...stored.task,
        executionState: "completed",
        outcomeReason: "none",
        reply: `${applied.device.displayName} ${applied.controlItem.name.toLowerCase()} is now ${String(applied.updatedValue)}.`,
        selectedContext: {
          devices: [applied.device],
          dataItems: [],
          controlItems: [applied.controlItem],
          candidates: []
        },
        selectedDataItems: [],
        selectedControlItems: [applied.controlItem],
        timeline: finalEvents(timeline, "succeeded", "Returned completed confirmed-control outcome")
      });
    }

    const mapped = mapDeviceFailure(applied);
    appendDeviceFailureTimeline(timeline, applied);

    return this.#saveTask({
      ...stored.task,
      executionState: mapped.executionState,
      outcomeReason: mapped.outcomeReason,
      reply: mapped.reply,
      selectedContext: contextFromDeviceFailure(applied),
      selectedDataItems: [],
      selectedControlItems: [],
      timeline: finalEvents(timeline, mapped.timelineStatus, "Returned blocked confirmation outcome")
    });
  }

  rejectTask(taskId: string): TaskResult {
    const stored = this.#taskRepository.get(taskId);
    const pending = this.#pendingControlRepository.getByTaskId(taskId);

    if (!stored.ok || !pending) {
      return this.#confirmationFailureTask({
        taskId,
        originalText: stored.ok ? stored.task.originalText : "Reject pending control",
        ...(stored.ok ? { baseTask: stored.task } : {}),
        outcomeReason: "pending_control_missing",
        reply: "I could not find a pending control to reject.",
        detail: "No pending control exists for this task"
      });
    }

    const transition = this.#pendingControlRepository.markRejected(pending.pendingControlId);
    if (!transition.ok) {
      return this.#blockedConfirmationTask({
        baseTask: stored.task,
        pending: transition.record ?? pending,
        outcomeReason: pendingFailureToOutcomeReason(transition.reason),
        reply: replyForPendingFailure(transition.reason),
        detail: detailForPendingFailure(transition.reason)
      });
    }

    const timeline = this.#timelineFrom(stored.task.timeline);
    timeline.confirmationReceived("blocked", "User rejected pending control");

    return this.#saveTask({
      ...stored.task,
      executionState: "rejected",
      outcomeReason: "control_rejected",
      reply: `Okay, I will not change ${transition.record.target.name}.`,
      timeline: finalEvents(timeline, "blocked", "Returned rejected outcome without mutation")
    });
  }

  async #createStatusTask(
    taskId: string,
    originalText: string,
    proposal: Extract<AgentProposal, { kind: "status_query" }>,
    timeline: TimelineBuilder
  ): Promise<TaskResult> {
    timeline.serviceValidation("succeeded", "Validated status-query proposal");
    const result = this.#deviceService.readStatus(toDeviceTarget(proposal.target));

    if (result.kind === "read_success") {
      timeline.deviceResolution("succeeded", `Resolved ${result.device.displayName}`);
      timeline.simulatedRead("succeeded", `Read ${result.dataItems.length} simulated values`);

      const reply = replyForReadSuccess(result.device, result.dataItems);

      return this.#saveTask({
        taskId,
        originalText,
        classification: "status_query",
        executionState: "completed",
        outcomeReason: "none",
        reply,
        userReply: reply,
        plan: planFor({
          summary: proposal.summary ?? `Answer status for ${result.device.displayName}.`,
          confidence: proposal.confidence ?? 0.9,
          steps: [
            ["step-1", "Resolve simulated device", "completed"],
            ["step-2", "Read selected simulated values", "completed"]
          ]
        }),
        selectedContext: {
          devices: [result.device],
          dataItems: result.dataItems,
          controlItems: [],
          candidates: []
        },
        selectedDataItems: result.dataItems,
        selectedControlItems: [],
        timeline: finalEvents(timeline, "succeeded", "Returned completed status query")
      });
    }

    return this.#saveTask(this.#taskFromDeviceFailure({
      taskId,
      originalText,
      classification: "status_query",
      ...(proposal.summary ? { proposalSummary: proposal.summary } : {}),
      ...(proposal.confidence !== undefined ? { proposalConfidence: proposal.confidence } : {}),
      result,
      timeline
    }));
  }

  async #createControlTask(
    taskId: string,
    originalText: string,
    proposal: Extract<AgentProposal, { kind: "control_request" }>,
    timeline: TimelineBuilder
  ): Promise<TaskResult> {
    timeline.serviceValidation("succeeded", "Validated control-request proposal");
    const result = this.#deviceService.proposeControl(toControlTarget(proposal.target));

    if (result.kind === "control_proposed") {
      timeline.deviceResolution("succeeded", `Resolved ${result.device.displayName}`);
      timeline.confirmationRequired("Created pending control request; simulated state has not changed");

      const pendingControlId = this.#pendingControlIdGenerator();
      const pendingControl = this.#pendingControlFromProposal({
        pendingControlId,
        proposal,
        result
      });
      this.#pendingControlRepository.create({
        pendingControlId,
        taskId,
        target: pendingControl.target,
        controlTarget: {
          deviceId: result.controlItem.deviceId,
          controlItem: result.controlItem.controlId,
          requestedValue: result.controlItem.requestedValue
        },
        confirmationSummary: pendingControl.confirmationSummary,
        expectedEffect: pendingControl.expectedEffect,
        createdAt: this.#clock().toISOString(),
        ...(pendingControl.expiresAt ? { expiresAt: pendingControl.expiresAt } : {}),
        status: "pending"
      });

      return this.#saveTask({
        taskId,
        originalText,
        classification: "control_request",
        executionState: "pending_confirmation",
        outcomeReason: "none",
        reply: `Please confirm: ${pendingControl.confirmationSummary}.`,
        plan: planFor({
          summary: proposal.summary ?? `Prepare a confirmable control request for ${result.device.displayName}.`,
          confidence: proposal.confidence ?? 0.9,
          steps: [
            ["step-1", "Resolve simulated device control", "completed"],
            ["step-2", "Create pending confirmation instead of mutating state", "completed"]
          ]
        }),
        selectedContext: {
          devices: [result.device],
          dataItems: [],
          controlItems: [result.controlItem],
          candidates: []
        },
        selectedDataItems: [],
        selectedControlItems: [result.controlItem],
        pendingControl,
        timeline: finalEvents(timeline, "waiting", "Returned pending confirmation outcome")
      });
    }

    return this.#saveTask(this.#taskFromDeviceFailure({
      taskId,
      originalText,
      classification: "control_request",
      ...(proposal.summary ? { proposalSummary: proposal.summary } : {}),
      ...(proposal.confidence !== undefined ? { proposalConfidence: proposal.confidence } : {}),
      result,
      timeline
    }));
  }

  #taskFromDeviceFailure(input: {
    taskId: string;
    originalText: string;
    classification: TaskClassification;
    proposalSummary?: string;
    proposalConfidence?: number;
    result: Exclude<DeviceReadResult | DeviceControlProposalResult, { kind: "read_success" | "control_proposed" }>;
    timeline: TimelineBuilder;
  }): TaskResult {
    appendDeviceFailureTimeline(input.timeline, input.result);
    const mapped = mapDeviceFailure(input.result);
    const selectedContext = contextFromDeviceFailure(input.result);

    return {
      taskId: input.taskId,
      originalText: input.originalText,
      classification: input.result.kind === "ambiguous" ? "ambiguous" : input.classification,
      executionState: mapped.executionState,
      outcomeReason: mapped.outcomeReason,
      reply: mapped.reply,
      plan: planFor({
        summary: input.proposalSummary ?? "Return a non-success task outcome from simulated-device validation.",
        confidence: input.proposalConfidence ?? 0.6,
        ...(input.result.kind === "ambiguous" ? { ambiguityReason: input.result.message } : {}),
        steps: [
          ["step-1", "Resolve simulated device target", input.result.kind === "not_found" ? "blocked" : "completed"],
          ["step-2", "Validate requested simulated-device operation", "blocked"]
        ]
      }),
      selectedContext,
      selectedDataItems: selectedContext.dataItems,
      selectedControlItems: [],
      timeline: finalEvents(input.timeline, mapped.timelineStatus, "Returned non-success task outcome")
    };
  }

  #pendingControlFromProposal(input: {
    pendingControlId: string;
    proposal: Extract<AgentProposal, { kind: "control_request" }>;
    result: Extract<DeviceControlProposalResult, { kind: "control_proposed" }>;
  }): PendingControl {
    const expiresAt =
      this.#pendingControlTtlMs === undefined
        ? undefined
        : new Date(this.#clock().getTime() + this.#pendingControlTtlMs).toISOString();

    return {
      pendingControlId: input.pendingControlId,
      target: input.result.controlItem,
      confirmationSummary:
        input.proposal.confirmationSummary ??
        `${input.result.device.displayName} ${input.result.controlItem.name.toLowerCase()} will change to ${String(input.result.controlItem.requestedValue)}`,
      expectedEffect: input.result.expectedEffect,
      ...(expiresAt ? { expiresAt } : {})
    };
  }

  #blockedConfirmationTask(input: {
    baseTask: TaskResult;
    pending: StoredPendingControl;
    outcomeReason: TaskOutcomeReason;
    reply: string;
    detail: string;
  }): TaskResult {
    const timeline = this.#timelineFrom(input.baseTask.timeline);
    timeline.confirmationReceived("blocked", input.detail);

    return this.#saveTask({
      ...input.baseTask,
      executionState: input.outcomeReason === "pending_control_already_rejected" ? "rejected" : "failed",
      outcomeReason: input.outcomeReason,
      reply: input.reply,
      timeline: finalEvents(timeline, "blocked", "Returned blocked confirmation outcome")
    });
  }

  #confirmationFailureTask(input: {
    taskId: string;
    originalText: string;
    baseTask?: TaskResult;
    outcomeReason: TaskOutcomeReason;
    reply: string;
    detail: string;
  }): TaskResult {
    const timeline = input.baseTask ? this.#timelineFrom(input.baseTask.timeline) : this.#newTimeline();
    if (!input.baseTask) {
      timeline.requestReceived("Received confirmation request");
    }
    timeline.confirmationReceived("blocked", input.detail);

    return this.#saveTask({
      taskId: input.baseTask?.taskId ?? input.taskId,
      originalText: input.originalText,
      classification: input.baseTask?.classification ?? "control_request",
      executionState: "failed",
      outcomeReason: input.outcomeReason,
      reply: input.reply,
      plan:
        input.baseTask?.plan ??
        planFor({
          summary: "Block confirmation because no pending control could be found.",
          confidence: 1,
          steps: [
            ["step-1", "Receive confirmation request", "completed"],
            ["step-2", "Find pending control", "blocked"]
          ]
        }),
      selectedContext: input.baseTask?.selectedContext ?? emptySelectedContext(),
      selectedDataItems: input.baseTask?.selectedDataItems ?? [],
      selectedControlItems: [],
      timeline: finalEvents(timeline, "blocked", "Returned missing pending-control outcome")
    });
  }

  #saveTask(task: TaskResult): TaskResult {
    const parsed = taskResultSchema.parse(stripInvalidPendingControl(task));
    return this.#taskRepository.save(parsed);
  }

  #newTimeline(): TimelineBuilder {
    return new TimelineBuilder({
      clock: this.#clock,
      idGenerator: this.#timelineEventIdGenerator
    });
  }

  #timelineFrom(events: TimelineEvent[]): TimelineBuilder {
    return new TimelineBuilder({
      clock: this.#clock,
      idGenerator: this.#timelineEventIdGenerator,
      events
    });
  }
}

function emptySelectedContext(): SelectedDeviceContext {
  return {
    devices: [],
    dataItems: [],
    controlItems: [],
    candidates: []
  };
}

function finalEvents(timeline: TimelineBuilder, status: TimelineStatus, detail: string): TimelineEvent[] {
  timeline.finalOutcome(status, detail);

  return timeline.events;
}

function planFor(input: {
  summary: string;
  confidence: number;
  ambiguityReason?: string;
  steps: Array<[string, string, "planned" | "completed" | "skipped" | "blocked"]>;
}): StructuredPlan {
  return {
    summary: input.summary,
    confidence: input.confidence,
    ...(input.ambiguityReason ? { ambiguityReason: input.ambiguityReason } : {}),
    steps: input.steps.map(([stepId, description, status]) => ({
      stepId,
      description,
      status
    }))
  };
}

function interpretationDetail(proposal: AgentProposal): string {
  switch (proposal.kind) {
    case "status_query":
      return "Classified request as status query";
    case "control_request":
      return "Classified request as control request";
    case "ambiguous":
      return `Interpreter reported ambiguity: ${proposal.reason}`;
    case "unsupported":
      return `Interpreter reported unsupported request: ${proposal.reason}`;
    case "parse_failure":
      return `Interpreter reported parse failure: ${proposal.reason}`;
  }
}

function formatProposalParseError(error: unknown): string {
  if (error instanceof ZodError) {
    return `Interpreter proposal failed validation: ${error.issues[0]?.message ?? "invalid proposal"}`;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Interpreter proposal failed validation";
}

function appendDeviceFailureTimeline(timeline: TimelineBuilder, result: DeviceReadResult | DeviceControlProposalResult | DeviceControlApplyResult): void {
  switch (result.kind) {
    case "ambiguous":
      timeline.deviceResolution("blocked", result.message);
      break;
    case "not_found":
      timeline.deviceResolution("blocked", result.message);
      break;
    case "unavailable":
      timeline.deviceResolution("succeeded", `Resolved ${result.device.displayName}`);
      timeline.serviceValidation("blocked", result.message);
      break;
    case "unsupported":
      if (result.device) {
        timeline.deviceResolution("succeeded", `Resolved ${result.device.displayName}`);
      }
      timeline.serviceValidation("blocked", result.message);
      break;
    case "invalid_value":
      timeline.deviceResolution("succeeded", `Resolved ${result.device.displayName}`);
      timeline.serviceValidation("blocked", result.message);
      break;
    case "read_success":
    case "control_proposed":
    case "control_applied":
      break;
  }
}

function mapDeviceFailure(
  result: AmbiguousResult | NotFoundResult | UnavailableResult | UnsupportedResult | InvalidValueResult
): {
  executionState: ExecutionState;
  outcomeReason: TaskOutcomeReason;
  reply: string;
  timelineStatus: TimelineStatus;
} {
  switch (result.kind) {
    case "ambiguous":
      return {
        executionState: "needs_clarification",
        outcomeReason: "ambiguous_target",
        reply: result.message,
        timelineStatus: "blocked"
      };
    case "not_found":
      return {
        executionState: "unavailable",
        outcomeReason: "device_not_found",
        reply: result.message,
        timelineStatus: "blocked"
      };
    case "unavailable":
      return {
        executionState: "unavailable",
        outcomeReason: "device_offline",
        reply: result.message,
        timelineStatus: "blocked"
      };
    case "unsupported":
      return {
        executionState: "unavailable",
        outcomeReason: unsupportedReason(result.reason),
        reply: result.message,
        timelineStatus: "blocked"
      };
    case "invalid_value":
      return {
        executionState: "failed",
        outcomeReason: "invalid_control_value",
        reply: result.message,
        timelineStatus: "blocked"
      };
  }
}

function unsupportedReason(reason: UnsupportedResult["reason"]): TaskOutcomeReason {
  switch (reason) {
    case "readable_item_not_found":
      return "unsupported_data_item";
    case "control_item_not_found":
      return "unsupported_control_item";
    case "read_only":
      return "read_only_control";
    case "unsupported_capability":
      return "unsupported_request";
  }
}

function contextFromDeviceFailure(
  result: AmbiguousResult | NotFoundResult | UnavailableResult | UnsupportedResult | InvalidValueResult
): SelectedDeviceContext {
  switch (result.kind) {
    case "ambiguous":
      return {
        devices: [],
        dataItems: [],
        controlItems: [],
        candidates: result.candidates
      };
    case "unavailable":
    case "invalid_value":
      return {
        devices: [result.device],
        dataItems: [],
        controlItems: [],
        candidates: []
      };
    case "unsupported":
      return {
        devices: result.device ? [result.device] : [],
        dataItems: [],
        controlItems: [],
        candidates: []
      };
    case "not_found":
      return emptySelectedContext();
  }
}

function replyForReadSuccess(device: SimulatedDeviceContext, dataItems: SelectedDataItem[]): string {
  const values = dataItems.map((item) => `${item.name}: ${String(item.value ?? item.freshness ?? "unknown")}`);

  return `${device.displayName} status: ${values.join(", ")}.`;
}

function replyForPendingFailure(reason: string): string {
  switch (reason) {
    case "pending_control_expired":
      return "That confirmation has expired. Please start again.";
    case "pending_control_already_confirmed":
      return "That control request has already been confirmed.";
    case "pending_control_already_rejected":
      return "That control request has already been rejected.";
    default:
      return "I could not find a pending control to confirm.";
  }
}

function detailForPendingFailure(reason: string): string {
  switch (reason) {
    case "pending_control_expired":
      return "Confirmation arrived after pending control expiry";
    case "pending_control_already_confirmed":
      return "Pending control was already confirmed";
    case "pending_control_already_rejected":
      return "Pending control was already rejected";
    default:
      return "Pending control is missing";
  }
}

function stripInvalidPendingControl(task: TaskResult): TaskResult {
  if (task.executionState === "pending_confirmation") {
    return task;
  }

  const { pendingControl: _pendingControl, ...withoutPending } = task;

  return withoutPending;
}

type LooseDeviceTarget = {
  deviceId?: DeviceTarget["deviceId"] | undefined;
  room?: DeviceTarget["room"] | undefined;
  deviceName?: DeviceTarget["deviceName"] | undefined;
  deviceType?: DeviceTarget["deviceType"] | undefined;
  capability?: DeviceTarget["capability"] | undefined;
  dataItem?: DeviceTarget["dataItem"] | undefined;
  controlItem?: DeviceTarget["controlItem"] | undefined;
  phrase?: DeviceTarget["phrase"] | undefined;
};

function toDeviceTarget(target: LooseDeviceTarget): DeviceTarget {
  return {
    ...(target.deviceId !== undefined ? { deviceId: target.deviceId } : {}),
    ...(target.room !== undefined ? { room: target.room } : {}),
    ...(target.deviceName !== undefined ? { deviceName: target.deviceName } : {}),
    ...(target.deviceType !== undefined ? { deviceType: target.deviceType } : {}),
    ...(target.capability !== undefined ? { capability: target.capability } : {}),
    ...(target.dataItem !== undefined ? { dataItem: target.dataItem } : {}),
    ...(target.controlItem !== undefined ? { controlItem: target.controlItem } : {}),
    ...(target.phrase !== undefined ? { phrase: target.phrase } : {})
  };
}

function toControlTarget(target: LooseDeviceTarget & { requestedValue: PublicValue }): ControlTarget {
  return {
    ...toDeviceTarget(target),
    requestedValue: target.requestedValue
  };
}
