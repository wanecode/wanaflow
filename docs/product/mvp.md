# Wanaflow MVP specification

Status: Living product contract

Architecture details follow the ADR index. The sequential human-task,
external-job, and PostgreSQL-owned timer runtime slices are implemented;
boundary races, messages, gateways, and DMN execution remain conditional on
their named execution-profile gates.

## 1. Product definition

Wanaflow is a business process workspace with durable infrastructure beneath
its Studio. It combines:

- browser-based BPMN, DMN, and form authoring powered by bpmn.io;
- versioning, comments, review, approval, publication, and deployment;
- durable BPMN execution powered initially by bpmn-engine;
- human tasks and form rendering;
- APIs, webhooks, and external workers for application integration; and
- operational visibility into instances, tasks, jobs, variables, and incidents.

Wanaflow does not attempt to be a general no-code application builder. Business
teams can safely model, review, approve, and operate processes. Developers
connect those workflows to surrounding systems without becoming the default
audience for every screen.

The interface follows [Wanaflow's experience principles](experience-principles.md):
a premium, calm workspace with progressive disclosure, canvas-first modeling,
role-shaped entry points, and no generic admin-dashboard or card-grid default.

## 2. Audience

### Primary: process designers and subject-matter experts

Designers model BPMN and DMN, build forms, comment on elements, request reviews,
and approve publishable versions without needing source-control expertise.

### Primary: reviewers, operators, and task workers

Operators inspect running instances and resolve incidents. Task workers claim,
complete, or reassign human tasks through a focused inbox.

### Enabling audience: application and platform developers

Developers embed execution into products, implement external workers, react to
events, and automate delivery through the same durable contracts used by
Studio. Those capabilities remain important without setting the default
product hierarchy.

## 3. Product contract

The MVP is successful when one team can complete this end-to-end journey:

1. Create an organization, workspace, and project.
2. Create or import a BPMN process.
3. Create a form and attach it to a BPMN user task.
4. Save drafts and review validation feedback.
5. Comment on a specific BPMN element and request review.
6. Approve and publish immutable artifact versions.
7. Deploy a bundle to an environment.
8. Start a process through the REST API with an idempotency key.
9. Receive and complete a human task using the attached form.
10. Dispatch an external service job to a developer-owned worker.
11. Observe the execution timeline and final variables.
12. Diagnose and retry a failed job without editing historical data.

DMN import, authoring, validation, versioning, review, publication, and export
are part of the MVP through a separate acceptance journey. The first executable
profile is intentionally bounded to one decision table, UNIQUE/FIRST hit
policies, primitive JSON values, stable Business Rule Task bindings, and
deployment-pinned deterministic evaluation.

The DMN acceptance journey creates or imports a decision table, edits and
validates it, reviews an immutable revision, publishes it, evaluates the pinned
deployment version, and preserves the exact XML plus inputs, output, and rule IDs.

## 4. Information model

~~~text
Organization
└── Workspace
    └── Project
        ├── Artifact
        │   ├── Draft revision
        │   └── Immutable version
        ├── Review
        ├── Environment
        ├── Publication
        └── Deployment
            └── Process instance
                ├── Execution events
                ├── Variables
                ├── Human tasks
                ├── External jobs
                ├── Timers
                └── Incidents
~~~

### Artifact

An artifact has:

- a stable project-scoped key, such as employee-onboarding;
- a type: BPMN_PROCESS, DMN_DECISION, or FORM;
- a mutable draft head;
- immutable revisions for audit and conflict detection; and
- immutable published versions identified by a monotonically increasing
  version number.

The canonical payload is BPMN XML, DMN XML, or form-js JSON. The database may
store derived searchable metadata, but derived data never replaces the portable
source.

### References

Artifacts reference other artifacts by stable key, never by a mutable database
identifier. Publication resolves every reference to an immutable artifact
version. Deployment stores that fully resolved graph as a bundle.

Example:

~~~text
process: employee-onboarding
form: manager-approval
decision: equipment-eligibility
~~~

### Publication

A Publication is the immutable result of approving and validating one review
manifest. It records the exact artifact versions, manifest hash, validation
results, approvals, and publishing actor. It is not tied to an environment.

### Deployment

A deployment targets a named environment such as development, staging, or
production. It contains:

- the exact BPMN version;
- resolved form and DMN versions;
- a content hash;
- deployment metadata and actor; and
- compatibility and validation results.

Deployments are immutable. Re-deploying creates a new deployment.

## 5. Revision, review, publication, and deployment

~~~text
Editable draft ──save──> immutable revision ──request──> Review
                                                      ├── CHANGES_REQUESTED
                                                      └── APPROVED

Approved review ──publish──> immutable Publication
Publication ──deploy to environment──> immutable Deployment
~~~

Rules:

- Every save creates an immutable draft revision and advances the artifact's
  editable draft-head pointer.
- A review targets one root revision and a manifest resolving every referenced
  form or decision to an exact revision. New saves do not change that review.
- A change request closes the review without mutating its revisions; authors
  continue from a new draft revision and request a new review.
- Approval records actor, timestamp, exact manifest, and optional note.
- The default policy requires one approver other than any author represented in
  the reviewed manifest. A future policy may require more approvers but cannot
  weaken the recorded audit history.
- Publication requires the whole resolved manifest to satisfy the approval
  policy and creates immutable artifact versions plus one Publication record.
- A deployment can contain only published versions.
- A Deployment is a separate immutable record that binds one Publication to
  one environment. The same Publication can be deployed to multiple
  environments.

Governance approval is distinct from approval tasks inside a running BPMN
process.

## 6. MVP capabilities

### 6.1 Identity and tenancy

- Bootstrap the first local administrator.
- Organizations, workspaces, projects, and memberships.
- Roles: organization owner, workspace admin, designer, reviewer, operator, and
  task worker.
- Personal access tokens or service API keys with explicit scopes.
- Browser sessions for Studio.
- Every tenant-owned record carries organization identity.
- OIDC/SSO is outside the first vertical slice but the identity boundary must
  allow it without changing domain ownership.

### 6.2 Wanaflow Studio

- Next.js App Router application with current shadcn components installed as
  source through the shadcn CLI.
- A distinctive Wanaflow design system established before feature pages
  multiply; shadcn primitives do not determine the product's visual language.
- Project home and artifact library.
- BPMN editor, DMN editor, and form editor.
- Dedicated read-only viewers used in review and operations.
- Canvas-first editor routes with contextual, fully collapsible properties,
  comments, validation, and technical inspectors.
- Properties panels, minimap, keyboard navigation, undo/redo, import/export,
  and validation.
- Element templates for Wanaflow external jobs and human-task forms.
- Revision status, save state, validation summary, and deployment context
  visible in the editor shell.

### 6.3 Collaboration and governance

- Presence on an open artifact.
- Element-scoped and artifact-scoped comment threads.
- An in-app queue for review requests and outcomes.
- A renewable edit lease for diagram mutations.
- Concurrent comment and review activity without an edit lease.
- Optimistic revision checks on every save.
- Review request, approval, change request, publication, and deployment audit
  history.
- Source and element-ID change summary for the reviewed manifest.

True simultaneous command-level diagram editing is not in the MVP. It follows
after command semantics and undo behavior are proven under concurrency.

### 6.4 Validation and publication

- Browser validation for immediate feedback.
- Server-side validation as the authority for publication.
- BPMN and DMN schema parsing.
- Configurable bpmnlint and dmnlint rules.
- Wanaflow execution-profile rules.
- Reference resolution and cycle checks.
- Duplicate stable-key and duplicate-element-ID detection.
- Publication blocked by errors; warnings require acknowledgement.
- Deterministic bundle creation and SHA-256 content hash.

### 6.5 Runtime

Implemented now: immutable Deployment-ID start, organization-scoped
idempotency, PostgreSQL durable work, fenced checkpoint commits, bpmn-engine
state recovery, one-at-a-time managed waits, JSON completion output, variable
snapshots, execution events, typed incidents, human tasks, external jobs,
date/duration timers, a real Inbox, and the instance timeline. The remaining
bullets describe the full MVP target.

- Start by deployment ID, or by the organization-scoped tuple of workspace key,
  project key, environment key, and process artifact key.
- Idempotent start requests.
- Persistent process state across worker restarts.
- Human task lifecycle: created, assigned, claimed, completed, cancelled.
- External job lifecycle: available, locked, completed, failed, retried,
  dead-lettered.
- Durable timers.
- Message correlation using a message name and business correlation key.
- Instance cancellation.
- Execution event timeline.
- Typed incident creation and operator retry where the execution profile
  permits recovery.
- Variable snapshots with redaction support.

The exact executable BPMN subset is defined in
[the execution profile](execution-profile.md).

### 6.6 Developer platform

- Versioned REST API under /api/v1.
- OpenAPI document generated or validated in CI.
- Generated TypeScript SDK.
- Wanaflow CLI for authentication, validation, deployment, and instance start.
- Outbound webhooks signed with a per-endpoint secret.
- Webhook delivery attempts, exponential backoff, and replay.
- External job polling/locking API.
- Idempotency keys on externally retried commands.
- Stable machine-readable error codes and request correlation IDs.

Representative SDK experience:

~~~typescript
const wanaflow = new Wanaflow({
  baseUrl: process.env.WANAFLOW_URL,
  apiKey: process.env.WANAFLOW_API_KEY
});

const instance = await wanaflow.processes.start({
  workspaceKey: "people",
  projectKey: "onboarding",
  environmentKey: "production",
  processKey: "employee-onboarding"
}, {
  idempotencyKey: "employee:emp_123:onboarding",
  variables: {
    employeeId: "emp_123"
  }
});
~~~

### 6.7 Operations

- Filterable process-instance list.
- Instance detail with current state and append-only timeline.
- Active jobs, timers, tasks, and incidents.
- Variable inspection with secret/redacted fields hidden.
- Retry failed external jobs.
- Cancel an instance with an operator reason.
- Link every runtime event to deployment and source element ID.
- Health, readiness, metrics, structured logs, and trace correlation.

### 6.8 Self-hosting

- Documented Docker Compose installation.
- Required services for MVP: web, runtime worker, and PostgreSQL.
- Local filesystem blob driver by default.
- S3-compatible blob driver for replicated production deployments.
- Database migrations and an explicit backup/restore procedure.
- Configuration by environment variables with secret-file support.
- One organization created during first-run setup; the data model remains
  multi-tenant.

## 7. API resources

Minimum public resources:

~~~text
/organizations
/workspaces
/projects
/artifacts
/artifact-revisions
/comments
/reviews
/versions
/publications
/environments
/deployments
/process-instances
/tasks
/jobs
/incidents
/webhooks
/api-keys
~~~

Commands that change lifecycle state use explicit action endpoints when a plain
resource update would hide business intent, for example:

~~~text
POST /api/v1/artifacts/{artifactId}/request-review
POST /api/v1/reviews/{reviewId}/approve
POST /api/v1/reviews/{reviewId}/publish
POST /api/v1/environments/{environmentId}/deploy
POST /api/v1/process-instances/{instanceId}/cancel
POST /api/v1/jobs/{jobId}/retry
~~~

## 8. Quality attributes

### Reliability

- Acknowledged commands survive process restarts.
- Every wait state is persisted before work is acknowledged.
- Queue delivery is at least once; handlers and public commands are
  idempotent.
- Engine recovery is tested from serialized state fixtures.

### Portability

- Wanaflow retains the exact imported source as an immutable revision.
- Edited BPMN/DMN round-trips all standard content and extension namespaces in
  the supported-descriptor matrix. Unsupported namespaces produce an explicit
  compatibility warning before editing; their original imported source remains
  exportable even when the modeler cannot safely reserialize them.
- Users can export canonical source and deployment bundles.
- Wanaflow extensions use a documented Wanaflow namespace.

### Security

- No arbitrary JavaScript from a model runs in the web or worker process.
- Connector code runs outside the engine as external jobs.
- Secrets are referenced, not embedded in BPMN, DMN, forms, or instance
  variables.
- Authorization is checked at command and query boundaries.
- Webhook signatures are timestamped and replay-resistant.
- Form submissions are server-validated before task completion.

### Performance targets

These are engineering targets, not public service-level commitments:

- Studio project and artifact pages: p95 server response under 500 ms at the
  reference dataset size.
- Start command acknowledgement: p95 under 750 ms excluding cold start.
- Human task completion acknowledgement: p95 under 750 ms.
- External job availability after commit: p95 under 2 seconds.
- Reference environment: 100 concurrent active editors and 10,000 waiting
  process instances per installation.

Before performance results are published, the repository must contain the
reproducible load scenario, seeded reference dataset, host specification,
PostgreSQL configuration, warm-up period, and measurement window. The 0.1.0
release gate uses a single-host Linux installation with web, worker, and
PostgreSQL running through the documented Compose file; exact supported Docker
and host versions belong in the release support matrix.

### Experience quality

- Every view has one dominant purpose and at most one primary action.
- Default views show the current work and its status, not every available
  metric, object, and command.
- Advanced capabilities remain fast through contextual inspectors, keyboard
  navigation, command search, stable URLs, and deep links.
- Lists and tables handle queues and comparable records; cards are reserved for
  genuinely discrete, glanceable objects.
- Empty, loading, validation, conflict, read-only, reconnecting, failure, and
  success states are part of workflow acceptance.
- Accessibility, responsive behavior, motion preferences, and visual-regression
  coverage are designed with the workflow rather than added after it.

## 9. Explicit non-goals for MVP

- Full BPMN 2.0 execution coverage.
- CMMN.
- Arbitrary in-process scripts.
- Process-instance migration between deployments.
- Multi-region active-active runtime.
- Full Git synchronization.
- A connector marketplace.
- Exhaustive BPMN token animation, scenario suites, and diagram image export.
- A general page or application builder.
- Advanced process mining and business intelligence.
- Mobile-native applications.
- Unconstrained simultaneous diagram editing.

## 10. Delivery milestones

### M0: foundation

- Repository, CI, formatting, tests, local development environment.
- Domain model, database migrations, authentication, organization hierarchy.
- Threat model, role/permission matrix, parser limits, credential lifecycle,
  OpenAPI contract, and architecture fitness tests.
- Information architecture, end-to-end low-fidelity flows, visual direction,
  design tokens, application frame, and experience acceptance tests.

### M1: modeling registry

- BPMN, DMN, and form editors.
- Immutable draft revisions, import/export, and validation.
- Project artifact linking.

### M2: governance

- Comments, edit lease, reviews, approvals, publication, and audit log.

### M3: execution

- Deployment bundles, bpmn-engine adapter, worker recovery, timers, Task Inbox,
  human tasks, external jobs, incidents, and a minimal external-worker
  conformance fixture.

### M4: developer integration

- TypeScript SDK, CLI, webhooks, external worker example, and API documentation.

### M5: operational release

- Operations UI, backup/restore, security review, execution conformance suite,
  upgrade testing, and release documentation.

## 11. MVP exit criteria

The MVP may be tagged 0.1.0 when:

- the product-contract journey in section 3 passes end to end;
- the DMN authoring and publication acceptance journey in section 3 passes end
  to end without implying runtime evaluation;
- a designer, independent reviewer, and operator can validate, approve,
  publish, and deploy the reference process in Studio without using the API;
- a task worker can understand and complete the reference task without BPMN
  knowledge;
- representative designers, reviewers, task workers, and operators can identify
  the next action in their reference workflow without learning Wanaflow's
  internal architecture;
- visual review finds no generic admin-dashboard, indiscriminate card-grid, or
  permanently exposed advanced-control drift;
- all supported BPMN fixtures pass fresh start, suspend, recover, and resume;
- server-side publication rejects unsupported executable constructs;
- import/export fixtures show no unexpected semantic loss;
- API and webhook commands pass idempotency tests;
- authorization tests cover every public command and tenant boundary;
- backup and restore reproduce definitions and waiting instances;
- a fresh Linux VM matching the release support matrix can run the documented
  Compose installation and the product-contract journey; and
- the unresolved decision gates below are closed.

## 12. Decision gates

Before implementation reaches the named milestone, decide:

1. Accept, revise, or reject Proposed ADRs 0003, 0005, and 0007 before
   scaffolding depends on their runtime or collaboration semantics. Persistence
   and API decisions closed in ADRs 0004 and 0006.
2. Browser authentication, password/session policy, and workspace invitations
   are closed by ADR 0011 and the pilot implementation. OIDC, recovery, MFA,
   and scoped non-browser credentials remain gates before their corresponding
   surfaces are implemented.
3. Wanaflow extension namespace URI before M1 persists extension metadata.
4. PostgreSQL job implementation and FEEL expression evaluator before M3.
5. Wider DMN constructs and hit policies require new named conformance profiles.
6. Compatibility policy for bpmn.io and bpmn-engine upgrades before 0.1.0.
