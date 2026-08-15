# Wanaflow initial threat model

Status: Pre-alpha baseline; browser identity, governance, and release authorization implemented

This document combines controls already implemented by the first authenticated
artifact slice with requirements for later public/runtime surfaces. A control is
not implemented unless this document says so explicitly.

## Assets and trust boundaries

Protected assets include tenant models, form submissions, process variables,
credentials, audit history, engine checkpoints, blob content, backups, and
webhook secrets. Untrusted inputs cross these boundaries:

- browser to Web/API;
- API key or external worker to public API;
- model, form, XML, JSON, archive, or attachment to parsers and renderers;
- Web/API and Runtime Worker to PostgreSQL and BlobStore;
- Runtime Worker to the engine adapter and expression evaluator; and
- webhook dispatcher to user-configured network destinations.

Organization is the top isolation boundary. Content-addressed objects, caches,
logs, metrics, traces, queues, and backups must not become cross-tenant side
channels.

## Minimum role baseline

| Role | Default authority |
| --- | --- |
| Organization owner | Organization settings, membership, workspace creation, key policy, and all lower roles |
| Workspace admin | Workspace membership, projects, environments, and scoped keys; no organization ownership transfer |
| Designer | Artifact drafts, comments, validation, review requests, and eligible-review publication in assigned projects |
| Reviewer | Read/comment on assigned review manifests and approve when separation-of-duty rules pass |
| Operator | Deploy approved Publications, inspect permitted runtime data, cancel instances, and retry supported incidents |
| Task worker | Read and act only on tasks assigned to or claimable by that principal |

Service keys use explicit scopes and resource constraints rather than silently
inheriting a human role. Every public command receives a deny-by-default
authorization test, a cross-tenant test, and an audit expectation. Resource
lookups that cross organization boundaries return not found.

Publication consumes only the database-derived eligible-review set. Designers
may publish but cannot deploy; operators may deploy immutable Publications but
cannot create them. Publication, Artifact Version, and Deployment mutation or
deletion is rejected by PostgreSQL triggers, and every successful release
command records both audit and outbox facts.

## Required controls and acceptance tests

### Sessions, credentials, and abuse

The current browser slice uses Better Auth with PostgreSQL-backed, HTTP-only,
same-site cookies; a single trusted application origin; closed public sign-up;
a 12-hour absolute lifetime; disabled refresh and cookie cache; and
authentication rate limiting. Production startup requires an explicit secret.
Every artifact API resolves the session to a Wanaflow organization membership
and deny-by-default role before resource access.

The first-owner operation is a local administrative command, not an HTTP
endpoint. Its temporary sign-up mode exists only inside that process, it
refuses replay after an authenticated membership exists, and production values
must be operator-supplied. The resulting owner credential is a normal permanent
credential, not a reusable bootstrap token.

External-worker bearer tokens are project-scoped, generated with cryptographic
randomness, stored only as SHA-256 digests, shown once, and revocable. Worker
routes never accept the browser cookie as worker authority; every lock is
filtered by the credential's organization and project, and each delivery
mutation also requires the current fencing token. Expiry and overlap rotation
remain production gates.

Current automated checks cover anonymous API denial, rejected cross-tenant
selection and resource access, role denial, session sign-in/sign-out, bootstrap
replay behavior, and desktop/mobile authenticated journeys.

The review slice additionally scopes review lookup by organization, workspace,
and assignment for reviewer principals. It rejects self-approval and revision-
author approval, serializes competing terminal decisions, verifies BPMN element
comment anchors against the pinned source, and makes revision/decision identity
immutable in PostgreSQL. Tests cover assignment bypass, open-comment approval,
terminal replay, competing decisions, and edits after review creation.

The release slice rejects unapproved publication, separates publication from
deployment authority, scopes environments and Publications through their
project and workspace, serializes version/deployment numbering, and verifies
database-level immutability. Tests cover idempotent concurrent publication,
designer deployment denial, repeat deployment history, audit/outbox emission,
and the browser approval-to-staging journey.

Before a production release, browser sessions additionally require explicit
deployment tests for secure cookies behind TLS, CSRF and disallowed origins,
revocation/expiry, fixation, brute force, and secret rotation.

- General API credentials and worker-credential expiry/overlap rotation remain
  to be implemented; all credentials must remain hashed at rest and revocable.
- Future authentication, start, correlation, task/job completion, webhook
  replay, and expensive parse endpoints have principal-, tenant-, and IP-aware
  rate limits.
- Invitations, account recovery, MFA, OIDC, and emergency owner recovery need
  explicit lifecycle designs before implementation.

### Models, forms, variables, and files

- XML parsers disable external entities, DTD processing, network access, and
  unbounded expansion. XML/JSON/forms enforce byte, depth, element, field, and
  expression-complexity limits.
- Executable publication is closed-world and the runtime installs a rejecting
  script handler. Browser rendering treats labels, comments, form content, and
  model metadata as untrusted to prevent stored XSS.
- Uploads enforce byte and decompression limits, reject traversal and archive
  bombs, verify detected type independently of filename/MIME claims, and are
  never served as active same-origin content.
- Blob keys are opaque and organization-scoped. Signed downloads are short
  lived and authorized before issuance. Local files use owner-only permissions.

Tests include XXE, entity expansion, deeply nested JSON, expression bombs,
stored-XSS payloads, misleading MIME types, path traversal, oversized uploads,
and compressed bombs.

### Runtime and external workers

- Resume commands, worker leases, timers, and checkpoint commits use the fenced
  protocol in ADR 0007. External-worker keys may be constrained by organization,
  workspace/project, environment, and job type.
- Job payload construction applies variable redaction before serialization.
  Completion and heartbeat require the current fencing token; stale or
  cross-tenant tokens fail without revealing job existence.
- Advancement enforces time, transition, event, and state-size budgets. Engine
  adapter and FEEL evaluator versions are allowlisted.

Tests cover expired locks, duplicate effects, stale completion, timer/job and
cancel/task races, malicious variable payloads, infinite automatic paths, and
missing/corrupt adapter state.

### Webhooks and outbound network access

- Endpoint creation and every delivery resolve and block loopback, link-local,
  private, metadata-service, multicast, and other reserved destinations after
  each DNS resolution. Redirects are disabled in the MVP.
- Delivery requires HTTPS except an explicit development-only localhost mode,
  validates certificates, and enforces connect/read timeouts plus request and
  response size limits.
- Signatures cover event ID, timestamp, and exact body using a versioned
  algorithm. Verification supports secret rotation; timestamps have a bounded
  replay window and event IDs are stable across attempts.

Tests cover DNS rebinding, alternative IP notation, private redirect, slow or
oversized responses, invalid TLS, replay, rotation overlap, and body tampering.

### Sensitive data, audit, and recovery

- One redaction policy applies before values enter API responses, jobs,
  webhooks, logs, traces, metrics, execution events, and support exports.
- Audit records are append-only through application permissions; retention and
  privileged-access events are explicit. Metrics prohibit tenant-controlled
  high-cardinality or secret-bearing labels.
- Encryption in transit is required outside an explicitly local deployment.
  Database, blob, secret-provider, and backup encryption/key ownership are
  documented per deployment profile.
- Backup/restore includes PostgreSQL, blobs, checksum and adapter manifests,
  secret-handling instructions, and a tested restore into an isolated target.

Tests seed canary secrets through every channel and fail if they appear outside
authorized storage or views. Restore tests verify tenant isolation, hashes,
waiting-instance compatibility, and credential revocation behavior.

## M0 exit for security design

ADR 0011 closes browser authentication/session selection and publishes the
current artifact permission matrix. The executable-model parser limits and the
project-scoped external-worker credential core are implemented. General API
credentials, worker expiry/rotation, and remaining surface-specific acceptance
tests stay open. A pre-0.1.0 review must verify all implemented controls and
document residual risks.
