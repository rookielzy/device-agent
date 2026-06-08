## Residual Review Findings

Source: `compound-engineering:ce-code-review mode:agent plan:docs/plans/2026-06-07-006-feat-fastify-task-api-plan.md`

- P2 `src/app.ts:50` Runtime Fastify app has no request or handler timeout. Filed: https://github.com/rookielzy/device-agent/issues/9
- P2 `src/contracts/api-contract.ts:3` Task creation creates unbounded in-memory records. Filed: https://github.com/rookielzy/device-agent/issues/8

Applied in this branch before deferral:

- Mapped internal response validation to `response_validation_failed` instead of client `bad_request`.
- Rejected non-empty confirmation and rejection route bodies.
- Added text/body size limits at the HTTP boundary.
- Gated the debug simulated-device route for non-local runtime bindings.
- Added unsupported-outcome, service-error, debug-response-error, and stronger acceptance tests.
- Stabilized `ApiError.details`, removed raw URL/task id echoing, and added `Allow` headers for normalized 405 responses.
