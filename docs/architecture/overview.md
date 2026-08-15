# Wanaflow system architecture

Status: Draft for review

This document combines accepted foundation decisions with the implemented
runtime and collaboration design. ADRs 0004 and 0006 control the database and
API slice; ADRs 0003, 0005, and 0007 control the worker, collaboration, and
checkpoint behavior.

Controlling decisions:

- [ADR 0003](../adr/0003-runtime-worker-and-engine-port.md): Runtime Worker and
  engine boundary;
- [ADR 0004](../adr/0004-postgresql-and-blob-storage.md): PostgreSQL and blob
  storage;
- [ADR 0005](../adr/0005-progressive-collaboration.md): edit lease and review
  collaboration;
- [ADR 0006](../adr/0006-rest-openapi-and-domain-events.md): REST, OpenAPI, and
  events; and
- [ADR 0007](../adr/0007-runtime-checkpoint-and-fencing.md): atomic runtime
  checkpoints and fencing;
- [ADR 0008](../adr/0008-nextjs-and-shadcn-studio.md): Next.js and shadcn for
  Studio; and
- [ADR 0009](../adr/0009-progressive-disclosure-experience.md): premium,
  progressive-disclosure experience architecture; and
- [ADR 0016](../adr/0016-studio-led-business-workflows.md): Studio-led product
  hierarchy and business workflow priority.

## 1. System shape

The MVP is a modular TypeScript monorepo deployed as two application processes
plus PostgreSQL:

~~~text
Browser and API clients
          │
          ▼
┌──────────────────────────────┐
│ Wanaflow Web                 │
│ Next.js, Studio, REST API    │
└──────────────┬───────────────┘
               │ SQL + transactional outbox
               ▼
┌──────────────────────────────┐
│ PostgreSQL                   │
│ state, jobs, subscriptions,  │
│ events, audit, blob metadata │
└──────────────┬───────────────┘
               │ durable work claims
               ▼
┌──────────────────────────────┐
│ Wanaflow Runtime Worker      │
│ bpmn-engine adapter, timers, │
│ resume, webhooks             │
└──────────────┬───────────────┘
               │
        ┌──────┴──────┐
        ▼             ▼
 local filesystem   S3-compatible
 blob driver        blob driver
~~~

PostgreSQL is the system of record for domain state and blob reachability. A
configured BlobStore is authoritative for referenced binary bytes. Queue
notifications and caches may improve latency, but they must not become the only
durable representation of work.

## 2. Proposed repository layout

~~~text
apps/
  web/                 Next.js Studio and REST API
  worker/              Runtime, timer, outbox, and webhook workers
  cli/                 Wanaflow command-line client
packages/
  application/         Use cases and transaction orchestration
  api-contract/        OpenAPI source, schemas, generated API types
  auth/                Identity and authorization boundary
  db/                  Schema, migrations, repositories, transactions
  domain/              Commands, policies, entities, domain events
  modeling/            bpmn.io composition and Wanaflow extensions
  validation/          Server-side BPMN, DMN, form, and bundle validation
  engine/              ProcessEngine port and bpmn-engine adapter
  decision/            Bounded DMN evaluator and decision-evidence port
  forms/               Form schemas, validation, and submission mapping
  jobs/                Durable job and outbox ports
  storage/             BlobStore port and local/S3 drivers
  observability/       Logging, metrics, tracing, health
  sdk-typescript/      Generated client plus ergonomic helpers
  ui/                  Wanaflow design system, domain UI, and adapted shadcn source
tooling/
  eslint/
  typescript/
  test/
docs/
  product/
  architecture/
  adr/
~~~

Applications compose packages. Domain packages do not import application or UI
code.

The web application follows
[the experience principles](../product/experience-principles.md). Editor routes
are full workspaces rather than dashboard widgets. Properties, comments,
validation, history, and engine detail are contextual layers around the active
object. shadcn primitives supply behavior and accessible source, but Wanaflow's
information architecture and visual language remain product-owned.

## 3. Modeling subsystem

The modeling package composes maintained bpmn.io modules behind Wanaflow-owned
React client components:

- bpmn-js, bpmn-moddle, and diagram-js;
- dmn-js and dmn-moddle;
- form-js;
- properties panels;
- bpmnlint/dmnlint integrations;
- minimap and maintained color utilities;
- element templates and create/append tooling; and
- Wanaflow moddle descriptors and execution-profile rules.

Wanaflow consumes upstream packages directly and avoids a long-lived fork. A
compatibility fixture suite is the upgrade boundary. Versions are pinned in the
lockfile and upgraded intentionally as a tested group.

Modelers run only in client components. Next.js server rendering never imports
browser-only modeler code. Modeler routes use separate bundles so ordinary
dashboard pages do not pay the editor cost.

## 4. Command and query boundaries

Public commands enter through the REST API and call application services. Studio
uses those same services; it does not write database tables directly.

A state-changing command:

1. authenticates the principal;
2. authorizes against organization, workspace, project, and resource;
3. validates input and idempotency;
4. locks or checks the current aggregate revision;
5. writes domain state, audit record, and outbox events in one transaction; and
6. returns the committed representation.

Read models may be optimized independently but remain tenant-scoped.

### Publication and deployment flow

~~~text
approved review
  → lock and verify eligible pinned revision
  → snapshot approval and validation
  → create immutable Publication + numbered process and pinned form/DMN versions
  → choose a project Environment
  → resolve exact sources into a checksummed bundle
  → append immutable Deployment sequence + audit + outbox
~~~

Publication is independent of an environment. Deployment binds one Publication
to one Environment without changing the artifact draft head or any prior
Deployment. A review resolves every referenced form and DMN decision to an exact revision;
publication numbers the root process and those dependencies, and deployment preserves
that full checksummed bundle.
See [ADR 0013](../adr/0013-immutable-publication-and-environment-deployment.md)
and [ADR 0014](../adr/0014-form-artifacts-and-human-task-bindings.md).

## 5. Runtime flow

Starting a process:

~~~text
API start command
  → resolve immutable deployment
  → insert instance and start command
  → insert durable work record
  → commit
  → worker claims work
  → verify checkpoint N and fencing token
  → bpmn-engine adapter advances to quiescence
  → build checkpoint N+1 candidate
  → compare-and-swap checkpoint, projections, events, and new work
  → commit or discard stale candidate
~~~

The web process never owns a long-running engine instance. The worker may keep a
recovered engine in memory while advancing it, but PostgreSQL state is
authoritative at every externally visible wait. Public resume commands verify
an active wait at revision N, insert an accepted-command overlay, and set the
instance's pending-command pointer without changing checkpoint N. Variable and
wait projections advance only when the fenced N+1 checkpoint commits.

Intermediate message catches follow the same boundary. Checkpoint N contains a
normalized subscription keyed by organization, environment, message name, and
the committed application correlation value. A public correlation attempt is
durably idempotent even when it finds zero or multiple subscriptions. Exactly
one match creates a command overlay and competes on the instance row; it does
not consume the checkpoint-N subscription until checkpoint N+1 commits.

An instance has one monotonically increasing revision. Worker leases carry
monotonically increasing fencing tokens, and every checkpoint commit compares
both the loaded instance revision and token. This serializes concurrent resume
commands and prevents an expired worker from committing after its replacement.
The complete protocol is controlled by
[ADR 0007](../adr/0007-runtime-checkpoint-and-fencing.md).

## 6. Engine boundary

The domain depends on a Wanaflow interface rather than bpmn-engine internals:

~~~typescript
interface ProcessEngine {
  start(input: StartExecution): Promise<ExecutionResult>;
  resume(input: ResumeExecution): Promise<ExecutionResult>;
}
~~~

Cancellation and inspection will extend the port when their durable command
contracts ship; they are not placeholder methods in the first adapter.

The adapter translates engine events into Wanaflow domain events and wait-state
commands. It owns custom service-task, timer, and message behavior; Wanaflow
does not inherit their durability semantics from engine defaults. It also
installs a rejecting script handler so model-provided JavaScript cannot run.

The canonical EngineStateEnvelope schema, hashes, compatibility checks, and
quiescence rule are defined once in
[ADR 0007](../adr/0007-runtime-checkpoint-and-fencing.md). Normalized PostgreSQL
rows are authoritative. The envelope is a private continuation cursor and must
match the checkpoint revision and projection hash before recovery.

This is an isolation and upgrade boundary, not a promise that another engine can
be substituted without semantic migration.

## 7. Persistence

### PostgreSQL

PostgreSQL stores:

- identity and tenancy;
- artifact source, revisions, versions, and resolved bundles;
- reviews, comments, approvals, and audit records;
- deployments and environments;
- process instances and engine state envelopes;
- tasks, jobs, timers, incidents, variables, and execution events;
- idempotency records;
- outbox and durable work records; and
- blob metadata.

BPMN XML, DMN XML, and form JSON stay in PostgreSQL because they are small,
versioned, reviewed, and transactionally related to metadata.

### Blob storage

Blob storage holds attachments, generated images/PDFs, large imports, and large
deployment exports. The local driver is the default for a single-node install.
The S3-compatible driver is required when web or workers run on multiple hosts.

Blob keys are opaque and content-addressed where practical. User filenames are
metadata, never filesystem paths.

A blob is streamed to an organization-scoped pending key and checksummed before
a database transaction can reference it. A failed transaction leaves only an
unreferenced object, which age-based garbage collection may remove. Deletion
first removes reachability in PostgreSQL and later removes bytes. Backup and
restore cover both stores plus a checksum manifest; a database-only backup is
not advertised as complete when referenced blobs exist.

## 8. Durable jobs and events

The initial architecture uses a PostgreSQL-backed work queue and transactional
outbox to keep the reference installation small. A JobQueue port permits a
future Redis, NATS, or managed-queue driver.

Correctness rules:

- delivery is at least once;
- claims have leases and heartbeats;
- every claim carries a monotonically increasing fencing token;
- abandoned claims become available after expiry;
- handlers are idempotent;
- domain state and outbox events commit atomically;
- webhook delivery history is durable; and
- notifications may be lost without losing the underlying work.

Durable work rows are the queue. The transactional outbox holds public domain
event deliveries and creates any required delivery work with a uniqueness key;
it is not a second authoritative queue for instance continuation.

Outbound BPMN messages use a dedicated checkpoint-owned delivery ledger. The
intent commits with the source checkpoint, while leases, retries, and terminal
correlation outcomes remain an operational overlay. Dispatch calls the same
durable correlation service as `/api/v1/messages/correlate`; bpmn-engine's
process-local broker is never a delivery authority.

## 9. Collaboration

MVP collaboration has three independent channels:

- ephemeral presence;
- durable comments/reviews; and
- revision-aware diagram mutation.

The durable review channel is implemented as tenant-scoped review,
assignment, element-comment, and immutable-decision records. A review pins an
artifact revision rather than following the draft-head pointer. Element anchors
are validated against the pinned BPMN source. Approval eligibility is derived
from the terminal decision, server validation, and resolved discussion; it is
never copied onto the mutable artifact.

Presence is an eventually consistent, heartbeat-backed projection with editor,
selected-element, idle, and revision awareness. Comments and edits use ordinary
authenticated commands. Editors autosave after a quiet interval; optimistic
revision checks reject stale writes, while the UI exposes offline, reconnecting,
and conflict states.

Later command-level collaboration can introduce a collaboration service and
CRDT log without changing published artifact and review semantics.

## 10. Multi-tenancy

- Organization is the top isolation boundary.
- All tenant-owned rows carry organization ID directly or through a constrained
  parent relationship.
- Repository APIs require organization context.
- Cross-tenant identifiers return not found rather than leaking existence.
- Background jobs carry and validate tenant identity.
- Local single-organization installations use the same schema.
- PostgreSQL row-level security is a defense-in-depth option after repository
  scoping is proven and benchmarked.

## 11. Security boundaries

- Browser models and forms are untrusted input.
- XML parsing disables external entities and network retrieval.
- Parsing and uploads enforce configured byte, depth, element-count, archive,
  and decompression limits.
- Runtime expressions use the selected FEEL evaluator, not JavaScript eval.
- External work executes outside the Wanaflow worker.
- Connector egress requires explicit policy in future managed connectors.
- Secrets use opaque references and a SecretProvider port.
- Downloads use authorized API streaming or short-lived signed URLs.
- Every lifecycle and operator command writes an audit record.
- API keys are hashed at rest and shown only at creation.

The initial threat model and the M0 control gates are documented in
[the security threat model](../security/threat-model.md).

## 12. Observability

Every request and runtime continuation carries:

- request ID;
- trace ID;
- organization ID;
- deployment ID when applicable;
- process instance ID when applicable; and
- source BPMN element ID when applicable.

The reference implementation exposes:

- structured JSON logs;
- OpenTelemetry traces;
- Prometheus-compatible metrics;
- liveness and readiness endpoints;
- queue depth and oldest-work age;
- timer lag;
- job retry/dead-letter counts; and
- webhook success and latency.

## 13. Testing strategy

### Fast tests

- domain policies and authorization;
- expression and mapping behavior;
- validation rules;
- API schema compatibility; and
- normalized artifact diffing.

### Integration tests

- PostgreSQL repositories and transaction boundaries;
- tenant isolation;
- idempotent commands;
- outbox and lease recovery;
- blob drivers; and
- API behavior from generated client.

### Conformance fixtures

- BPMN import/export fidelity;
- supported element behavior;
- suspend/kill/recover/resume at every wait state;
- duplicate delivery;
- timer and message correlation races;
- concurrent triggers, expired-worker fencing, and post-commit/pre-ack crashes;
- engine version compatibility; and
- supported DMN hit policies, deterministic replay, and evidence recovery.

### End-to-end tests

- the complete MVP product journey;
- Studio editing and publication;
- immutable artifact-version creation and environment deployment;
- task form completion;
- external worker example; and
- clean Compose installation plus backup/restore.

### Experience tests

- role-based workflow comprehension with representative users;
- keyboard and assistive-technology coverage for each primary journey;
- responsive task, review, and operational flows;
- visual regression of the application frame and modeler integration; and
- explicit review for hierarchy, density, progressive disclosure, and generic
  admin/card-grid drift.

## 14. Dependency policy

- Use current stable releases at scaffold time, not floating latest ranges.
- Commit one lockfile for the monorepo.
- Group bpmn.io upgrades and run compatibility fixtures.
- Group Next.js, React, Tailwind, and shadcn upgrades and run visual/e2e tests.
- Record bpmn-engine state compatibility before upgrading instances in place.
- Generate an SBOM and run license/security checks in CI.
- Do not copy examples or assets into Wanaflow without recording their license.
