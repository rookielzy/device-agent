---
date: 2026-06-06
topic: agent-plan-contract
---

# Requirements: Agent Plan Contract

## Summary

Build a text-first service-side task interface for an IoT AI Agent. V1 uses simulated devices to prove that natural language can locate the right device/data item, answer status queries, and create confirmable control requests whose confirmation updates simulated state.

---

## Problem Frame

Today users can view devices through a WeChat mini program, but they must manually find the device, then find the right data item or control item before they can act. That makes the first Agent value proposition narrower than “replace the mini program”: it should remove the device/data-item lookup work for common status questions.

The first consumer is the developer building and debugging the service. The experience should be verifiable through API clients or scripts, with enough plan and timeline detail to see how the Agent interpreted the request and what it would do next.

---

## Key Decisions

- **Query-first MVP.** Status lookup is the primary proof because it directly targets the current mini-program friction: users know the thing they want to ask, but not where the corresponding device/data item lives.
- **Control as a confirmable request.** V1 includes control requests only to validate confirmation and state-change semantics; it does not allow fully automatic device control.
- **Simulated devices before real adapters.** The first version uses simulated lights, air conditioners, and sensors so the service contract can be validated before real IoT platform integration.
- **Text-only before voice.** ASR and TTS stay out of V1 so the Agent Plan Contract is not blocked by audio formats, streaming, latency, or voice-style concerns.
- **Developer-facing responses.** V1 favors inspectable plan and timeline details over end-user copy polish because curl, Postman, and scripts are the first review surface.
- **LangChain TS as the LLM orchestration layer.** V1 uses LangChain JavaScript/TypeScript to integrate DeepSeek, tool calling, and structured model output, while the Agent Plan Contract, confirmation semantics, simulated state mutation, and timeline remain owned by the service domain layer.

---

## Technical Direction

LangChain TS should be introduced as a thin orchestration layer rather than as the business source of truth. The service can use LangChain agents, tools, structured output, and middleware to translate natural-language requests into task intent and domain-level tool calls. The canonical task record, pending-control lifecycle, policy checks, simulated device state, and audit timeline should remain framework-independent.

LangGraph is a likely future option if the Agent requires durable execution, resumable multi-step workflows, or richer human-in-the-loop state management. It is deferred for V1 unless the first implementation proves that plain LangChain orchestration cannot express the confirmation flow cleanly.

---

## Actors

- A1. **Developer tester:** Sends text requests, reviews task plans, confirms control requests, and checks simulated device state changes.
- A2. **Agent service:** Converts natural language into a task plan, uses simulated device knowledge, and returns user-facing replies plus debug-friendly plan details.
- A3. **Simulated device layer:** Provides light, air-conditioner, and sensor state; accepts confirmed control actions; returns success, failure, offline, and state-change outcomes.
- A4. **Future client:** A later mini program, app, or voice client that can render the same plan, confirmation, and timeline contract without changing the core behavior.

---

## Requirements

**Task Contract**

- R1. The service accepts a text request and returns a task result that separates the natural-language reply from the Agent's structured understanding and execution state.
- R2. Each task result identifies whether the request was handled as a status query, a control request, an unsupported request, or an ambiguous request.
- R3. Each task result carries a stable task identifier so the developer can inspect the same task after the initial response.
- R4. The task result exposes enough plan detail for a developer to see the selected device, selected data item or control item, intended action, and confidence or ambiguity.

**Status Query Behavior**

- R5. The Agent resolves common status questions against simulated lights, air conditioners, and sensors without requiring the user to name the exact data item.
- R6. The Agent answers status questions with the relevant simulated value, device identity, and state freshness when available.
- R7. The Agent asks for clarification when multiple simulated devices plausibly match the same request and no safe default exists.
- R8. The Agent reports offline, unavailable, unsupported, or stale simulated data as first-class outcomes rather than pretending the query succeeded.

**Control Request Behavior**

- R9. The Agent turns controllable natural-language requests into pending control requests rather than executing them immediately.
- R10. A pending control request includes a human-readable confirmation summary covering target device, control item, requested value, and expected effect.
- R11. Confirming a pending control request updates the simulated device state when the device is available and the control item is supported.
- R12. Rejecting or ignoring a pending control request leaves simulated device state unchanged.
- R13. The Agent blocks or downgrades control requests when the simulated device is offline, unsupported, ambiguous, or unsafe for V1.

**Simulation Scope**

- R14. The simulated device set includes at least one light, one air conditioner, and one environmental sensor.
- R15. Simulated devices cover online and offline states, read-only data items, controllable items, and at least one failure or unavailable branch.
- R16. The simulation behaves consistently across tasks so a confirmed state change can be observed by a later status query.

**Timeline And Observability**

- R17. Each task records a timeline of meaningful stages: request received, interpretation, device/data-item resolution, confirmation required, confirmation received when applicable, simulated execution, and final outcome.
- R18. The timeline distinguishes model interpretation, service-side validation, and simulated device response so failures are attributable.
- R19. The task record preserves the original user text, the selected simulated device context, and the final user-facing reply for replay and debugging.

**Scope Guardrails**

- R20. V1 does not connect to real device adapters or mutate real IoT platform state.
- R21. V1 does not require ASR, TTS, voice streaming, wake words, or audio artifacts.
- R22. V1 does not require an end-user frontend, but its contract must be renderable by a future client without changing the core task semantics.
- R23. V1 does not allow fully automatic control without a confirmation step.

**LLM Orchestration Boundary**

- R24. LangChain output is treated as an interpretation proposal that must be normalized and validated by service-side code before it becomes a task result, pending control request, or simulated execution.
- R25. LangChain tools expose domain-level capabilities such as resolving devices, reading simulated state, and proposing control requests; they do not expose raw real-device APIs in V1.
- R26. The public task contract does not leak LangChain-specific internal message, run, or tool-call types as required client fields.
- R27. The service can swap model providers or LangChain implementation details without changing the externally visible Agent Plan Contract.
- R28. Prompt, tool schema, and structured-output changes must be covered by sample utterance regression tests before they are trusted for task classification or control proposal behavior.

---

## Key Flows

- F1. Status query resolves a data item.
  - **Trigger:** The developer submits a text request such as asking whether the living-room air conditioner is running.
  - **Actors:** A1, A2, A3
  - **Steps:** The Agent interprets the request, resolves the simulated device and data item, reads simulated state, records timeline stages, and returns a natural-language answer plus plan details.
  - **Outcome:** The developer sees which device/data item was chosen and the status answer.
  - **Covers:** R1, R2, R4, R5, R6, R17, R19

- F2. Ambiguous query asks for clarification.
  - **Trigger:** The developer asks a vague question that matches multiple simulated devices, such as asking for “the bedroom device” when more than one device qualifies.
  - **Actors:** A1, A2, A3
  - **Steps:** The Agent detects multiple plausible matches, avoids choosing one silently, records the ambiguity, and returns a clarification prompt.
  - **Outcome:** No simulated state changes; the developer can see the candidate devices or ambiguity reason.
  - **Covers:** R2, R4, R7, R17, R18

- F3. Control request waits for confirmation.
  - **Trigger:** The developer submits a text request such as asking to turn on a simulated light.
  - **Actors:** A1, A2, A3
  - **Steps:** The Agent resolves the target and control item, creates a pending control request, returns a confirmation summary, and records that execution is waiting.
  - **Outcome:** The simulated device state remains unchanged until confirmation.
  - **Covers:** R9, R10, R12, R17, R19, R23

- F4. Confirmed control updates simulated state.
  - **Trigger:** The developer confirms a pending control request.
  - **Actors:** A1, A2, A3
  - **Steps:** The service validates the pending request, executes against the simulated device layer, records the simulated response, and returns the final outcome.
  - **Outcome:** A later status query reflects the confirmed simulated state change.
  - **Covers:** R3, R11, R16, R17, R18

- F5. Unavailable device returns an honest outcome.
  - **Trigger:** The developer queries or requests control for an offline or unavailable simulated device.
  - **Actors:** A1, A2, A3
  - **Steps:** The Agent resolves the target, the simulated layer reports unavailable state, and the service returns a non-success outcome with timeline evidence.
  - **Outcome:** The response does not claim success and does not mutate simulated state.
  - **Covers:** R8, R13, R15, R18

---

## Acceptance Examples

- AE1. Status query finds the right data item.
  - **Given:** A simulated air conditioner has power, mode, target temperature, and room temperature values.
  - **When:** The developer asks for the air conditioner's current status in natural language.
  - **Then:** The task is classified as a status query, returns the relevant values, and records which simulated device/data items were used.
  - **Covers:** R2, R4, R5, R6

- AE2. Confirmed control changes later query results.
  - **Given:** A simulated light is off and online.
  - **When:** The developer asks to turn it on, confirms the pending control request, and then asks whether the light is on.
  - **Then:** The first request creates a pending control request, confirmation updates simulated state, and the later query reports the light as on.
  - **Covers:** R9, R10, R11, R16

- AE3. Unconfirmed control does not mutate state.
  - **Given:** A simulated light is off and online.
  - **When:** The developer asks to turn it on but does not confirm the pending control request.
  - **Then:** The simulated light remains off and the timeline shows the task waiting for confirmation.
  - **Covers:** R9, R12, R17, R23

- AE4. Offline control is blocked.
  - **Given:** A simulated device is offline.
  - **When:** The developer asks to control it.
  - **Then:** The Agent returns an unavailable outcome, does not create an executable action, and leaves simulated state unchanged.
  - **Covers:** R8, R13, R15

- AE5. Ambiguous device reference does not guess.
  - **Given:** Two simulated devices could satisfy the same user phrase.
  - **When:** The developer asks a request that does not identify which one is intended.
  - **Then:** The Agent asks for clarification and exposes the ambiguity in plan details.
  - **Covers:** R7, R18

---

## Success Criteria

- A developer can demonstrate status lookup for light, air conditioner, and sensor simulations without knowing exact data-item names.
- A developer can demonstrate that confirmed control changes simulated state and unconfirmed control does not.
- A developer can inspect a task and understand the selected device, selected data/control item, outcome, and failure point without reading service internals.
- The requirements remain compatible with later real IoT adapters and voice adapters because V1 behavior is expressed through task semantics rather than UI or audio behavior.

---

## Scope Boundaries

- Real IoT platform integration is deferred until the task contract proves useful against simulation.
- MiMo ASR/TTS integration is deferred until the text-first contract is stable.
- End-user frontend replacement is deferred; V1 is reviewed through developer tools.
- Scene automation, multi-device routines, and fully automatic control are deferred.
- LangGraph orchestration is deferred unless V1 needs durable, resumable, or more explicit human-in-the-loop workflow state than LangChain agents and service-owned pending tasks can provide.
- Real permission models, household sharing, and production audit retention are deferred, but V1 must not contradict those future needs.

---

## Dependencies And Assumptions

- The simulated device layer can represent realistic enough device names, rooms, data items, control items, online states, and failure states to validate the contract.
- DeepSeek or another LLM can produce sufficiently structured interpretations for the task contract, but the requirements do not depend on a specific model name.
- LangChain JavaScript/TypeScript and the `@langchain/deepseek` integration are suitable for the first DeepSeek model adapter, tool-calling layer, and structured-output experiments.
- The future real IoT platform adapter can eventually map its devices and data/control items into the same task concepts used by simulation.
- Developer-facing response detail is acceptable in V1, even if future end-user clients hide most plan and timeline fields.
- The implementation keeps a thin adapter around LangChain so business logic and tests do not become coupled to framework-specific runtime objects.

---

## Outstanding Questions

### Deferred To Planning

- Which service framework and runtime should host the first task interface?
- How should the simulated device state persist across local runs and tests?
- What exact response shape should downstream developer tools consume?
- Which LangChain package versions and DeepSeek model profile should be pinned for the first implementation?
- Which sample utterances should become the first regression suite?

---

## Sources

- `docs/ideation/2026-06-06-iot-server-agent-ideation.md`
- [DeepSeek Tool Calls](https://api-docs.deepseek.com/guides/tool_calls)
- [DeepSeek Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing)
- [LangChain JS Overview](https://docs.langchain.com/oss/javascript/langchain/overview)
- [LangChain JS Agents](https://docs.langchain.com/oss/javascript/langchain/agents)
- [LangChain ChatDeepSeek Integration](https://docs.langchain.com/oss/javascript/integrations/chat/deepseek)
- [LangGraph JS Overview](https://docs.langchain.com/oss/javascript/langgraph/overview)
- [Xiaomi MiMo-V2.5-TTS](https://platform.xiaomimimo.com/static/docs/usage-guide/speech-synthesis-v2.5.md)
- [Xiaomi MiMo-V2.5-ASR](https://platform.xiaomimimo.com/static/docs/usage-guide/Speech-Recognition.md)
