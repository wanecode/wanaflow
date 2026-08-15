# ADR 0004: PostgreSQL source of truth and pluggable blob storage

Status: Accepted

Decision date: 2026-08-13

## Context

BPMN XML, DMN XML, and form JSON are small versioned artifacts participating in
reviews, publication, deployment, and audit. Attachments and generated exports
have different size and access characteristics. Self-hosting should not require
an object-storage service for the first useful installation.

## Decision

Store canonical artifact source, versions, deployment bundles, runtime state,
and blob reachability metadata in PostgreSQL. Store large binary content through
a BlobStore port; that store is authoritative for the bytes PostgreSQL
references.

Ship:

- a local filesystem driver for development and single-node self-hosting; and
- an S3-compatible driver for replicated production.

Use a PostgreSQL-backed durable work queue and transactional outbox initially.
Queue adapters may be added later, but PostgreSQL remains the source of truth.

Blob writes use an orphan-safe protocol: stream to an organization-scoped
pending key, compute and verify a SHA-256 checksum, then allow a database
transaction to reference it. Transaction failure can leave an unreferenced
object but never a database reference to unverified bytes. Age-based garbage
collection removes abandoned pending objects; logical deletion removes database
reachability before asynchronous byte deletion.

Backup and restore include PostgreSQL, the BlobStore, and a checksum manifest.
Content-addressed keys never deduplicate across organization boundaries. The
local driver rejects path traversal, does not derive paths from filenames, and
uses owner-only file permissions by default.

## Consequences

- Artifact lifecycle operations can be transactional.
- Database backup includes portable definitions and waiting execution state.
- A complete backup also includes referenced blob bytes and their manifest.
- Large binaries do not inflate core tables or API responses.
- Multi-host deployments cannot use node-local blob storage.
- Database retention and partitioning need explicit operational policy as
  execution events grow.
- PostgreSQL queue contention must be benchmarked before raising reference-scale
  targets.

## Alternatives considered

- Filesystem for all artifacts: rejected because versioning and metadata become
  difficult to commit atomically and multi-node deployment becomes fragile.
- Mandatory MinIO: rejected because it adds a service to the reference install
  and couples Wanaflow to one S3-compatible implementation.
- Object storage for every artifact revision: rejected because it complicates
  transactional review and publication without meaningful benefit for small
  text artifacts.
