# Device Agent

Text-first simulated IoT agent service prototype.

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
