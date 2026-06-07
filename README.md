# Device Agent

Text-first simulated IoT agent service prototype.

## HTTP API

The Fastify API exposes the Agent Plan Contract over task-centered routes:

```text
POST /tasks
GET /tasks/:taskId
POST /tasks/:taskId/confirm
POST /tasks/:taskId/reject
GET /debug/simulated-devices
```

`POST /tasks` accepts a JSON body with non-empty text:

```bash
curl -s http://127.0.0.1:3000/tasks \
  -H 'content-type: application/json' \
  -d '{"text":"Is the living room air conditioner running?"}'
```

Successful task routes return the provider-neutral `TaskResult` contract. Blocked domain outcomes such as ambiguity, unsupported requests, offline devices, parse failures, and pending-control failures are still task-shaped responses. Malformed HTTP requests, missing inspection targets, unknown routes, and method mismatches return the separate `ApiError` envelope.

Control requests are confirmable. First create a task, then confirm or reject the returned `taskId`:

```bash
curl -s http://127.0.0.1:3000/tasks \
  -H 'content-type: application/json' \
  -d '{"text":"Turn on the hallway light"}'

curl -s -X POST http://127.0.0.1:3000/tasks/task-001/confirm
curl -s -X POST http://127.0.0.1:3000/tasks/task-001/reject
```

`GET /debug/simulated-devices` returns a read-only snapshot of the in-memory simulated device state used by the task routes. It is a developer V1 support surface, not a real IoT adapter API.

## Running Locally

Fake mode is the default and does not require live model credentials:

```bash
pnpm install
pnpm dev
```

The dev script builds TypeScript and starts `dist/server.js`. Runtime config is read from environment variables:

```env
HOST=127.0.0.1
PORT=3000
AGENT_INTERPRETER_MODE=fake
DEEPSEEK_MODEL=deepseek-v4-flash
```

## Interpreter Modes

Local development defaults to deterministic fake interpretation:

```env
AGENT_INTERPRETER_MODE=fake
DEEPSEEK_MODEL=deepseek-v4-flash
```

Fake mode does not require `DEEPSEEK_API_KEY` and maps representative sample utterances into normalized `AgentProposal` values.

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
