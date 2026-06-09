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
  SelectedDataItem,
  SelectedDeviceContext,
  SimulatedDeviceContext
} from "../../contracts/device-contract.js";
import {
  type AgentInterpreter,
  type AgentProposal,
  parseAgentProposal,
  toControlTarget,
  toDeviceTarget
} from "../../agent/agent-interpreter.js";
import type {
  PlatformFailureStage
} from "../platform/platform-capability-service.js";
import {
  isReturnAirTemperatureDataItem,
  isSupplyAirTemperatureDataItem,
  isSwitchDataItem
} from "../platform/platform-mappers.js";
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

type PlatformProposalResult = Extract<AgentProposal, { kind: "platform_status_query" }>["result"];
type PlatformProposalSuccess = Extract<PlatformProposalResult, { kind: "platform_status_success" }>;
type PlatformProposalAmbiguous = Extract<PlatformProposalResult, { kind: "ambiguous" }>;
type PlatformProposalUnavailable = Extract<PlatformProposalResult, { kind: "unavailable" }>;

export type TaskServiceOptions = {
  interpreter: AgentInterpreter;
  deviceService?: TaskDeviceService;
  taskRepository?: TaskRepository;
  pendingControlRepository?: PendingControlRepository;
  clock?: Clock;
  taskIdGenerator?: IdGenerator;
  pendingControlIdGenerator?: IdGenerator;
  timelineEventIdGenerator?: IdGenerator;
  pendingControlTtlMs?: number;
};

export type TaskDeviceService = Pick<SimulatedDeviceService, "readStatus" | "proposeControl" | "applyControl" | "debugSnapshot">;

export class TaskService {
  readonly #interpreter: AgentInterpreter;
  readonly #deviceService: TaskDeviceService;
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
      case "platform_status_query":
        return this.#createPlatformStatusTask(taskId, originalText, proposal, timeline);
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
            candidates: this.#filterKnownCandidates(proposal.candidates)
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
        detail: "No pending control exists for this task",
        persist: false
      });
    }

    return this.#confirmPendingControlRecord(stored.task, pending);
  }

  confirmPendingControl(pendingControlId: string): TaskResult {
    const pending = this.#pendingControlRepository.getByPendingControlId(pendingControlId);

    if (!pending) {
      return this.#confirmationFailureTask({
        taskId: pendingControlId,
        originalText: "Confirm pending control",
        outcomeReason: "pending_control_missing",
        reply: "I could not find a pending control to confirm.",
        detail: "No pending control exists for this pending control id",
        persist: false
      });
    }

    const stored = this.#taskRepository.get(pending.taskId);
    if (!stored.ok) {
      return this.#confirmationFailureTask({
        taskId: pending.taskId,
        originalText: "Confirm pending control",
        outcomeReason: "pending_control_missing",
        reply: "I could not find the task for this pending control.",
        detail: "Pending control exists without an inspectable task record",
        persist: false
      });
    }

    return this.#confirmPendingControlRecord(stored.task, pending);
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
        detail: "No pending control exists for this task",
        persist: false
      });
    }

    return this.#rejectPendingControlRecord(stored.task, pending);
  }

  rejectPendingControl(pendingControlId: string): TaskResult {
    const pending = this.#pendingControlRepository.getByPendingControlId(pendingControlId);

    if (!pending) {
      return this.#confirmationFailureTask({
        taskId: pendingControlId,
        originalText: "Reject pending control",
        outcomeReason: "pending_control_missing",
        reply: "I could not find a pending control to reject.",
        detail: "No pending control exists for this pending control id",
        persist: false
      });
    }

    const stored = this.#taskRepository.get(pending.taskId);
    if (!stored.ok) {
      return this.#confirmationFailureTask({
        taskId: pending.taskId,
        originalText: "Reject pending control",
        outcomeReason: "pending_control_missing",
        reply: "I could not find the task for this pending control.",
        detail: "Pending control exists without an inspectable task record",
        persist: false
      });
    }

    return this.#rejectPendingControlRecord(stored.task, pending);
  }

  #confirmPendingControlRecord(storedTask: TaskResult, pending: StoredPendingControl): TaskResult {
    const validation = this.#pendingControlRepository.validatePending(pending.pendingControlId);
    if (!validation.ok) {
      return this.#blockedConfirmationTask({
        baseTask: storedTask,
        pending: validation.record ?? pending,
        outcomeReason: pendingFailureToOutcomeReason(validation.reason),
        reply: replyForPendingFailure(validation.reason),
        detail: detailForPendingFailure(validation.reason),
        persist: false
      });
    }

    const timeline = this.#timelineFrom(storedTask.timeline);
    timeline.confirmationReceived("succeeded", "User confirmed pending control");
    const applied = this.#deviceService.applyControl(validation.record.controlTarget);

    if (applied.kind === "control_applied") {
      const transition = this.#pendingControlRepository.markConfirmed(pending.pendingControlId);
      if (!transition.ok) {
        return this.#blockedConfirmationTask({
          baseTask: storedTask,
          pending: transition.record ?? pending,
          outcomeReason: pendingFailureToOutcomeReason(transition.reason),
          reply: replyForPendingFailure(transition.reason),
          detail: detailForPendingFailure(transition.reason),
          persist: false
        });
      }

      timeline.simulatedExecution("succeeded", `Applied ${applied.controlItem.name} on ${applied.device.displayName}`);

      return this.#saveTask({
        ...storedTask,
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

    return this.#taskResult({
      ...storedTask,
      executionState: mapped.executionState,
      outcomeReason: mapped.outcomeReason,
      reply: mapped.reply,
      selectedContext: contextFromDeviceFailure(applied),
      selectedDataItems: [],
      selectedControlItems: [],
      timeline: finalEvents(timeline, mapped.timelineStatus, "Returned blocked confirmation outcome")
    });
  }

  #rejectPendingControlRecord(storedTask: TaskResult, pending: StoredPendingControl): TaskResult {
    const transition = this.#pendingControlRepository.markRejected(pending.pendingControlId);
    if (!transition.ok) {
      return this.#blockedConfirmationTask({
        baseTask: storedTask,
        pending: transition.record ?? pending,
        outcomeReason: pendingFailureToOutcomeReason(transition.reason),
        reply: replyForPendingFailure(transition.reason),
        detail: detailForPendingFailure(transition.reason),
        persist: false
      });
    }

    const timeline = this.#timelineFrom(storedTask.timeline);
    timeline.confirmationReceived("blocked", "User rejected pending control");

    return this.#saveTask({
      ...storedTask,
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

  async #createPlatformStatusTask(
    taskId: string,
    originalText: string,
    proposal: Extract<AgentProposal, { kind: "platform_status_query" }>,
    timeline: TimelineBuilder
  ): Promise<TaskResult> {
    timeline.serviceValidation("succeeded", "Validated platform status-query proposal");
    appendPlatformTimeline(timeline, proposal.result);

    if (proposal.result.kind === "platform_status_success") {
      return this.#saveTask({
        taskId,
        originalText,
        classification: "status_query",
        executionState: "completed",
        outcomeReason: "none",
        reply: replyForPlatformSuccess(proposal.result),
        userReply: replyForPlatformSuccess(proposal.result),
        plan: planFor({
          summary: proposal.summary ?? `Answer real-platform status for ${proposal.result.device.displayName}.`,
          confidence: proposal.confidence ?? 0.85,
          steps: [
            ["step-1", "Search real-platform equipment", "completed"],
            ["step-2", "Read platform equipment detail", "completed"],
            ["step-3", "Read pivotal runtime parameters", "completed"]
          ]
        }),
        selectedContext: {
          devices: [proposal.result.device],
          dataItems: publicPlatformDataItems(proposal.result),
          controlItems: [],
          candidates: []
        },
        selectedDataItems: publicPlatformDataItems(proposal.result),
        selectedControlItems: [],
        timeline: finalEvents(timeline, "succeeded", "Returned completed platform status query")
      });
    }

    const mapped = mapPlatformFailure(proposal.result);

    return this.#saveTask({
      taskId,
      originalText,
      classification: proposal.result.kind === "ambiguous" ? "ambiguous" : "status_query",
      executionState: mapped.executionState,
      outcomeReason: mapped.outcomeReason,
      reply: mapped.reply,
      plan: planFor({
        summary: proposal.summary ?? "Return a non-success task outcome from real-platform validation.",
        confidence: proposal.confidence ?? 0.6,
        ...(proposal.result.kind === "ambiguous" ? { ambiguityReason: "Multiple matching platform devices were found." } : {}),
        steps: [
          ["step-1", "Search real-platform equipment", platformSearchStepStatus(proposal.result)],
          ["step-2", "Read platform equipment detail", platformDetailStepStatus(proposal.result)],
          ["step-3", "Read pivotal runtime parameters", "blocked"]
        ]
      }),
      selectedContext: contextFromPlatformResult(proposal.result),
      selectedDataItems: [],
      selectedControlItems: [],
      timeline: finalEvents(timeline, mapped.timelineStatus, "Returned non-success platform status outcome")
    });
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
    persist: boolean;
  }): TaskResult {
    const timeline = this.#timelineFrom(input.baseTask.timeline);
    timeline.confirmationReceived("blocked", input.detail);

    return this.#maybeSaveTask({
      ...input.baseTask,
      executionState: input.outcomeReason === "pending_control_already_rejected" ? "rejected" : "failed",
      outcomeReason: input.outcomeReason,
      reply: input.reply,
      timeline: finalEvents(timeline, "blocked", "Returned blocked confirmation outcome")
    }, input.persist);
  }

  #confirmationFailureTask(input: {
    taskId: string;
    originalText: string;
    baseTask?: TaskResult;
    outcomeReason: TaskOutcomeReason;
    reply: string;
    detail: string;
    persist: boolean;
  }): TaskResult {
    const timeline = input.baseTask ? this.#timelineFrom(input.baseTask.timeline) : this.#newTimeline();
    if (!input.baseTask) {
      timeline.requestReceived("Received confirmation request");
    }
    timeline.confirmationReceived("blocked", input.detail);

    return this.#maybeSaveTask({
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
    }, input.persist);
  }

  #saveTask(task: TaskResult): TaskResult {
    return this.#taskRepository.save(this.#taskResult(task));
  }

  #maybeSaveTask(task: TaskResult, persist: boolean): TaskResult {
    const parsed = this.#taskResult(task);

    return persist ? this.#taskRepository.save(parsed) : parsed;
  }

  #taskResult(task: TaskResult): TaskResult {
    const parsed = taskResultSchema.parse(stripInvalidPendingControl(task));

    return parsed;
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

  #filterKnownCandidates(candidates: SimulatedDeviceContext[]): SimulatedDeviceContext[] {
    const knownDevices = new Map(this.#deviceService.debugSnapshot().map((device) => [device.deviceId, device]));

    return candidates.flatMap((candidate) => {
      const known = knownDevices.get(candidate.deviceId);

      return known ? [known] : [];
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
    case "platform_status_query":
      return "Classified request as real-platform status query";
    case "ambiguous":
      return `Interpreter reported ambiguity: ${proposal.reason}`;
    case "unsupported":
      return `Interpreter reported unsupported request: ${proposal.reason}`;
    case "parse_failure":
      return `Interpreter reported parse failure: ${proposal.reason}`;
  }
}

function appendPlatformTimeline(timeline: TimelineBuilder, result: PlatformProposalResult): void {
  switch (result.kind) {
    case "platform_status_success":
      timeline.platformSearch("succeeded", `Resolved ${result.device.displayName}`);
      timeline.platformDetail("succeeded", "Read platform equipment detail");
      timeline.platformRuntimeRead("succeeded", "Read platform pivotal runtime parameters");
      break;
    case "ambiguous":
      timeline.platformSearch("blocked", "Multiple matching platform devices were found");
      break;
    case "unavailable":
      appendPlatformUnavailableTimeline(timeline, result);
      break;
  }
}

function appendPlatformUnavailableTimeline(timeline: TimelineBuilder, result: PlatformProposalUnavailable): void {
  const stage = platformFailureStage(result);
  const detail = platformTimelineDetail(result);

  if (result.device && stage !== "platform_search" && stage !== "platform_auth") {
    timeline.platformSearch("succeeded", `Resolved ${result.device.displayName}`);
  }

  if (result.device && stage === "platform_runtime_read") {
    timeline.platformDetail("succeeded", "Read platform equipment detail");
  }

  appendPlatformStage(timeline, stage, platformTimelineStatus(result), detail);
}

function mapPlatformFailure(
  result: PlatformProposalAmbiguous | PlatformProposalUnavailable
): {
  executionState: ExecutionState;
  outcomeReason: TaskOutcomeReason;
  reply: string;
  timelineStatus: TimelineStatus;
} {
  if (result.kind === "ambiguous") {
    return {
      executionState: "needs_clarification",
      outcomeReason: "ambiguous_target",
      reply: "I found multiple matching platform devices. Please clarify which one to use.",
      timelineStatus: "blocked"
    };
  }

  return {
    executionState: result.reason === "platform_error" || result.reason === "platform_auth_failed" ? "failed" : "unavailable",
    outcomeReason: result.reason,
    reply: platformReplyForUnavailable(result),
    timelineStatus: result.reason === "platform_error" || result.reason === "platform_auth_failed" ? "failed" : "blocked"
  };
}

function replyForPlatformSuccess(result: PlatformProposalSuccess): string {
  const switchText = result.switchState === undefined
    ? "开关状态无法从关键参数确认"
    : result.switchState
      ? "开着"
      : "关着";
  const temperatureText = result.returnAirTemperature === undefined
    ? "当前温度无法从可用数据确定"
    : `当前回风温度 ${result.returnAirTemperature}℃`;

  return `${result.device.displayName}${switchText}，${temperatureText}。`;
}

function platformReplyForUnavailable(result: PlatformProposalUnavailable): string {
  switch (result.reason) {
    case "platform_auth_failed":
      return "Platform authentication failed, so I could not read the device status.";
    case "platform_timeout":
      return "The platform request timed out, so I could not read the current device status.";
    case "platform_error":
      return "The platform query failed, so I could not read the current device status.";
    case "platform_no_data":
      return "Current platform runtime data is unavailable for that device.";
    case "device_not_found":
      return "No matching platform device was found.";
    case "device_offline":
      return `${result.device?.displayName ?? "The selected device"} is offline or has unknown platform status.`;
    case "metadata_unrecognized":
      return "The current temperature cannot be determined from the available platform data.";
  }
}

function platformFailureStage(result: PlatformProposalUnavailable): PlatformFailureStage {
  if (result.stage) {
    return result.stage;
  }

  switch (result.reason) {
    case "platform_auth_failed":
      return "platform_auth";
    case "device_offline":
      return "platform_detail";
    case "platform_no_data":
    case "metadata_unrecognized":
      return "platform_runtime_read";
    case "device_not_found":
    case "platform_timeout":
    case "platform_error":
      return "platform_search";
  }
}

function platformTimelineStatus(result: PlatformProposalUnavailable): TimelineStatus {
  if (result.reason === "platform_error" || result.reason === "platform_auth_failed") {
    return "failed";
  }

  return "blocked";
}

function platformTimelineDetail(result: PlatformProposalUnavailable): string {
  switch (result.reason) {
    case "platform_auth_failed":
      return "Platform authentication failed";
    case "platform_timeout":
      return "Platform request timed out";
    case "platform_error":
      return "Platform request failed";
    case "platform_no_data":
      return "Platform returned no runtime data";
    case "device_not_found":
      return "No matching platform device was found";
    case "device_offline":
      return "Platform reports the selected device is offline or unknown";
    case "metadata_unrecognized":
      return "Platform runtime metadata could not identify return-air temperature";
  }
}

function appendPlatformStage(
  timeline: TimelineBuilder,
  stage: PlatformFailureStage,
  status: TimelineStatus,
  detail: string
): void {
  switch (stage) {
    case "platform_auth":
      timeline.platformAuth(status, detail);
      break;
    case "platform_search":
      timeline.platformSearch(status, detail);
      break;
    case "platform_detail":
      timeline.platformDetail(status, detail);
      break;
    case "platform_runtime_read":
      timeline.platformRuntimeRead(status, detail);
      break;
  }
}

function contextFromPlatformResult(result: PlatformProposalAmbiguous | PlatformProposalUnavailable): SelectedDeviceContext {
  if (result.kind === "ambiguous") {
    return {
      devices: [],
      dataItems: [],
      controlItems: [],
      candidates: result.candidates
    };
  }

  return {
    devices: result.device ? [result.device] : [],
    dataItems: [],
    controlItems: [],
    candidates: result.candidates ?? []
  };
}

function publicPlatformDataItems(result: PlatformProposalSuccess): SelectedDataItem[] {
  if (result.device.type !== "air_conditioner") {
    return result.dataItems;
  }

  if (result.returnAirTemperature === undefined) {
    return result.dataItems.filter((item) => !isSupplyAirTemperatureDataItem(item));
  }

  return result.dataItems.filter((item) => isSwitchDataItem(item) || isReturnAirTemperatureDataItem(item));
}

function platformSearchStepStatus(result: PlatformProposalAmbiguous | PlatformProposalUnavailable): "completed" | "blocked" {
  if (result.kind === "ambiguous") {
    return "blocked";
  }

  const stage = platformFailureStage(result);

  return stage === "platform_search" || stage === "platform_auth"
    ? "blocked"
    : "completed";
}

function platformDetailStepStatus(result: PlatformProposalAmbiguous | PlatformProposalUnavailable): "planned" | "completed" | "blocked" {
  if (result.kind === "ambiguous") {
    return "planned";
  }

  const stage = platformFailureStage(result);
  if (stage === "platform_runtime_read") {
    return "completed";
  }

  return stage === "platform_detail" ? "blocked" : "planned";
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
