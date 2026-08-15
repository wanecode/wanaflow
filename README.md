# Wanaflow

**Model. Decide. Run.**

[![CI](https://github.com/wanecode/wanaflow/actions/workflows/ci.yml/badge.svg)](https://github.com/wanecode/wanaflow/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-315c4d.svg)](LICENSE)

Wanaflow is an open-source business process workspace for collaboratively
designing, reviewing, approving, and running BPMN processes, DMN decisions,
and forms.

Wanaflow Studio is the product's primary experience: calm and approachable for
business teams, while a durable API and runtime keep it trustworthy,
self-hostable, and ready for integration.

## Status

Wanaflow is pre-alpha. The runnable slice includes closed-registration sign-in,
PostgreSQL-backed sessions, invitation-based onboarding, workspace people and
work-group management, tenant memberships and role authorization, a process
library with BPMN and DMN create/import, live BPMN/DMN Studios, immutable draft revisions,
server-side BPMN validation, autosave with revision-aware editor presence and
reconnect states, an authenticated REST API, durable revision-pinned review
with assignments, anchored comments and mentions, visual change summaries,
independent decisions, publication eligibility, and audit history. A
Design–Review–Run home prioritizes real work, an Updates center gathers
mentions, decisions, handoffs, and incidents, starter stories make first setup
approachable, and saved BPMN drafts can be walked through safely without
creating runtime records. The Task Inbox adds due dates, priorities, durable
handoffs, named team queues, claiming, and assignment history. Operations adds
an incident recovery desk with owners, notes, retry, and history. Approved reviews can
create immutable Publications, monotonically numbered artifact versions, and
resolved Deployment bundles in named project environments. A separate worker
durably executes the first closed profile—start/end events plus sequential
user tasks, external service jobs, intermediate timer catches, and durable
message catches/throws—with checkpoint recovery, fencing,
completion, variables, events, typed incidents, retry cycles, and terminal
cancellation. The bounded DMN slice supports one decision table per artifact,
UNIQUE/FIRST hit policies, primitive JSON values, stable Business Rule Task
bindings, deployment-pinned evaluation, and durable decision evidence.

It also includes portable form-js artifacts, a focused form Studio, stable-key
user-task bindings, review-pinned form versions, server-validated submissions,
curated field kits, a work-context preview, and form rendering in Inbox.
Projects can be exported and imported as integrity-checked portable packages.
Service tasks now carry a Wanaflow worker template,
PostgreSQL owns durable delivery/leases, project worker credentials are
one-time-reveal and revocable, and `@wanaflow/job-worker` provides a typed
heartbeat-aware client. PostgreSQL-owned date/duration timers now survive worker
restarts without an in-process clock and appear as calm pauses in Studio and
Operations. Message throws commit a transactional delivery record and dispatch
through the same idempotent correlation contract as the public API. A supported
single-host Docker Compose release includes automatic HTTPS, generated secrets,
health checks, migrations, a separate worker, a deployment smoke test, and
backup/restore helpers. It does not yet include OIDC,
password recovery, MFA, general-purpose scoped API keys, an attachment/blob
driver implementation, or full production hardening.

## Product principles

- Studio-led: business workflows and their next useful decision shape the
  product; infrastructure supports them without dominating the interface.
- Open-contract: every durable Studio operation is available through the same
  authenticated application contract used by integrations.
- Experience-first: each view prioritizes the current work and next decision;
  complexity is progressively disclosed instead of presented as an admin
  dashboard.
- Standards-first: BPMN and DMN stay portable XML; forms stay portable form-js
  JSON.
- Immutable deployment: running instances always reference a resolved,
  immutable deployment bundle.
- Safe execution: process definitions cannot execute arbitrary in-process
  JavaScript.
- Self-hostable: the supported single-host installation uses Docker Compose,
  PostgreSQL as its source of truth, and a filesystem volume reserved for blobs.
- Extensible: engine, queue, blob storage, identity, connector, and decision
  evaluation boundaries are explicit.
- Observable: execution history, domain events, logs, metrics, and traces are
  product features.

## Documentation

- [MVP specification](docs/product/mvp.md)
- [Experience principles](docs/product/experience-principles.md)
- [BPMN execution profile](docs/product/execution-profile.md)
- [System architecture](docs/architecture/overview.md)
- [Pinned frontend compatibility set](docs/architecture/frontend-compatibility.md)
- [Implemented REST/OpenAPI contract](docs/api/openapi.yaml)
- [Initial threat model](docs/security/threat-model.md)
- [Architecture decision records](docs/adr/README.md)
- [Glossary](docs/glossary.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Code of conduct](CODE_OF_CONDUCT.md)
- [Self-hosting](docs/self-hosting.md)

## Planned product surfaces

- Wider runtime profiles for boundary timers, gateways, and concurrent message races
- Wider integration coverage after the core Studio journeys are mature

## Run an external worker

Create a project worker credential through `POST /api/v1/worker-credentials`,
store the returned token immediately, then subscribe with the typed client:

~~~typescript
import { WanaflowWorkerClient } from "@wanaflow/job-worker";

const client = new WanaflowWorkerClient({
  baseUrl: "http://localhost:3000",
  token: process.env.WANAFLOW_JOB_TOKEN!,
});

await client.work({
  workerId: "billing-1",
  jobTypes: ["invoice.send"],
  handler: async ({ job }) => {
    const receipt = await sendInvoice(job.input.invoiceId);
    return { receipt };
  },
});
~~~

Handlers must be idempotent. Use `job.effectKey` as the stable external-effect
key; attempt and lease delivery remain at-least-once.

Evaluate a decision only through an immutable Deployment:

~~~typescript
import { WanaflowClient } from "@wanaflow/sdk";

const wanaflow = new WanaflowClient({
  baseUrl: "http://localhost:3000",
});

const evidence = await wanaflow.evaluateDecision({
  deploymentId: "…",
  decisionKey: "invoice-route",
  input: { amount: 1200, risk: "low" },
  idempotencyKey: "invoice-42-route",
});
~~~

The returned record includes the exact DMN artifact version, matched rule IDs,
inputs, and output. Wanaflow never evaluates the mutable draft behind the key.
The current client uses the signed-in browser session (or an explicitly supplied
session cookie); general-purpose scoped API tokens remain a later security gate.

## Run the current slice

Requirements: Node.js 22 or newer, Corepack/pnpm, and Docker with Compose.

~~~shell
corepack enable
pnpm install
pnpm dev:setup
pnpm dev
~~~

Open `http://localhost:3000` and sign in. The development bootstrap defaults to
`local@wanaflow.dev` / `Wanaflow-local-2026!`; never use those defaults outside
local development. For a deployment, set the values documented in
[`.env.example`](.env.example), including a random `BETTER_AUTH_SECRET` and a
unique owner and reviewer passwords, before running `pnpm dev:setup`.

Local development also creates `reviewer@wanaflow.dev` /
`Wanaflow-reviewer-2026!` so the separation-of-duty journey can be exercised.

Useful routes are `/library`, `/create`, `/reviews`, `/inbox`, `/operations`,
`/people`, and `/updates`. Add `DEEPSEEK_API_KEY` to enable live runs in the
optional Create with Wana experience studio.

## Run a public demo

On a Linux server with Docker Compose and a hostname pointed at it:

~~~shell
tooling/selfhost/deploy.sh \
  --site process.example.com \
  --owner owner@example.com \
  --name "Awa Wane"
~~~

This generates protected secrets, starts PostgreSQL, Wanaflow web and worker,
obtains HTTPS through Caddy, creates owner and reviewer demo identities, and
checks the authenticated product through the public URL. PostgreSQL is never
published. See [Self-hosting](docs/self-hosting.md) for DNS, firewall, backups,
local rehearsal, upgrades, and the pre-alpha demo security boundary.

Verification:

~~~shell
pnpm typecheck
pnpm lint
pnpm build
pnpm test:integration
~~~

`pnpm test:integration` starts an isolated PostgreSQL container, applies
migrations, runs modeling/database/runtime tests, starts a separate Runtime
Worker, builds the production app, exercises start → user task → completion plus
the desktop/mobile journeys, then removes the test database.

## Open decisions

OIDC remains a decision gate. The separate runtime worker, fenced checkpoint core, and
PostgreSQL external-job delivery ledger are accepted in ADRs 0003 and 0007.
Browser authentication and tenant authorization are accepted in ADR 0011.
Revision-pinned approval semantics are accepted in ADR 0012.
Immutable publication and deployment semantics are accepted in ADR 0013.
The bounded decision-table and Business Rule Task profile is accepted in ADR 0015.
The Studio-led product priority is accepted in ADR 0016.

## License

Licensed under the [Apache License 2.0](LICENSE).
