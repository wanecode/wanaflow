# Architecture decision records

Architecture decision records describe decisions that are costly to rediscover
or reverse. Accepted records reflect choices already made for Wanaflow.
Proposed records are the recommended starting point and require review before
implementation relies on them.

| ADR | Status | Decision |
| --- | --- | --- |
| [0001](0001-developer-first-api-first.md) | Superseded | Developer-first and API-first product |
| [0002](0002-bpmn-io-modeling-kernel.md) | Accepted | bpmn.io as the modeling kernel |
| [0003](0003-runtime-worker-and-engine-port.md) | Proposed | Separate runtime worker and engine port |
| [0004](0004-postgresql-and-blob-storage.md) | Accepted | PostgreSQL source of truth and pluggable blobs |
| [0005](0005-progressive-collaboration.md) | Accepted | Progressive collaboration model |
| [0006](0006-rest-openapi-and-domain-events.md) | Accepted | REST/OpenAPI and transactional events |
| [0007](0007-runtime-checkpoint-and-fencing.md) | Proposed | Atomic runtime checkpoints and fenced continuation |
| [0008](0008-nextjs-and-shadcn-studio.md) | Accepted | Next.js and shadcn for Wanaflow Studio |
| [0009](0009-progressive-disclosure-experience.md) | Accepted | Premium progressive-disclosure product experience |
| [0010](0010-apache-2-license.md) | Accepted | Apache License 2.0 for Wanaflow |
| [0011](0011-authentication-and-tenant-authorization.md) | Accepted | Better Auth sessions and Wanaflow tenant authorization |
| [0012](0012-revision-pinned-review-and-approval.md) | Accepted | Revision-pinned review, comments, and independent approval |
| [0013](0013-immutable-publication-and-environment-deployment.md) | Accepted | Immutable publication, artifact versions, and environment deployments |
| [0014](0014-form-artifacts-and-human-task-bindings.md) | Accepted | Portable form artifacts and immutable human-task bindings |
| [0015](0015-bounded-dmn-decision-table-execution.md) | Accepted | Bounded DMN decision tables and Business Rule Task execution |
| [0016](0016-studio-led-business-workflows.md) | Accepted | Studio-led, business-workflow-first product priority |

## Status meanings

- Proposed: recommended but not yet adopted by implementation.
- Accepted: the project intends to implement and maintain this decision.
- Superseded: replaced by a newer ADR.
- Rejected: considered and intentionally not selected.

The acceptance and supersession workflow is defined in
[CONTRIBUTING.md](../../CONTRIBUTING.md). A status change records a decision
date in the ADR; implementation does not depend on a Proposed record.
