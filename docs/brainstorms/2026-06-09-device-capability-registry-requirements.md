---
date: 2026-06-09
topic: device-capability-registry
---

# Requirements: Device Capability Registry

## Summary

Build Device Capability Registry V1 as an internal Agent capability layer over the existing Java IoT device query APIs. V1 proves that the LLM can actively locate a real air conditioner, fetch device detail and runtime data, and answer whether it is on and what the current return-air temperature is in ordinary-user language.

---

## Problem Frame

Today a user answers a simple device-status question by entering the system overview, waiting for the project device list grouped by area, finding the target device, opening its detail page, and then reading runtime state and data. The slowest part is finding the target device.

The existing platform already has Java interfaces for device search, device detail, and runtime parameters. The Registry should not start as a local device database or a full metadata sync. Its first value is to turn those existing interfaces into governed Agent tools with just enough semantics for reliable status lookup.

The first real sample is: "A 项目 1 楼财务室空调开着吗？现在多少度？" The platform is operated by an air-conditioning manufacturer, so air conditioners have rich runtime data such as switch state, supply-air temperature, return-air temperature, and detailed device metadata.

---

## Key Decisions

- **Query-first and air-conditioner-first.** V1 focuses on read-only device lookup and air-conditioner status answers before control, alerts, or broad device semantics.
- **Active API calls, not local sync.** The Agent uses existing Java query interfaces at request time instead of maintaining a local device master-data snapshot.
- **Direct search path.** The preferred flow is device search by project, floor or area, room, and device type, followed by detail and runtime-parameter lookup.
- **Stepwise LLM tool use.** The LLM may call multiple governed tools to locate the device and gather data, while the Agent service validates tool parameters and forwards platform auth context.
- **Raw Java results for internal V1.** Tool results are returned to the LLM in the original Java interface shape for fastest validation, but V1 is limited to development and internal-network use.
- **Ordinary-user response.** For "现在多少度", V1 treats return-air temperature as the current room/environment temperature and keeps the user-facing reply concise.

---

## Actors

- A1. **Internal tester:** Asks natural-language device-status questions using a current platform login context.
- A2. **Agent service:** Receives the request, exposes governed device-query tools, forwards auth context, records the tool sequence, and returns the final task result.
- A3. **LLM interpreter:** Extracts search intent, chooses query tools, reads tool results, and drafts the answer within service guardrails.
- A4. **Existing Java IoT platform:** Authorizes requests and returns device search, detail, point metadata, runtime parameters, and platform status or error information.

---

## Requirements

**Tool Capability Surface**

- R1. V1 exposes query capabilities for listing projects or areas, searching devices, fetching device detail, and fetching runtime parameters.
- R2. The query capabilities are governed Agent tools, not unrestricted access to every Java platform interface.
- R3. Tool calls forward the current user's platform token or session and rely on existing platform authorization.
- R4. Tool-call order, selected device context, platform result status, and final answer are inspectable in the task record or debug surface.

**Device Location**

- R5. The Agent extracts available project, floor or area, room, and device-type constraints from the user's text before searching devices.
- R6. If a search with incomplete constraints returns one matching device, the Agent may continue without asking the user to restate all location fields.
- R7. If a search returns multiple plausible devices, the Agent asks the user to choose instead of guessing, aggregating, or applying a hidden default.
- R8. If the platform search returns no matching device, the Agent reports that no target device was found and does not invent a device.

**Air-Conditioner Status Semantics**

- R9. For an air-conditioner status question, the Agent fetches device detail and runtime parameters for the uniquely selected device.
- R10. The Agent uses point metadata returned by the Java interfaces to identify switch state, return-air temperature, and supply-air temperature.
- R11. V1 does not maintain an independent model or series mapping table for air-conditioner point differences.
- R12. If point metadata cannot identify the needed air-conditioner values, the Agent says it cannot determine the value or falls back to raw platform fields without guessing.
- R13. "现在多少度" defaults to return-air temperature unless the user explicitly asks for supply-air temperature or another temperature point.
- R14. The ordinary user-facing answer includes switch state and return-air temperature when both are available.
- R15. The ordinary user-facing answer does not show point codes, raw field names, or detailed timestamps by default.

**Other Device Types**

- R16. Non-air-conditioner devices can use the same search and runtime-query tools, but V1 only returns basic platform runtime parameters without deep semantic interpretation.

**Runtime Outcomes And Boundaries**

- R17. Platform statuses such as offline, timeout, no data, or platform error are organized into a user-readable answer based on the original Java interface result.
- R18. V1 preserves the original platform status or error information for internal inspection.
- R19. V1 is read-only and does not create, propose, confirm, or execute device-control actions.
- R20. V1 is limited to development or internal-network validation while raw Java interface results are sent into the model context.

---

## Key Flows

- F1. Air-conditioner status query succeeds.
  - **Trigger:** The user asks whether the A 项目 1 楼财务室 air conditioner is on and what the current temperature is.
  - **Actors:** A1, A2, A3, A4
  - **Steps:** The LLM calls the device-search tool with the extracted location and device type, receives one device, calls device detail and runtime-parameter tools, identifies switch state and return-air temperature from metadata, and drafts a concise answer.
  - **Outcome:** The user receives an answer such as the air conditioner is on and the current return-air temperature is a specific value.
  - **Covers:** R5, R6, R9, R10, R13, R14

- F2. Incomplete location still resolves uniquely.
  - **Trigger:** The user omits one location condition, such as floor, but the search result is still unique under the user's authorized project scope.
  - **Actors:** A1, A2, A3, A4
  - **Steps:** The LLM calls search with the available constraints, the platform returns one matching device, and the Agent continues to detail and runtime lookup.
  - **Outcome:** The user gets the answer without being forced to provide a fully structured query.
  - **Covers:** R5, R6

- F3. Device search is ambiguous.
  - **Trigger:** The search result contains multiple plausible devices, such as more than one air conditioner in the same room.
  - **Actors:** A1, A2, A3, A4
  - **Steps:** The Agent exposes candidates and asks the user which device to use.
  - **Outcome:** No runtime answer is fabricated from an arbitrary device.
  - **Covers:** R7

- F4. Runtime data is unavailable or unclear.
  - **Trigger:** The selected device is offline, the platform times out, no runtime data is returned, or metadata does not identify return-air temperature.
  - **Actors:** A1, A2, A3, A4
  - **Steps:** The Agent uses the platform's returned status or raw field information to explain the limitation.
  - **Outcome:** The answer is honest about unavailable or unclear data.
  - **Covers:** R12, R17, R18

- F5. Non-air-conditioner query uses basic pass-through.
  - **Trigger:** The user asks about another device type covered by existing Java search and runtime interfaces.
  - **Actors:** A1, A2, A3, A4
  - **Steps:** The Agent searches and fetches runtime parameters but does not apply air-conditioner-specific semantics.
  - **Outcome:** The user receives basic platform runtime information or an unsupported-semantics response.
  - **Covers:** R16

---

## Acceptance Examples

- AE1. Air-conditioner status query answers the target scenario.
  - **Given:** The platform has one authorized air conditioner matching A 项目, 1 楼, 财务室, and 空调.
  - **When:** The user asks whether it is on and what the current temperature is.
  - **Then:** The Agent searches the device, fetches detail and runtime data, and answers with switch state plus return-air temperature.
  - **Covers:** R5, R6, R9, R10, R13, R14

- AE2. Multiple matching devices ask for clarification.
  - **Given:** The same search constraints match two or more authorized air conditioners.
  - **When:** The user asks the status question.
  - **Then:** The Agent asks the user to choose a device and does not aggregate or guess.
  - **Covers:** R7

- AE3. Missing condition can still proceed when unique.
  - **Given:** The user omits a location field but the platform search still returns one matching air conditioner.
  - **When:** The Agent receives the result.
  - **Then:** The Agent continues to runtime lookup without requiring the missing field.
  - **Covers:** R6

- AE4. Unrecognized point metadata does not produce a fake temperature.
  - **Given:** Runtime data exists but point metadata cannot identify return-air temperature.
  - **When:** The user asks "现在多少度".
  - **Then:** The Agent says the current temperature cannot be determined from the available data or returns raw platform fields as internal/dev output.
  - **Covers:** R10, R12

- AE5. Platform failure is visible.
  - **Given:** The runtime-parameter interface returns offline, timeout, no data, or platform error.
  - **When:** The Agent tries to answer the status question.
  - **Then:** The Agent explains the platform outcome and preserves the original status or error for inspection.
  - **Covers:** R17, R18

- AE6. Raw interface results remain internal.
  - **Given:** The Java interfaces return complete original payloads.
  - **When:** V1 passes those payloads to the LLM.
  - **Then:** The capability is available only in development or internal-network validation, not as a production user-facing feature.
  - **Covers:** R20

---

## Success Criteria

- A developer can demonstrate the exact A 项目 1 楼财务室空调 query through the Agent and see the final answer.
- The task record shows that the Agent actively called search, detail, and runtime-parameter capabilities instead of relying on a prompt-only answer.
- The Agent answers with return-air temperature for the ordinary "现在多少度" question when metadata supports it.
- Ambiguous device results lead to clarification rather than guessing.
- Platform failures and unclear metadata produce honest non-success answers.
- The V1 artifact is clearly marked as internal validation because raw platform payloads enter model context.

---

## Scope Boundaries

- Production rollout to real end users is not in V1.
- Field whitelist, payload trimming, desensitization, and token-cost optimization are deferred.
- Local synchronization or caching of full device master data is not in V1.
- Device control, confirmation, and write operations are not in V1.
- Alarm interpretation and proactive alarm reporting are not in V1.
- Full semantic modeling for every device type is not in V1.
- Voice input, TTS output, and frontend rendering are not in V1.

---

## Dependencies And Assumptions

- The existing Java platform has a device search or filtering interface that can search by project, floor or area, room, and device type.
- The current user's platform token or session can be forwarded safely from the Agent service to the Java interfaces.
- Device detail or runtime-parameter responses include enough point metadata for common air-conditioner values.
- Air-conditioner switch state and return-air temperature are mostly consistent across models, with differences represented by platform metadata.
- Internal development use of raw Java payloads in model context is acceptable for V1 validation.
- The existing Agent Plan Contract can carry tool calls, selected device context, platform outcomes, and final replies without changing its core task semantics.

---

## Outstanding Questions

### Deferred To Planning

- What are the exact Java interface contracts, auth headers, and error shapes for search, detail, and runtime-parameter calls?
- Which point metadata fields should be trusted to identify switch state, return-air temperature, and supply-air temperature?
- What timeout and retry behavior should the Agent service apply around Java platform calls?
- How should raw Java payloads be stored or redacted in internal task logs during V1 validation?
- Which real air-conditioner models should be sampled to prove metadata-based interpretation across model differences?

---

## Sources

- `docs/ideation/2026-06-06-iot-server-agent-ideation.md`
- `docs/brainstorms/2026-06-06-agent-plan-contract-requirements.md`
- `docs/plans/2026-06-07-001-feat-agent-plan-contract-service-plan.md`
- `README.md`
