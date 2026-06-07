## Residual Review Findings

- P2 `src/routes/tasks.ts:29` HTTP task creation exposes unbounded in-memory state growth - filed as https://github.com/rookielzy/device-agent/issues/5

## Source Review Context

- Plan: `docs/plans/2026-06-07-006-feat-fastify-task-api-plan.md`
- Branch: `feat/fastify-task-api`
- Commit reviewed: `77d9c01`
- Reviewer: reliability

## Finding Detail

Every valid `POST /tasks` persists a `TaskResult` in an in-memory repository, and pending-control records are retained after terminal states. Repeated traffic can grow heap usage without a cap, TTL cleanup, eviction, or backpressure.

Suggested follow-up: add retention limits or TTL cleanup for task and pending-control repositories on the API path, compact terminal pending-control records where appropriate, and return a controlled failure when capacity is reached.
