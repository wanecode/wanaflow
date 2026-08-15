# ADR 0007: Atomic runtime checkpoints and fenced continuation

Status: Accepted

Decision owner: Project maintainer

Implemented core: migrations 0006, 0009, 0010, and 0011, `@wanaflow/worker`, and
`@wanaflow/job-worker`

## Context

`bpmn-engine` can advance and serialize a BPMN execution, but it does not by
itself provide Wanaflow's durable external jobs, PostgreSQL-owned timers,
tenant-scoped message correlation, transactional projections, or protection
against two workers resuming the same checkpoint.

Persisting an engine snapshot and normalized tasks, jobs, timers, variables,
and events independently would create competing sources of truth. A worker can
also lose its lease while still running, allowing a replacement worker to
advance the same instance.

## Decision

Wanaflow advances each instance as a sequence of atomic checkpoints.

The implementation applies this protocol to START, TASK_COMPLETE,
JOB_COMPLETE, TIMER_FIRE, and MESSAGE_CORRELATE commands. External-job delivery,
sequential intermediate timers, message-catch subscriptions, intermediate
message-throw outbox delivery, and terminal instance cancellation are enabled.
Boundary-timer and parallel race-group clauses remain normative requirements
for the profile version that enables those constructs.

### Authority and command acceptance

Normalized PostgreSQL rows are authoritative for public task, job, timer,
message, variable, incident, and event state. The engine envelope is a private
continuation cursor that must match the normalized checkpoint revision and
projection hash.

Accepted triggers, external-job delivery attempts, and outbound-message
dispatch state are separate operational ledgers and are excluded from that
projection hash. The immutable outbound-message intent is created in the same
transaction as its source checkpoint; later claim, retry, and outcome changes
cannot alter that checkpoint. A task completion, job
completion, timer fire, or message correlation command conditionally verifies an active wait at
checkpoint revision N, inserts one immutable `TRIGGER_ACCEPTED` command, and
sets `process_instance.pending_command_id` only when it was null. It does not
mutate checkpoint-N waits, variables, envelope, projection hash, or checkpoint
revision. Queries may combine the overlay with checkpoint state to show
`completion pending` without claiming the task has advanced.

Only one resume command may be pending for an instance. A losing or unrelated
command receives a conflict and cannot schedule continuation. A command for an
unrelated parallel wait that arrives while another continuation is pending
receives a retryable `INSTANCE_ADVANCING` conflict and may be accepted after the
next checkpoint. Boundary waits share a race-group identifier with their
attached activity, so activity completion and an interrupting timer select one
winner for that group. Runtime-v1 terminal instance cancellation uses the same
pending-command guard and is serialized against every group.

### Advancement and commit

A Runtime Worker:

1. claims the resume command with a monotonically increasing fencing token;
2. loads checkpoint revision N and verifies envelope and projection hashes;
3. reconstructs the compatible adapter and injects exactly that command;
4. buffers engine events while advancing to a proven quiescent boundary; and
5. attempts one database transaction that compares revision N, the exact
   `pending_command_id`, and the fencing token, then writes checkpoint N+1,
   normalized projections, events, audit, and new durable work, and clears the
   pending command pointer.

The database transaction is not held while the engine advances. A stale
worker's compare-and-swap fails, so its candidate checkpoint is discarded.
Replaying an uncommitted command starts again from revision N. Event IDs and
effects derived during advancement are deterministic for instance, command,
and event sequence so replay does not duplicate committed facts.

### Quiescence and custom behavior

The adapter may checkpoint only when all live tokens are terminal or suspended
at Wanaflow-managed waits and its event buffer is complete. Adapter tests must
prove this boundary for parallel paths; observing one `activity.wait` event is
not sufficient.

The current adapter supplies custom behavior for:

- service tasks, which create an external-job wait and never invoke modeled
  integration code in-process;
- timers, for which PostgreSQL is the only clock and firing authority; and
- message catch/throw, which use Wanaflow subscriptions and transactional
  outbox delivery rather than the engine's process-local broker semantics.

A later profile that enables exclusive gateways must additionally supply
custom outbound selection that evaluates every candidate from one immutable
FEEL input and rejects zero or multiple matches. The linear profile blocks that
construct instead of inheriting the engine's first-match short circuit.

External-job lock acquisitions, heartbeats, failures, attempt numbers, and
retry schedules live in the operational delivery ledger. They do not mutate the
checkpoint-N job wait or projection hash. Only successful completion or
another BPMN trigger competes for the wait and participates in a checkpoint
transition. Retry exhaustion opens an incident without changing checkpoint N
or its job wait.

Outbound messages use a deterministic delivery ID derived from source instance,
checkpoint revision, and throw execution. A fenced dispatcher invokes the same
environment/name/correlation contract as the public correlation command with a
delivery-derived idempotency key. A crash between correlation and delivery
settlement therefore replays the stored correlation result instead of creating
a second command. No engine-local message publication is authoritative.

Runtime-v1 instance cancellation is a synchronous terminal transaction, not an
engine resume: it is permitted only when `pending_command_id` is null, changes
the instance status to `CANCELLED`, supersedes active delivery rows, resolves
open incidents, and records actor/reason. Checkpoint-N task, job, timer, and
message-subscription rows remain
physically unchanged so its envelope and projection hash remain an honest last
recoverable record; public reads derive their cancelled presentation from the
terminal instance overlay. A completion that wins the same database race sets
the pending-command guard first, so cancellation conflicts. A late completion
after cancellation fails the instance/job/lease predicates.

Runtime construction installs a rejecting script handler. Executable
publication uses a closed-world validator that rejects every unsupported
element, event definition, expression language, and executable extension.

### Engine state envelope

The canonical envelope contains only committed checkpoint state. Operational
lease/delivery-attempt fields and accepted-command overlays are not part of
`projectionSha256`. The envelope contains:

~~~typescript
type EngineStateEnvelope = {
  schemaVersion: 1;
  instanceId: string;
  instanceRevision: number;
  deploymentHash: string;
  adapter: {
    name: "bpmn-engine";
    adapterVersion: string;
    engineVersion: string;
  };
  payloadEncoding: "json";
  payload: unknown;
  payloadSha256: string;
  projectionSha256: string;
};
~~~

The adapter registry rejects an unavailable or incompatible version before
calling engine recovery. Releases retain every adapter version referenced by a
supported waiting instance or explicitly require those instances to finish
before upgrade. Backups record the required adapter compatibility manifest.

### Budgets and incidents

Each advancement has transition, elapsed-time, state-size, and event-count
budgets. Exceeding a budget or failing an invariant produces a typed incident
from the last committed checkpoint; it never commits a partial projection.
Internal work has bounded automatic retries before quarantine.

If a deterministic failure prevents checkpoint N+1, one transaction marks the
accepted command `QUARANTINED`, clears `pending_command_id`, records an incident
against checkpoint N and the command, and leaves the checkpoint projection and
hash unchanged. Cancellation may then be accepted as a new command against N.
Retrying a recoverable incident creates a new command identity; the quarantined
command is immutable and cannot run again accidentally.

## Consequences

- Public command acceptance and engine advancement are intentionally separate.
- A completed-task request may be accepted before the instance reaches its next
  checkpoint, but the accepted trigger cannot be won by a competing timer.
- Runtime correctness depends on custom adapter behavior and race/conformance
  fixtures, not on default `bpmn-engine` semantics.
- Normalized state can be queried without deserializing the engine, while hashes
  detect divergence from its private continuation cursor.
- Engine advancement may repeat after a crash, so external effects remain
  outbox-backed or external-job-backed and idempotent.

## Alternatives considered

- Persist independent engine and domain state: rejected because crash windows
  can resurrect waits or overwrite variables.
- Trust queue leases alone: rejected because lease expiry does not stop a stale
  worker already executing.
- Hold a database transaction while advancing: rejected because unbounded BPMN
  work would hold locks and connections while still not fencing a failed owner.
- Use default engine services, timers, and messages: rejected because their
  in-memory semantics do not implement Wanaflow's durable public contracts.
