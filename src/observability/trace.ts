import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

export type TraceLevel = "debug" | "info" | "warn" | "error";

export type TraceFields = Record<string, unknown>;

export type TraceEvent = {
  at: string;
  traceId: string;
  level: TraceLevel;
  component: string;
  event: string;
  fields: TraceFields;
};

export type TraceContext = {
  traceId?: string;
  taskId?: string;
};

export type TraceSink = (event: TraceEvent) => void;

export type Tracer = {
  enabled: boolean;
  includePayloads: boolean;
  context: TraceContext;
  child(context: TraceContext): Tracer;
  emit(level: TraceLevel, component: string, event: string, fields?: TraceFields): void;
  payload(level: TraceLevel, component: string, event: string, fields?: TraceFields): void;
};

export type CreateTracerOptions = {
  enabled?: boolean;
  includePayloads?: boolean;
  sink?: TraceSink;
  traceIdGenerator?: () => string;
  clock?: () => Date;
  defaultContext?: TraceContext;
};

export const noopTracer: Tracer = {
  enabled: false,
  includePayloads: false,
  context: {},
  child() {
    return this;
  },
  emit() {
    // Intentionally empty.
  },
  payload() {
    // Intentionally empty.
  }
};

const traceContextStorage = new AsyncLocalStorage<TraceContext>();

export function createTracer(options: CreateTracerOptions = {}): Tracer {
  if (options.enabled === false) {
    return noopTracer;
  }

  if (!options.enabled && !options.sink) {
    return noopTracer;
  }

  const sink = options.sink ?? stdoutJsonTraceSink;
  const traceIdGenerator = options.traceIdGenerator ?? (() => `trace-${randomUUID()}`);
  const clock = options.clock ?? (() => new Date());

  return new JsonTracer({
    sink,
    traceIdGenerator,
    clock,
    includePayloads: options.includePayloads ?? false,
    context: {
      ...(options.defaultContext ?? {})
    }
  });
}

export function createConsoleTracer(options: {
  enabled: boolean;
  includePayloads?: boolean;
  sink?: "stdout" | "stderr";
}): Tracer {
  return createTracer({
    enabled: options.enabled,
    sink: options.sink === "stderr" ? stderrJsonTraceSink : stdoutJsonTraceSink,
    ...(options.includePayloads !== undefined ? { includePayloads: options.includePayloads } : {})
  });
}

export async function traceTimed<T>(
  tracer: Tracer,
  component: string,
  event: string,
  fields: TraceFields,
  operation: () => Promise<T>
): Promise<T> {
  const startedAt = Date.now();
  tracer.emit("debug", component, `${event}.started`, fields);

  try {
    const result = await operation();
    tracer.emit("debug", component, `${event}.succeeded`, {
      ...fields,
      durationMs: Date.now() - startedAt
    });

    return result;
  } catch (error) {
    tracer.emit("error", component, `${event}.failed`, {
      ...fields,
      durationMs: Date.now() - startedAt,
      errorName: error instanceof Error ? error.name : typeof error
    });

    throw error;
  }
}

export function runWithTraceContext<T>(context: TraceContext, operation: () => T): T {
  return traceContextStorage.run(context, operation);
}

function stdoutJsonTraceSink(event: TraceEvent): void {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

function stderrJsonTraceSink(event: TraceEvent): void {
  process.stderr.write(`${JSON.stringify(event)}\n`);
}

class JsonTracer implements Tracer {
  readonly enabled = true;
  readonly includePayloads: boolean;
  readonly #sink: TraceSink;
  readonly #traceIdGenerator: () => string;
  readonly #clock: () => Date;
  readonly #context: TraceContext;

  constructor(options: {
    sink: TraceSink;
    traceIdGenerator: () => string;
    clock: () => Date;
    includePayloads: boolean;
    context: TraceContext;
  }) {
    this.includePayloads = options.includePayloads;
    this.#sink = options.sink;
    this.#traceIdGenerator = options.traceIdGenerator;
    this.#clock = options.clock;
    this.#context = options.context;
  }

  get context(): TraceContext {
    return {
      ...activeTraceContext(),
      ...this.#context
    };
  }

  child(context: TraceContext): Tracer {
    const activeContext = activeTraceContext();
    const traceId = context.traceId ?? activeContext.traceId ?? this.#context.traceId ?? this.#traceIdGenerator();

    return new JsonTracer({
      sink: this.#sink,
      traceIdGenerator: this.#traceIdGenerator,
      clock: this.#clock,
      includePayloads: this.includePayloads,
      context: {
        ...this.#context,
        ...activeContext,
        ...context,
        traceId
      }
    });
  }

  emit(level: TraceLevel, component: string, event: string, fields: TraceFields = {}): void {
    const activeContext = activeTraceContext();
    const mergedContext = {
      ...this.#context,
      ...activeContext
    };
    const traceId = mergedContext.traceId ?? this.#traceIdGenerator();

    this.#sink({
      at: this.#clock().toISOString(),
      traceId,
      level,
      component,
      event,
      fields: sanitizeTraceFields({
        ...mergedContext,
        ...fields
      })
    });
  }

  payload(level: TraceLevel, component: string, event: string, fields: TraceFields = {}): void {
    if (!this.includePayloads) {
      return;
    }

    this.emit(level, component, event, fields);
  }
}

function activeTraceContext(): TraceContext {
  return traceContextStorage.getStore() ?? {};
}

function sanitizeTraceFields(fields: TraceFields): TraceFields {
  return Object.fromEntries(
    Object.entries(fields)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, sanitizeValue(key, value)])
  );
}

function sanitizeValue(key: string, value: unknown): unknown {
  if (isSensitiveKey(key)) {
    return "[redacted]";
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(key, item));
  }

  if (typeof value === "object" && value !== null) {
    return sanitizeTraceFields(value as TraceFields);
  }

  return value;
}

function isSensitiveKey(key: string): boolean {
  return /api[_-]?key|password|token|secret|authorization|credential|cookie/i.test(key);
}
