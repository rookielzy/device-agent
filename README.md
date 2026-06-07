# Device Agent

Text-first simulated IoT agent service prototype.

## HTTP API

Build and run the Fastify API in deterministic fake mode:

```bash
pnpm build
AGENT_INTERPRETER_MODE=fake pnpm start
```

The server listens on `HOST` and `PORT`, defaulting to `127.0.0.1:3000`.
Fake mode does not require `DEEPSEEK_API_KEY`.

Create a task:

```bash
TASK_ID=$(curl -s http://127.0.0.1:3000/tasks \
  -H 'content-type: application/json' \
  -d '{"text":"Turn on the hallway light"}' \
  | node -pe 'JSON.parse(require("node:fs").readFileSync(0, "utf8")).taskId')
```

Inspect a stored task:

```bash
curl -s "http://127.0.0.1:3000/tasks/$TASK_ID"
```

Confirm or reject pending controls by running one of:

```bash
curl -s -X POST "http://127.0.0.1:3000/tasks/$TASK_ID/confirm" \
  -H 'content-type: application/json' \
  -d '{}'

curl -s -X POST "http://127.0.0.1:3000/tasks/$TASK_ID/reject" \
  -H 'content-type: application/json' \
  -d '{}'
```

Read the V1 developer debug snapshot:

```bash
curl -s http://127.0.0.1:3000/debug/simulated-devices
```

Task routes return the public `TaskResult` contract for domain outcomes such as
completed status reads, pending confirmations, clarification, unsupported
requests, offline devices, rejected controls, and parse failures. Transport
failures such as malformed request bodies, unknown task inspection, unknown
routes, and method mismatches return an `ApiError` envelope.

State is in memory for this V1 prototype. Tasks, pending controls, and simulated
device mutations reset when the process restarts. The debug endpoint is
read-only and is not a real IoT adapter API.

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
