# ADR 0016: Studio-led, business-workflow-first product priority

Status: Accepted

Decision date: 2026-08-14

Supersedes: ADR 0001

## Context

Wanaflow needs durable runtime and integration contracts, but treating
developers as the primary audience makes infrastructure shape the product
hierarchy. The intended value is a shared place where business teams design,
review, approve, and run work without learning engine or deployment internals.

## Decision

Wanaflow is Studio-led and business-workflow-first. Its primary journeys are:

1. design a process, decision, or form;
2. collaborate and understand what changed;
3. review and approve an immutable revision;
4. safely preview behavior;
5. publish and place an approved release; and
6. complete and coordinate human work.

The home experience follows Design–Review–Run and prioritizes real pending
work. Progressive disclosure keeps infrastructure details available in context
without making them the default navigation or visual hierarchy.

Every durable operation still passes through authenticated, authorized,
validated, and auditable application services. Public contracts and external
workers remain important enabling capabilities, but they do not take product
priority over Studio workflows.

## Consequences

- Product planning starts with complete human journeys rather than endpoint or
  SDK surface area.
- Templates use familiar business stories and lead into the real modelers.
- Review, handoff, due state, and readiness language precede hashes, IDs, and
  engine metadata in the interface.
- APIs remain durable and documented, but broader SDK and CLI work follows the
  maturity of the workflows it automates.
- Premium interaction quality, responsive states, accessibility, and
  progressive disclosure are acceptance criteria from the beginning.

## Alternatives considered

- Developer-first infrastructure with a business-friendly client: superseded
  because it makes the supporting layer the product priority.
- Hide infrastructure entirely: rejected because trustworthy deployment,
  auditability, integrations, and self-hosting still require explicit durable
  contracts.
