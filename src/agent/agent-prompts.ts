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
  "Return a single JSON object only. Do not wrap it in markdown, prose, or an array.",
  "Allowed top-level JSON kinds are exactly status_query, control_request, ambiguous, unsupported, and parse_failure.",
  "For status_query use {\"kind\":\"status_query\",\"target\":{\"room\":\"...\",\"deviceType\":\"light|air_conditioner|environment_sensor|generic\",\"dataItem\":\"...\",\"phrase\":\"...\"},\"summary\":\"...\",\"confidence\":0.9}.",
  "For control_request use {\"kind\":\"control_request\",\"target\":{\"room\":\"...\",\"deviceType\":\"light|air_conditioner|environment_sensor|generic\",\"controlItem\":\"...\",\"requestedValue\":true},\"confirmationSummary\":\"...\",\"summary\":\"...\",\"confidence\":0.9}.",
  "For ambiguous use {\"kind\":\"ambiguous\",\"reason\":\"ambiguous_target\",\"candidates\":[],\"summary\":\"...\",\"confidence\":0.6}.",
  "For unsupported use {\"kind\":\"unsupported\",\"reason\":\"unsupported_request\",\"summary\":\"...\",\"confidence\":0.6}.",
  "For parse_failure use {\"kind\":\"parse_failure\",\"reason\":\"missing_or_invalid_intent\",\"detail\":\"...\",\"confidence\":0}.",
  "Omit unknown optional fields instead of inventing values.",
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
  "Return a single JSON object only. Do not wrap it in markdown, prose, or an array.",
  "Allowed top-level JSON kinds are exactly platform_status_query, ambiguous, unsupported, and parse_failure.",
  "For successful platform status, use {\"kind\":\"platform_status_query\",\"result\":{\"kind\":\"platform_status_success\",\"device\":{...},\"dataItems\":[...],\"switchState\":true,\"returnAirTemperature\":26,\"runStatusHint\":\"running\"},\"summary\":\"...\",\"confidence\":0.9}.",
  "For platform ambiguity inside a platform_status_query, use {\"kind\":\"platform_status_query\",\"result\":{\"kind\":\"ambiguous\",\"reason\":\"ambiguous_target\",\"candidates\":[],\"stage\":\"platform_search\"},\"summary\":\"...\",\"confidence\":0.6}.",
  "For platform unavailability inside a platform_status_query, use {\"kind\":\"platform_status_query\",\"result\":{\"kind\":\"unavailable\",\"reason\":\"device_not_found|device_offline|metadata_unrecognized|platform_auth_failed|platform_timeout|platform_error|platform_no_data\",\"candidates\":[],\"stage\":\"platform_search|platform_detail|platform_runtime_read|platform_auth\"},\"summary\":\"...\",\"confidence\":0.6}.",
  "Tool results may contain helper fields such as raw or message; do not copy those fields into the final JSON proposal.",
  "Omit unknown optional fields instead of inventing values.",
  "Do not include LangChain messages, tool calls, run ids, provider metadata, auth tokens, passwords, platform request URLs, or raw model payloads in the proposal."
].join("\n");

export function buildInterpreterUserPrompt(originalText: string, options: { platformMode?: boolean } = {}): string {
  if (options.platformMode) {
    return [
      "Interpret this user request as a single read-only real-platform device proposal.",
      "Use platform tools when needed and keep the proposal provider-neutral.",
      "Return only valid JSON.",
      "",
      `User request: ${originalText}`
    ].join("\n");
  }

  return [
    "Interpret this user request as a single simulated-device proposal.",
    "Keep the proposal provider-neutral and service-owned.",
    "Return only valid JSON.",
    "",
    `User request: ${originalText}`
  ].join("\n");
}
