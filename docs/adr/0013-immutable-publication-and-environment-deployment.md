# ADR 0013: Immutable publication and environment deployment

Status: Accepted

Decision date: 2026-08-13

## Context

An approved review proves what a reviewer accepted, but it must not also act as
a mutable release pointer. Runtime consumers need a stable, environment-bound
identity that remains resolvable after authors save later drafts or operators
deploy another release.

Publication and deployment are separate lifecycle boundaries. A Publication is
the environment-independent result of governance. A Deployment is one placement
of that Publication into a named project environment.

## Decision

Publishing an approved, valid review creates exactly one immutable Publication
and one monotonically numbered Artifact Version for every artifact in its
resolved manifest. The baseline implementation contains the root BPMN artifact;
DMN and form dependency resolution will add entries to the same manifest shape.

The Publication stores:

- the pinned review and revision identities;
- a canonical manifest and SHA-256 hash;
- validation and approval snapshots;
- the publishing principal and timestamp; and
- its immutable artifact versions.

The publish command is idempotent by review ID. Concurrent attempts serialize
on the review and return the same Publication. Publishing never advances or
rewrites an artifact's draft head.

Projects receive named Development, Staging, and Production environments by
default. A Deployment binds one Publication to one environment and embeds a
resolved, checksummed execution bundle containing exact artifact versions and
source. Each environment has an append-only deployment sequence. Deploying the
same Publication again creates a new Deployment rather than changing history.

Publication, Artifact Version, and Deployment rows reject updates and deletes
at the database boundary. Each successful command appends an audit record and a
transactional outbox event. Deployment creation does not itself start runtime
instances or move a mutable “current” pointer; those are later runtime commands
that resolve an immutable Deployment ID.

Authorization follows the minimum-role baseline:

- designers may publish eligible reviews but cannot deploy;
- operators may inspect Publications and deploy them but cannot publish; and
- organization owners and workspace administrators inherit both authorities.

## Consequences

- Governance proof, artifact versioning, and environment placement remain
  independently auditable.
- New drafts cannot change a Publication or Deployment already in use.
- A single Publication can be promoted to multiple environments without being
  copied or re-approved.
- Re-deployment is historical fact, not mutation, and receives a new sequence
  number and deployment ID.
- The current root-only manifest is forward-compatible with resolved DMN and
  form dependencies but does not claim those editors or resolvers exist yet.

## Alternatives considered

- Deploy the approved revision directly: rejected because it collapses
  governance, versioning, and environment placement into one record.
- Store a mutable environment “current revision”: rejected because runtime
  history could no longer prove the exact installed bundle.
- Reuse a Deployment when the same Publication is placed twice: rejected
  because distinct operational actions must remain distinct audit facts.
