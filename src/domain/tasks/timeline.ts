import {
  randomUUID
} from "node:crypto";
import {
  timelineEventSchema,
  type TimelineEvent,
  type TimelineSource,
  type TimelineStage,
  type TimelineStatus
} from "../../contracts/task-contract.js";
import type { Clock, IdGenerator } from "./task-types.js";

const defaultClock: Clock = () => new Date();

export class TimelineBuilder {
  readonly #clock: Clock;
  readonly #idGenerator: IdGenerator;
  readonly #events: TimelineEvent[];

  constructor(options: { clock?: Clock; idGenerator?: IdGenerator; events?: TimelineEvent[] } = {}) {
    this.#clock = options.clock ?? defaultClock;
    this.#idGenerator = options.idGenerator ?? randomEventId;
    this.#events = options.events ? structuredClone(options.events) : [];
  }

  get events(): TimelineEvent[] {
    return structuredClone(this.#events);
  }

  event(input: {
    stage: TimelineStage;
    source: TimelineSource;
    status: TimelineStatus;
    detail: string;
  }): TimelineEvent {
    const event = timelineEventSchema.parse({
      eventId: this.#idGenerator(),
      stage: input.stage,
      source: input.source,
      status: input.status,
      at: this.#clock().toISOString(),
      detail: input.detail
    });

    this.#events.push(event);

    return structuredClone(event);
  }

  requestReceived(detail = "Received user text"): TimelineEvent {
    return this.event({
      stage: "request_received",
      source: "client",
      status: "succeeded",
      detail
    });
  }

  modelInterpretation(status: TimelineStatus, detail: string): TimelineEvent {
    return this.event({
      stage: "model_interpretation",
      source: "model",
      status,
      detail
    });
  }

  serviceValidation(status: TimelineStatus, detail: string): TimelineEvent {
    return this.event({
      stage: "service_validation",
      source: "service",
      status,
      detail
    });
  }

  deviceResolution(status: TimelineStatus, detail: string): TimelineEvent {
    return this.event({
      stage: "device_resolution",
      source: "service",
      status,
      detail
    });
  }

  simulatedRead(status: TimelineStatus, detail: string): TimelineEvent {
    return this.event({
      stage: "simulated_read",
      source: "simulated_device",
      status,
      detail
    });
  }

  platformAuth(status: TimelineStatus, detail: string): TimelineEvent {
    return this.event({
      stage: "platform_auth",
      source: "platform",
      status,
      detail
    });
  }

  platformSearch(status: TimelineStatus, detail: string): TimelineEvent {
    return this.event({
      stage: "platform_search",
      source: "platform",
      status,
      detail
    });
  }

  platformDetail(status: TimelineStatus, detail: string): TimelineEvent {
    return this.event({
      stage: "platform_detail",
      source: "platform",
      status,
      detail
    });
  }

  platformRuntimeRead(status: TimelineStatus, detail: string): TimelineEvent {
    return this.event({
      stage: "platform_runtime_read",
      source: "platform",
      status,
      detail
    });
  }

  confirmationRequired(detail: string): TimelineEvent {
    return this.event({
      stage: "confirmation_required",
      source: "service",
      status: "waiting",
      detail
    });
  }

  confirmationReceived(status: TimelineStatus, detail: string): TimelineEvent {
    return this.event({
      stage: "confirmation_received",
      source: "client",
      status,
      detail
    });
  }

  simulatedExecution(status: TimelineStatus, detail: string): TimelineEvent {
    return this.event({
      stage: "simulated_execution",
      source: "simulated_device",
      status,
      detail
    });
  }

  finalOutcome(status: TimelineStatus, detail: string): TimelineEvent {
    return this.event({
      stage: "final_outcome",
      source: "service",
      status,
      detail
    });
  }
}

function randomEventId(): string {
  return `evt-${randomUUID()}`;
}
