# Agent Plan Contract V1

The Agent Plan Contract is the public response shape for the text-first IoT Agent service. It describes what the service understood, which device context it selected, what reply should be shown to the user, and which timeline events explain the outcome. The default source is still simulated devices; an internal real-platform read mode can also return provider-neutral status-query task results.

Zod schemas in `src/contracts/task-contract.ts` and `src/contracts/device-contract.ts` are the canonical contract source. Route handlers, domain services, fixtures, and later client renderers should validate against those schemas instead of redefining the response shape.

## HTTP Task API

The Fastify transport exposes the task contract through these V1 routes:

- `POST /tasks` with `{ "text": "..." }` creates a task and returns a schema-valid `TaskResult`. Text is capped at 4,000 characters.
- `GET /tasks/:taskId` returns the stored `TaskResult` for a previously created task.
- `POST /tasks/:taskId/confirm` confirms a pending control by task id.
- `POST /tasks/:taskId/reject` rejects a pending control by task id.
- `GET /debug/simulated-devices` returns a read-only developer snapshot of simulated device contexts.

Task-domain outcomes remain task-shaped over HTTP. Ambiguous targets, unsupported requests, offline devices, parse failures, rejected controls, expired pending controls, and duplicate confirmations should return a `TaskResult` with the appropriate `executionState` and `outcomeReason`.

Transport failures are separate from task outcomes. Malformed bodies, unknown inspection targets, unknown routes, method mismatches, and unexpected route errors return an `ApiError` envelope:

```json
{
  "error": {
    "code": "bad_request",
    "message": "Request validation failed.",
    "statusCode": 400
  }
}
```

`ApiError` is defined in `src/contracts/api-contract.ts`. Clients should not treat it as a failed task result because it does not describe an interpreted user task.

## Task Result

A task result contains:

- `taskId`: stable identifier for inspecting the same task later.
- `originalText`: the user text that started the task.
- `classification`: one of `status_query`, `control_request`, `ambiguous`, or `unsupported`.
- `executionState`: one of `completed`, `pending_confirmation`, `needs_clarification`, `unavailable`, `rejected`, or `failed`.
- `outcomeReason`: machine-readable reason for the outcome. Successful and ordinary pending tasks use `none`; blocked outcomes use `ambiguous_target`, `device_not_found`, `device_offline`, `unsupported_request`, `unsupported_data_item`, `unsupported_control_item`, `read_only_control`, `invalid_control_value`, `parse_failure`, `pending_control_missing`, `pending_control_expired`, `pending_control_already_confirmed`, `pending_control_already_rejected`, `control_rejected`, `confirmation_failed`, `platform_auth_failed`, `platform_timeout`, `platform_error`, `platform_no_data`, `metadata_unrecognized`, or `service_error`.
- `reply`: user-facing response text.
- `plan`: structured understanding with a summary, confidence score, plan steps, and optional ambiguity reason.
- `selectedContext`: selected device contexts, selected readable data items, selected writable controls, and ambiguity candidates. Real-platform reads reuse the provider-neutral device context shape and must not expose raw Java payloads.
- `pendingControl`: present only when a control request is waiting for confirmation.
- `timeline`: ordered service, model, client, simulated-device, and platform events.

Example status-query payload:

```json
{
  "taskId": "task-status-001",
  "originalText": "Is the living room air conditioner running?",
  "classification": "status_query",
  "executionState": "completed",
  "outcomeReason": "none",
  "reply": "The living room air conditioner is on, cooling to 24 celsius. The room is currently 25.3 celsius.",
  "plan": {
    "summary": "Answer the living room air conditioner status from simulated readable values.",
    "confidence": 0.94,
    "steps": [
      {
        "stepId": "step-1",
        "description": "Resolve the living room air conditioner",
        "status": "completed"
      }
    ]
  },
  "selectedContext": {
    "devices": [],
    "dataItems": [],
    "controlItems": [],
    "candidates": []
  },
  "selectedDataItems": [],
  "selectedControlItems": [],
  "timeline": [
    {
      "eventId": "evt-001",
      "stage": "request_received",
      "source": "client",
      "status": "succeeded",
      "at": "2026-06-07T08:31:00.000Z",
      "detail": "Received user text"
    }
  ]
}
```

Test fixtures in `tests/fixtures/contract-fixtures.ts` carry complete examples with selected simulated devices and multi-stage timelines.

## Lifecycle States

`completed` means the service reached a final answer, usually a status query or a confirmed later outcome.

`pending_confirmation` means the service prepared a control request and did not mutate simulated state. Clients must show the confirmation summary and call a later confirmation endpoint before execution can happen.

`needs_clarification` means the service found multiple plausible targets or insufficient detail and refused to guess.

`unavailable` means the target device, data item, or control item could not be used, commonly because the simulated device is offline, unsupported, or stale.

`rejected` means a pending control request was rejected or cancelled.

`failed` means the service could not produce a successful or pending outcome but still returned a contract-shaped task result. Expected blocked failures use a specific `outcomeReason`, such as `parse_failure`, `invalid_control_value`, or `pending_control_expired`; unexpected faults should use `service_error` or `confirmation_failed`.

Clients should use `outcomeReason` for branching and analytics instead of parsing `reply` or timeline detail text. `executionState` describes the lifecycle bucket; `outcomeReason` explains why that bucket was reached.

## Timeline Vocabulary

Timeline events use stable `stage`, `source`, and `status` values so failures are attributable:

- Stages: `request_received`, `model_interpretation`, `service_validation`, `device_resolution`, `simulated_read`, `platform_auth`, `platform_search`, `platform_detail`, `platform_runtime_read`, `confirmation_required`, `confirmation_received`, `simulated_execution`, `final_outcome`.
- Sources: `client`, `model`, `service`, `simulated_device`, `platform`.
- Statuses: `started`, `succeeded`, `waiting`, `blocked`, `failed`.

Model interpretation, service validation, and simulated device results should be separate events. This keeps LangChain proposals distinct from service-owned decisions.

Platform query mode uses `platform_search`, `platform_detail`, and `platform_runtime_read` to attribute read-only Java-platform interactions. Platform authentication failures use `platform_auth`. Timeline detail text must stay sanitized and must not include tokens, passwords, raw request URLs, or platform auth headers.

## Pending Controls

Control requests are confirmable by default. A pending control contains:

- `pendingControlId`
- target device and control item
- requested value
- human-readable `confirmationSummary`
- expected effect
- optional expiration timestamp

A pending control must not claim that simulated execution happened. The timeline should include `confirmation_required` and should not include `simulated_execution` until a later confirmation flow applies the change.

The HTTP confirmation routes operate on task ids. Confirmation and rejection do not reinterpret the original user text and do not accept a new natural-language body. The service applies simulated mutation only after stored pending-control validation succeeds.

## Simulated Device Context

Simulated devices are represented through capabilities:

- `deviceId`, `displayName`, `room`, and `type`
- `availability.online` plus optional unavailable reason
- readable data items with metadata, value, freshness, and observation time
- writable controls with metadata and current value when known

Supported device types for this first contract slice are `light`, `air_conditioner`, `environment_sensor`, and `generic`. Values can be boolean, number, string, or enum metadata. Offline devices may omit current readable values and should explain unavailability through `availability.reason`.

The debug snapshot endpoint returns these same simulated device contexts in a `{ "devices": [...] }` envelope. It is intentionally read-only and exists so developer testers can inspect fake-mode state transitions. It does not add reset, seed editing, write, or real-adapter operations. Runtime startup exposes it by default only for localhost hosts; non-local bindings must opt in with `ENABLE_DEBUG_SIMULATED_DEVICES=true`.

## Provider Boundary

The public contract is provider-neutral. Clients do not need LangChain messages, tool-call objects, run objects, DeepSeek raw payloads, or model-provider response metadata. LangChain output can be used by an adapter, but service-side code must normalize and validate it before returning a task result.

Internal real-platform mode may provide original Java response fields to model-visible platform tools for V1 validation, but public `TaskResult` values expose only selected device context, selected facts, machine-readable reasons, and sanitized timeline attribution. Raw Java payloads, bearer tokens, refresh tokens, validation passwords, `x-user-header` values, request URLs, and provider-specific tool-call objects must not appear in public responses.

## Environment Modes

Local development defaults to fake interpreter mode:

```env
AGENT_INTERPRETER_MODE=fake
AGENT_DEVICE_CAPABILITY_MODE=simulated
DEEPSEEK_MODEL=deepseek-v4-flash
```

Fake mode must not require `DEEPSEEK_API_KEY`. Live DeepSeek mode is opt-in:

```env
AGENT_INTERPRETER_MODE=deepseek
DEEPSEEK_API_KEY=...
DEEPSEEK_MODEL=deepseek-v4-flash
```

Configuration parsing rejects live DeepSeek mode when the API key is missing.

Real-platform query mode is opt-in and requires DeepSeek plus platform validation configuration:

```env
AGENT_INTERPRETER_MODE=deepseek
AGENT_DEVICE_CAPABILITY_MODE=platform
DEEPSEEK_API_KEY=...
PLATFORM_USER_CENTER_BASE_URL=...
PLATFORM_IOT_BASE_URL=...
PLATFORM_VALIDATION_MOBILE=...
PLATFORM_VALIDATION_PASSWORD=...
PLATFORM_VALIDATION_PROJECT_ID=270544150790145
PLATFORM_REQUEST_TIMEOUT_MS=5000
```

This mode is internal read-only validation for Java-platform status queries and is limited to runtime hosts `127.0.0.1` or `localhost`. It uses the configured validation account rather than per-user session forwarding, defaults to project `270544150790145`, and supports the target air-conditioner status question by searching equipment, reading equipment detail, and reading pivotal runtime parameters. Device control against real equipment remains out of scope.

Live smoke validation is manual and opt-in. `tests/agent/langchain-live-smoke.test.ts` runs simulated DeepSeek smoke only when both `DEEPSEEK_LIVE_SMOKE=1` and `DEEPSEEK_API_KEY` are present, then checks that one status query and one control request parse through the provider-neutral proposal schema. Platform live smoke requires `PLATFORM_LIVE_SMOKE=1`, `DEEPSEEK_API_KEY`, and all platform credential/base-url variables. Network access, model availability, Java-platform availability, latency, and provider cost are outside the default regression suite.

## Interpreter Adapter Boundary

`src/agent/agent-interpreter.ts` is the provider-neutral boundary consumed by `TaskService`. The deterministic fake interpreter and the LangChain DeepSeek adapter both return normalized `AgentProposal` values:

- Fake mode maps representative sample utterances without network access or credentials.
- DeepSeek mode uses LangChain `createAgent`, `ChatDeepSeek`, simulated-device tools, and structured output.
- DeepSeek platform mode uses read-only platform tools for project or area listing, equipment search, equipment detail, pivotal runtime parameters, and air-conditioner status lookup.
- Device tools can resolve/read status and propose controls, but they must not apply controls or create pending controls.
- Malformed or missing structured model output becomes a `parse_failure` proposal.
- Public task results must not include LangChain messages, tool calls, run ids, raw DeepSeek payloads, or provider metadata.

## V1 Boundaries

V1 contracts primarily describe simulated devices plus an internal real-platform read mode. They do not promise production real IoT adapter behavior, production persistence, voice input or output, automatic device control, frontend rendering, household permission checks, or real audit-retention policy.

Known operational limits remain outside this slice:

- Task and pending-control repositories are in-memory and do not enforce retention; unbounded in-memory task growth is deferred follow-up work.
- Runtime request or handler timeout hardening is deferred follow-up work.
- Authentication, authorization, CORS, rate limiting, production observability, and deployment runbooks are not part of V1.
- The debug simulated-device endpoint is for local developer inspection only and is not a real adapter management surface.
- Per-user platform auth forwarding, raw Java payload curation, platform write APIs, and production rollout hardening remain follow-up work.
