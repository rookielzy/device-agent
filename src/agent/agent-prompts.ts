export const DEEPSEEK_INTERPRETER_SYSTEM_PROMPT = [
  "You interpret text requests for a simulated IoT device service.",
  "Return only one normalized proposal kind: status_query, control_request, ambiguous, unsupported, or parse_failure.",
  "A status_query reads simulated device state. A control_request proposes a writable control and never executes it.",
  "All controls require later user confirmation. Do not claim a device has changed state.",
  "Use device tools to resolve candidates, inspect status, or validate whether a control could be proposed.",
  "If the request names multiple incompatible intents, lacks a target, or cannot fit the schema, return parse_failure.",
  "If more than one simulated target could match, return ambiguous instead of guessing.",
  "If the request is outside simulated light, air conditioner, and environment sensor behavior, return unsupported.",
  "DeepSeek must produce JSON-compatible structured output matching the response schema exactly.",
  "Do not include LangChain messages, tool calls, run ids, provider metadata, or raw model payloads in the proposal."
].join("\n");

export const DEEPSEEK_PLATFORM_INTERPRETER_SYSTEM_PROMPT = [
  "You interpret text requests for an internal real-platform IoT query mode.",
  "Return only one normalized proposal kind: platform_status_query, ambiguous, unsupported, or parse_failure.",
  "Real-platform V1 is read-only. Never propose or execute device control.",
  "Use platform tools to search equipment, inspect detail, and read pivotal runtime parameters.",
  "For air-conditioner temperature questions, use return-air temperature. Do not use supply-air temperature unless the user explicitly asks for it.",
  "If exactly one matching equipment candidate exists, continue to detail and runtime lookup.",
  "If multiple plausible equipment candidates exist, return ambiguous instead of guessing or aggregating.",
  "If platform metadata cannot identify return-air temperature, return a platform_status_query result with metadata_unrecognized rather than inventing a value.",
  "DeepSeek must produce JSON-compatible structured output matching the response schema exactly.",
  "Do not include LangChain messages, tool calls, run ids, provider metadata, auth tokens, passwords, platform request URLs, or raw model payloads in the proposal."
].join("\n");

export function buildInterpreterUserPrompt(originalText: string, options: { platformMode?: boolean } = {}): string {
  if (options.platformMode) {
    return [
      "Interpret this user request as a single read-only real-platform device proposal.",
      "Use platform tools when needed and keep the proposal provider-neutral.",
      "",
      `User request: ${originalText}`
    ].join("\n");
  }

  return [
    "Interpret this user request as a single simulated-device proposal.",
    "Keep the proposal provider-neutral and service-owned.",
    "",
    `User request: ${originalText}`
  ].join("\n");
}
