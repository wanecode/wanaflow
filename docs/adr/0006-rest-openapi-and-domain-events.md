# ADR 0006: REST/OpenAPI and transactional domain events

Status: Accepted

Decision date: 2026-08-13

## Context

Developer-first infrastructure needs stable integration contracts, generated
clients, retriable commands, and event delivery. Wanaflow commands map naturally
to resources and explicit lifecycle actions.

## Decision

Expose a versioned REST API documented by OpenAPI. Generate the TypeScript SDK
from that contract and add ergonomic helpers without hiding HTTP semantics.

Persist domain events through a transactional outbox in the same transaction as
state changes. Deliver signed outbound webhooks asynchronously with durable
attempt history and replay.

Use:

- explicit idempotency keys for retriable commands;
- optimistic revision tokens for mutable drafts;
- action endpoints for meaningful lifecycle transitions; and
- stable machine-readable error codes.

Every retriable command contract defines whether a key is required, its scope,
canonical request hash, retention period, and stored response. The default scope
is organization plus route/command type plus key. Repeating the same hash
returns the stored result; reusing a key with a different hash returns a
conflict. Event IDs stay stable across webhook attempts.

## Consequences

- API compatibility is testable in CI.
- Studio and external clients share command behavior.
- Webhook delivery is eventually consistent and at least once.
- Consumers must deduplicate events using event ID.
- OpenAPI review becomes part of feature review.

## Alternatives considered

- GraphQL as the primary API: rejected for MVP because workflow commands,
  idempotency, generated clients, and HTTP operations fit REST/OpenAPI cleanly.
- Database event polling by integrations: rejected due coupling and tenant
  security risk.
- Publish events before committing state: rejected because consumers could
  observe events for rolled-back state.
