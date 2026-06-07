# Agent Plan Contract V1

The Agent Plan Contract is the public response shape for the text-first IoT Agent service. It describes what the service understood, which simulated device context it selected, what reply should be shown to the user, and which timeline events explain the outcome.

Zod schemas in `src/contracts/task-contract.ts` and `src/contracts/device-contract.ts` are the canonical contract source. Route handlers, domain services, fixtures, and later client renderers should validate against those schemas instead of redefining the response shape.

## Task Result

A task result contains:

- `taskId`: stable identifier for inspecting the same task later.
- `originalText`: the user text that started the task.
- `classification`: one of `status_query`, `control_request`, `ambiguous`, or `unsupported`.
- `executionState`: one of `completed`, `pending_confirmation`, `needs_clarification`, `unavailable`, `rejected`, or `failed`.
- `outcomeReason`: machine-readable reason for the outcome. Successful and ordinary pending tasks use `none`; blocked outcomes use values such as `ambiguous_target`, `device_offline`, `unsupported_data_item`, `invalid_control_value`, `pending_control_expired`, or `control_rejected`.
- `reply`: user-facing response text.
- `plan`: structured understanding with a summary, confidence score, plan steps, and optional ambiguity reason.
- `selectedContext`: simulated devices, selected readable data items, selected writable controls, and ambiguity candidates.
- `pendingControl`: present only when a control request is waiting for confirmation.
- `timeline`: ordered service, model, client, and simulated-device events.

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

- Stages: `request_received`, `model_interpretation`, `service_validation`, `device_resolution`, `simulated_read`, `confirmation_required`, `confirmation_received`, `simulated_execution`, `final_outcome`.
- Sources: `client`, `model`, `service`, `simulated_device`.
- Statuses: `started`, `succeeded`, `waiting`, `blocked`, `failed`.

Model interpretation, service validation, and simulated device results should be separate events. This keeps LangChain proposals distinct from service-owned decisions.

## Pending Controls

Control requests are confirmable by default. A pending control contains:

- `pendingControlId`
- target device and control item
- requested value
- human-readable `confirmationSummary`
- expected effect
- optional expiration timestamp

A pending control must not claim that simulated execution happened. The timeline should include `confirmation_required` and should not include `simulated_execution` until a later confirmation flow applies the change.

## HTTP API

The Fastify API exposes the contract through task-centered routes:

- `POST /tasks` with `{ "text": "..." }` creates a task and returns `TaskResult`.
- `GET /tasks/:taskId` inspects the stored `TaskResult`.
- `POST /tasks/:taskId/confirm` confirms a pending control and returns the service-owned `TaskResult`.
- `POST /tasks/:taskId/reject` rejects a pending control and returns the service-owned `TaskResult`.
- `GET /debug/simulated-devices` returns `{ "devices": [...] }` using the same in-process simulated device service as task routes.

Domain outcomes remain task-shaped over HTTP. Ambiguous requests, unsupported requests, offline devices, parse failures, rejected controls, duplicate confirmations, expired confirmations, and missing pending controls are represented as `TaskResult` values when `TaskService` owns that lifecycle result.

Transport failures use a separate `ApiError` envelope:

```json
{
  "error": {
    "code": "validation_error",
    "message": "Request failed validation",
    "statusCode": 400,
    "details": ["text: Too small: expected string to have >=1 characters"]
  }
}
```

`ApiError.code` is one of `validation_error`, `not_found`, or `internal_error`. Examples include malformed task creation bodies, unknown task inspection, unknown routes, method mismatches, and unexpected route errors. Public HTTP responses must not expose LangChain messages, tool calls, DeepSeek raw payloads, run ids, or provider metadata.

The debug snapshot is a developer V1 support surface. It is read-only, in-memory, and does not define a real IoT adapter contract. Confirmed controls are visible there because the task service and debug route share the same simulated device service instance.

## Simulated Device Context

Simulated devices are represented through capabilities:

- `deviceId`, `displayName`, `room`, and `type`
- `availability.online` plus optional unavailable reason
- readable data items with metadata, value, freshness, and observation time
- writable controls with metadata and current value when known

Supported device types for this first contract slice are `light`, `air_conditioner`, `environment_sensor`, and `generic`. Values can be boolean, number, string, or enum metadata. Offline devices may omit current readable values and should explain unavailability through `availability.reason`.

## Provider Boundary

The public contract is provider-neutral. Clients do not need LangChain messages, tool-call objects, run objects, DeepSeek raw payloads, or model-provider response metadata. LangChain output can be used by an adapter, but service-side code must normalize and validate it before returning a task result.

## Environment Modes

Local development defaults to fake interpreter mode:

```env
AGENT_INTERPRETER_MODE=fake
DEEPSEEK_MODEL=deepseek-v4-flash
```

Fake mode must not require `DEEPSEEK_API_KEY`. Live DeepSeek mode is opt-in:

```env
AGENT_INTERPRETER_MODE=deepseek
DEEPSEEK_API_KEY=...
DEEPSEEK_MODEL=deepseek-v4-flash
```

Configuration parsing rejects live DeepSeek mode when the API key is missing.

## Interpreter Adapter Boundary

`src/agent/agent-interpreter.ts` is the provider-neutral boundary consumed by `TaskService`. The deterministic fake interpreter and the LangChain DeepSeek adapter both return normalized `AgentProposal` values:

- Fake mode maps representative sample utterances without network access or credentials.
- DeepSeek mode uses LangChain `createAgent`, `ChatDeepSeek`, simulated-device tools, and structured output.
- Device tools can resolve/read status and propose controls, but they must not apply controls or create pending controls.
- Malformed or missing structured model output becomes a `parse_failure` proposal.
- Public task results must not include LangChain messages, tool calls, run ids, raw DeepSeek payloads, or provider metadata.

## V1 Boundaries

V1 contracts describe simulated devices only. They do not promise real IoT adapter behavior, production persistence, voice input or output, automatic device control, frontend rendering, household permission checks, or real audit-retention policy.
