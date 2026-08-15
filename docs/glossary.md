# Wanaflow glossary

These terms have one intended meaning across product, API, and architecture
documents.

## Modeling and governance

- **Artifact:** A project-owned BPMN process, DMN decision, or form with a
  stable project-scoped key.
- **Draft head:** A mutable pointer to the latest saved revision of an artifact;
  the pointed-to revision is itself immutable.
- **Revision:** An immutable saved artifact payload used for conflict detection
  and review. A revision is not deployable merely because it exists.
- **Review manifest:** The root artifact revision plus exact revisions of all
  referenced artifacts covered by one review.
- **Artifact version:** An immutable, monotonically numbered artifact payload
  created by publication.
- **Publication:** An immutable approved and validated dependency graph of
  artifact versions. It is independent of an environment.
- **Deployment:** An immutable binding of one Publication to one environment.
- **moddle descriptor:** A schema used by bpmn.io parsers to understand and
  preserve BPMN or DMN extension elements.
- **FEEL:** Friendly Enough Expression Language, used for deterministic
  conditions and mappings in the supported execution profile.
- **hit policy:** A DMN decision-table rule that determines how matching rows
  produce a result.

## Runtime and integration

- **Wanaflow Runtime:** The domain subsystem that advances deployed process
  instances and owns tasks, timers, external jobs, incidents, and history.
- **Runtime Worker:** The Wanaflow-operated Node.js process that claims durable
  internal work and invokes the engine adapter. It does not run integration
  code from process models.
- **Durable work record:** An internal, PostgreSQL-backed request for a Runtime
  Worker to advance an instance, fire a timer, or deliver an outbox item.
- **External job:** A wait created by a BPMN service task for application-owned
  integration code.
- **External worker:** A developer-operated client that locks and completes
  external jobs through the public API. It is not the Runtime Worker.
- **Engine state envelope:** The checksummed, versioned serialized state needed
  to resume one process instance with a compatible engine adapter.
- **Conformance fixture:** A checked-in model and expected event/state trace used
  to prove runtime semantics and recovery behavior.

## Events and records

- **Domain event:** An immutable fact produced by a successful domain command.
- **Execution event:** A domain event in one process instance's append-only
  timeline.
- **Outbox record:** The durable transactional representation used to deliver a
  domain event or schedule internal work after commit.
- **Audit record:** A security-oriented record of who attempted or completed a
  governed command and against which resource.
- **Webhook delivery:** One signed, retriable HTTP delivery of a public event to
  a configured endpoint.

## Identifiers

Artifact and environment keys are not globally unique. A process lookup is
scoped by authenticated organization plus workspace key, project key,
environment key, and process artifact key. A deployment ID is globally unique
and is the unambiguous alternative.

## Architecture shorthand

- **Transactional outbox:** State changes and delivery records committed in the
  same database transaction, then delivered asynchronously.
- **CRDT:** A conflict-free replicated data type considered for future
  simultaneous diagram editing; it is not part of the MVP edit-lease design.
- **RLS:** PostgreSQL row-level security, considered as defense in depth.
- **SBOM:** A software bill of materials generated for dependency and license
  inspection.
