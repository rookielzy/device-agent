# Device Agent

Text-first simulated IoT agent service prototype. The service accepts natural-language status and control requests, normalizes them into the provider-neutral Agent Plan Contract, and uses in-memory simulated devices so local development works without real IoT hardware or model credentials.

## Quickstart

Fake mode is the default and does not require `DEEPSEEK_API_KEY`:

```bash
pnpm install
pnpm dev
```

The dev script builds TypeScript and starts the emitted Fastify server:

```text
http://127.0.0.1:3000
```

Useful environment variables are:

```env
HOST=127.0.0.1
PORT=3000
AGENT_INTERPRETER_MODE=fake
DEEPSEEK_API_KEY=
DEEPSEEK_MODEL=deepseek-v4-flash
ENABLE_DEBUG_SIMULATED_DEVICES=false
```

`GET /debug/simulated-devices` is exposed automatically for localhost runtime hosts. Set `ENABLE_DEBUG_SIMULATED_DEVICES=true` only when deliberately exposing that developer endpoint from another host binding.

## HTTP API

The Fastify API exposes the Agent Plan Contract over task-centered routes:

```text
POST /tasks
GET /tasks/:taskId
POST /tasks/:taskId/confirm
POST /tasks/:taskId/reject
GET /debug/simulated-devices
```

`POST /tasks` accepts a JSON body with non-empty text up to 4,000 characters. This status-query example is covered by `tests/fixtures/sample-utterances.ts`:

```bash
curl -s http://127.0.0.1:3000/tasks \
  -H 'content-type: application/json' \
  -d '{"text":"Is the living room air conditioner running?"}'
```

Task routes return the provider-neutral `TaskResult` contract. Blocked domain outcomes such as ambiguity, unsupported requests, offline devices, parse failures, and pending-control failures are still task-shaped responses. Malformed HTTP requests, missing inspection targets, unknown routes, and method mismatches return the separate `ApiError` envelope.

Control requests are confirmable. First create a task:

```bash
curl -s http://127.0.0.1:3000/tasks \
  -H 'content-type: application/json' \
  -d '{"text":"Turn on the hallway light"}'
```

The response will be `pending_confirmation` and include a `taskId` plus `pendingControl`. Simulated state is not mutated yet. Confirm or reject by task id:

```bash
curl -s -X POST http://127.0.0.1:3000/tasks/task-001/confirm
curl -s -X POST http://127.0.0.1:3000/tasks/task-001/reject
```

Confirmation and rejection routes do not accept natural-language request bodies. Confirmation applies the stored pending control once; rejection keeps simulated state unchanged.

Inspect fake-mode device state with:

```bash
curl -s http://127.0.0.1:3000/debug/simulated-devices
```

The debug snapshot returns read-only simulated device context. It is a developer V1 support surface, not a real IoT adapter API.

## Interpreter Modes

Local development defaults to deterministic fake interpretation:

```env
AGENT_INTERPRETER_MODE=fake
DEEPSEEK_MODEL=deepseek-v4-flash
```

Fake mode maps representative sample utterances into normalized `AgentProposal` values. The shared sample registry covers status, confirmed control, unconfirmed or rejected control, offline control, ambiguous device references, unsupported/read-only control, and parse failure.

Live DeepSeek mode is opt-in:

```env
AGENT_INTERPRETER_MODE=deepseek
DEEPSEEK_API_KEY=...
DEEPSEEK_MODEL=deepseek-v4-flash
```

The LangChain adapter uses `ChatDeepSeek`, simulated-device tools, and structured output. It returns only provider-neutral proposals to `TaskService`; controls are proposed for later confirmation and are not executed by the adapter.

## Tests

Default checks are offline:

```bash
pnpm typecheck
pnpm test
```

Optional live smoke validation requires credentials and an explicit flag:

```bash
DEEPSEEK_LIVE_SMOKE=1 DEEPSEEK_API_KEY=... pnpm vitest run tests/agent/langchain-live-smoke.test.ts
```

The live smoke path validates coarse proposal categories only; network access, model availability, and provider cost are outside the default regression suite.

## V1 Limits

This prototype is simulated and in-memory. Current V1 boundaries are deliberate:

- No real IoT adapter, device-provider runbook, or production mutation workflow.
- No persistent task store; unbounded in-memory task growth remains follow-up work.
- No request or handler timeout hardening beyond Fastify defaults.
- Authentication, authorization, CORS, rate limiting, production observability, and deployment guidance are not part of V1.
- No frontend, voice, ASR, TTS, wake word, or polished end-user conversation layer.

See `docs/contracts/agent-plan-contract.md` for the stable contract semantics.
