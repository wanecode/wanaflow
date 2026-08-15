# Wanaflow BPMN execution profile

Status: Active, delivered in stages

## Purpose

bpmn.io can model more BPMN 2.0 constructs than the first Wanaflow Runtime can
safely and durably execute. This document makes the executable subset explicit.
Studio may open and preserve unsupported constructs, but publication as an
executable process fails when a model contains unsupported runtime semantics.

Support states:

- EXECUTED: has runtime token semantics and is covered by recovery fixtures.
- ALLOWED: may appear in an executable model but is treated only as descriptive
  metadata by the runtime.
- BLOCKED: preserved and viewable, but blocks publication as executable because
  silently ignoring it could change process meaning.
- DEFERRED: blocked in the MVP and planned for a later execution profile.

The table is a closed allowlist, not a sample. Publication recursively rejects
every executable element, event definition, expression language, and extension
that is not explicitly EXECUTED or ALLOWED. A deployed BPMN document contains
exactly one executable process; the adapter never relies on an engine default
that starts every executable process in a definition.

## Currently executable profile

`wanaflow-linear-v1` is the first shipped runtime profile. Its closed
allowlist is exactly:

- one executable process;
- one none start event;
- one none end event;
- BPMN user tasks;
- Wanaflow-bound service tasks;
- Wanaflow-bound business rule tasks backed by deployment-pinned DMN decision tables;
- intermediate timer catches with one ISO-8601 date or duration;
- intermediate message catches with one named BPMN message and a correlation-key variable; and
- intermediate message throws with one named BPMN message, a correlation-key variable, and an explicit payload mapping; and
- sequence flows.

Those elements form one connected, acyclic, unbranched path. It supports one
live managed wait at a time. PostgreSQL is the only timer clock; the adapter
maps timer definitions to external signals and never creates process-local
timeouts. Start is accepted only by
immutable Deployment ID. Anything else—including gateways, scripts,
subprocesses, boundary events, terminate events, and other executable
extensions—fails the runtime-start gate with a typed profile error before
`bpmn-engine` is constructed. Studio and the release registry may preserve and
deploy broader models for forward compatibility, but that does not imply they
are executable by this profile.

The matrix below is the broader MVP target. An `EXECUTED` row becomes available
only in a named runtime profile after its adapter behavior and recovery fixtures
ship; it is not a claim that `wanaflow-linear-v1` already enables it.

## Supported elements

| BPMN construct | MVP target | Notes |
| --- | --- | --- |
| Executable process | EXECUTED | One executable process per initial deployment entry point |
| None start event | EXECUTED | Started through API or SDK |
| Message start event | DEFERRED | Requires subscription lifecycle semantics |
| Timer start event | DEFERRED | Requires deployment-owned schedules |
| None end event | EXECUTED | Normal completion |
| Terminate end event | EXECUTED | Terminates the current process scope |
| Error end event | DEFERRED | Added with event subprocess coverage |
| User task | EXECUTED | Creates a Wanaflow human task |
| Service task | EXECUTED | Must use a Wanaflow external-job template |
| Send task | BLOCKED | Use an external job in MVP |
| Receive task | DEFERRED | Message catch event is the initial wait primitive |
| Script task | BLOCKED | Arbitrary in-process scripts are prohibited |
| Business rule task | EXECUTED | Stable decision key; explicit input/output maps; pinned DMN version |
| Manual task | BLOCKED | Ignoring it would change the modeled behavior |
| Exclusive gateway | DEFERRED | Requires all-candidate FEEL selection fixtures |
| Parallel gateway | DEFERRED | Requires quiescence and concurrent-wait fixtures |
| Inclusive gateway | DEFERRED | Join semantics require additional conformance work |
| Event-based gateway | DEFERRED | Requires cancellation-safe competing subscriptions |
| Intermediate timer catch | EXECUTED | ISO-8601 date and duration in MVP |
| Boundary timer | DEFERRED | Requires cancellation-safe race groups |
| Intermediate message catch | EXECUTED | Message name plus correlation key |
| Intermediate message throw | EXECUTED | Publishes a Wanaflow message command after commit |
| Signal events | DEFERRED | Broadcast scope and tenancy rules not yet fixed |
| Link events | BLOCKED | Link catch/throw changes token routing |
| Escalation events | DEFERRED | |
| Compensation | DEFERRED | |
| Embedded subprocess | DEFERRED | First runtime executes a single process scope |
| Call activity | DEFERRED | Requires child deployment and version semantics |
| Event subprocess | DEFERRED | |
| Multi-instance activity | DEFERRED | |
| Transaction subprocess | DEFERRED | |
| Pools and participants | ALLOWED | Non-entry participants are descriptive only |
| Lanes | ALLOWED | Metadata only; may inform candidate groups |
| Data objects and stores | ALLOWED | Portable documentation only |
| Text annotations and groups | ALLOWED | No runtime effect |

## Conditions and expressions

- `wanaflow-linear-v1` does not execute conditional sequence flows or
  expression-based assignment/due dates. Those remain blocked until one FEEL
  evaluator and its coercion/error fixtures ship with a named wider profile.
- Model-provided JavaScript, eval, Function construction, and dynamic module
  loading are prohibited.
- A future exclusive-gateway profile must evaluate every candidate against one
  immutable input, incident on zero or multiple matches, and prove it does not
  inherit the engine's first-true-flow short circuit.
- Runtime construction installs a rejecting script handler in addition to
  publication validation; engine defaults never evaluate model JavaScript.

## Decisions

The current profile deliberately implements a small DMN decision-table contract,
not the whole DMN specification. Each decision artifact contains exactly one
named decision and one table. The table may use `UNIQUE` or `FIRST`, with
string, boolean, and number inputs/outputs. Time-dependent FEEL functions are
blocked so re-evaluation against the same input and pinned XML is deterministic.

A Business Rule Task binds a stable decision artifact key plus explicit
top-level maps. Review resolves that key in the same project and pins the exact
DMN revision into the Publication and Deployment. Runtime never reads a draft.
Every committed evaluation records the artifact version, decision identity,
hit policy, input, output, and matched rule IDs. A crash replay is fenced by the
instance checkpoint and a deterministic evidence identity, so it cannot commit
a second evaluation. DRDs, boxed/literal expressions, decision services,
collect/rule-order policies, temporal functions, and general FEEL contexts are
deferred to later named profiles.

## Human tasks

The current slice can initially assign a created task to the principal who
started the instance, a workspace member selected by stable email, or a
workspace team queue selected by stable group key. Team-queue members see the
work and one atomic claim makes a person its owner. A task may use a deployed
form-js snapshot with server-side schema validation and explicit top-level
input/output mappings; an unbound task accepts the generic JSON completion
object. Live owners can hand work over and set a due date or priority without
mutating the immutable engine checkpoint.

A user task currently may define:

- a stable form key;
- an initial person or candidate-group key (with starter as the default);
- a top-level input mapping from form fields to process variables; and
- a top-level completion-output mapping from process variables to form fields.

Assignee expressions and due-date expressions are reserved for later named
profiles.

Task completion:

1. validates authorization and task state;
2. validates submitted data against the resolved form schema;
3. atomically competes for the active wait and persists the immutable
   submission plus a `TRIGGER_ACCEPTED` command overlay without mutating the
   current checkpoint; and
4. applies output mappings, closes the task, and advances variables only when
   the next fenced runtime checkpoint commits.

Repeating the same request with the same organization-scoped idempotency key and
request hash returns the stored result. Reusing the key with a different hash,
or attempting a different trigger after one was accepted, returns a conflict.

## External service jobs

Executable service tasks use a Wanaflow element template with:

- job type;
- input mapping;
- output mapping;
- lock duration;
- retry policy; and
- optional headers containing non-secret configuration.

Workers lock jobs through the public API. Delivery is at least once. Worker
implementations must be idempotent. Wanaflow exposes a stable effect key that
does not change across retries, plus the job ID and attempt number for
diagnostics.

Each lock acquisition or renewal returns an opaque fencing token. Completion,
failure, and heartbeat commands must present the current token; an expired or
superseded token receives a conflict. Retry exhaustion creates an incident. An
operator retry creates a new attempt with the same effect key. Cancellation or
an interrupting boundary timer atomically competes with job completion; a late
completion cannot change the process, although Wanaflow cannot undo an external
side effect already performed.

Lock, heartbeat, non-terminal failure, attempt, and retry-schedule state lives
in an operational delivery ledger excluded from the checkpoint projection
hash. These changes leave the checkpoint's job wait untouched. Only a terminal
trigger competes for that wait and advances it through the next checkpoint.

Secrets are resolved by the external worker or a future connector service. They
are never placed in BPMN XML or public job payload headers.

## Timers

The current linear profile supports intermediate timer catches with:

- an absolute ISO-8601 timestamp; and
- an ISO-8601 duration relative to timer creation.

Durations use day/time units and are bounded at ten years in the current
profile; calendar-month and calendar-year durations are not accepted.

Repeating cycles, cron syntax, timer start events, and timezone calendars are
deferred. Absolute values require `Z` or an explicit UTC offset. Persisted
timestamps are UTC, the PostgreSQL timer row is the only firing authority, and
the adapter disables process-local engine timers. An overdue timer becomes
eligible immediately. User-facing timezone conversion is a Studio concern.

At checkpoint N, the normalized timer row and its resolved UTC `dueAt` are part
of the projection hash. The runtime worker scans due rows with PostgreSQL time
and row locking. Acceptance inserts one `TIMER_FIRE` command and sets the
instance's pending-command pointer without mutating the checkpoint-N timer.
Checkpoint N+1 marks it fired. Cancellation and firing serialize on the same
instance row; a cancellation winner leaves the checkpoint timer physically
unchanged and public reads present it as cancelled.

Interrupting boundary timers remain blocked by the current runtime-start gate.
They become executable only with attached-activity race-group persistence and
its recovery fixtures; the broader MVP matrix above records that target.

## Messages

The current linear profile supports intermediate message catches. A catch uses
the standard BPMN `messageRef` and a Wanaflow `correlationKey` attribute naming
the top-level process variable whose committed scalar value becomes the
subscription key. The message name is a stable lowercase contract name such as
`expense.approved`; correlation values are non-empty strings or finite numbers.

Message correlation uses:

- organization;
- environment ID, resolved through workspace and project scope;
- message name; and
- an application-provided correlation key.

A command may correlate one waiting subscription. Ambiguous correlation fails
without consuming any subscription. A message arriving before its subscription
commits is not buffered and returns no match. Delivery commands require
idempotency keys and atomically compete with cancellation or another trigger.

Every attempt—including no match and ambiguous match—is recorded by
organization-scoped idempotency key, so a retry returns the original outcome
even if subscriptions change later. Accepted correlation is an operational
overlay: checkpoint-N subscription state and hash remain unchanged until the
fenced N+1 commit consumes it.

The current linear profile also supports intermediate message throws. A throw
uses the standard BPMN `messageRef`; Wanaflow's `correlationKey` names the
top-level source variable, and `messagePayloadMapping` maps explicit payload
fields to top-level process variables. It then writes a
deterministically identified message-delivery outbox record with the checkpoint.
After commit, the dispatcher invokes the same correlation contract as the
public command. It does not use the engine's process-local message broker.

Delivery status, claim lease, attempt count, retry schedule, correlation
attempt, and target subscription form an operational ledger excluded from the
checkpoint projection hash. A dispatcher crash after correlation but before
settlement reuses `message-delivery:<delivery-id>` as its idempotency key; the
replacement claim observes the original outcome and cannot create a second
continuation command. No-match and ambiguous outcomes are terminal and never
consume a subscription. Transient conflicts are retried with bounded backoff.

## Variables

- Variables are JSON-compatible values.
- The serialized size limit is configurable; the default target is 1 MiB per
  instance snapshot and is an installation limit, not a portability guarantee.
- Large documents belong in blob storage and are referenced by opaque IDs.
- Top-level variable names beginning with `wanaflow.` are reserved. Dates and
  high-precision numbers use explicitly validated string representations when
  ordinary JSON number/string semantics are insufficient.
- Redacted paths use JSON Pointer syntax as policy metadata and are never returned to
  unauthorized clients.
- Secrets must be referenced through a secret provider, not stored as process
  variables.

## Persistence and recovery contract

Runtime persistence follows the atomic checkpoint, projection-hash, and fencing
protocol in [ADR 0007](../adr/0007-runtime-checkpoint-and-fencing.md). For each
executable fixture, tests must prove:

1. normal execution;
2. suspension at every wait state;
3. process termination immediately after persistence;
4. recovery in a new worker process;
5. exactly one logical continuation under duplicate queue delivery;
6. a stale worker cannot commit after lease expiry;
7. concurrent triggers for the same sequential wait select exactly one winner;
8. a post-commit/pre-ack crash does not duplicate events or effects; and
9. equivalent final variables and execution events after recovery.

Gateway and boundary-race fixtures are gates for the later profile that enables
those constructs; they are not part of `wanaflow-linear-v1`.

Missing, corrupt, or incompatible engine envelopes stop before engine recovery
and create a typed incident. Releases retain compatible adapters for supported
waiting instances, and backup manifests list every required adapter version.

Each advancement enforces transition, elapsed-time, serialized-state, and event
count budgets. Exhaustion creates an incident from the last committed
checkpoint rather than persisting partial progress.

## Incidents and cancellation

MVP operator retry is defined for exhausted external jobs and transient internal
work. Expression/model incidents are diagnosable but not migrated to a new
deployment; the operator may cancel the instance. Corrupt-state and
missing-adapter incidents remain blocked until compatible state or software is
restored.

When an accepted command cannot produce a checkpoint, Wanaflow atomically
quarantines that command, clears the instance pending-command pointer, records
the incident against the last checkpoint, and preserves its projection hash.
This makes a later permitted retry or cancellation a new, fenced command rather
than a replay of the failed one.

Cancellation atomically competes for every active wait, records the actor and
reason, and rejects late completions. Runtime v1 records it as a terminal
instance overlay while retaining checkpoint N and its normalized waits as the
last hash-verifiable recovery record; reads present those waits as cancelled
and active deliveries are superseded. It does not claim to compensate external
side effects.

## Runtime extension namespace

The final namespace URI is a decision gate. The initial descriptor will cover
only Wanaflow-owned execution metadata:

- external job configuration;
- form references;
- assignment;
- retry policy;
- input/output mapping; and
- redaction metadata.

Vendor-specific Camunda or Zeebe extensions may be imported and preserved when
their descriptors are configured, but they are not treated as executable
Wanaflow semantics.
