# ADR 0005: Progressive collaboration model

Status: Accepted

Decision date: 2026-08-14

## Context

Users expect collaborative editing, but synchronizing raw BPMN XML with a text
CRDT does not guarantee valid diagram semantics. Concurrent element deletion,
connection changes, movement, ID generation, and undo can produce confusing or
invalid outcomes.

Comments, review, approval, and presence deliver collaboration value without
requiring simultaneous diagram mutation.

## Decision

The MVP supports:

- live presence;
- concurrent durable comments and reviews;
- selected-element and revision awareness;
- idle autosave with explicit offline and reconnecting states;
- optimistic revision checks; and
- immutable reviewed revisions.

After MVP, evaluate command-level collaboration based on bpmn.io command-stack
operations and a CRDT or operational log. Publication and approval continue to
operate on immutable snapshots regardless of editing technology.

## Consequences

- MVP collaboration is trustworthy but not Google-Docs-style co-editing.
- The UI makes other editors, stale revisions, reconnecting, and save conflicts
  obvious without turning Studio into an administrative surface.
- Autosave never silently overwrites a newer revision.
- Later collaboration work begins with semantic commands and undo tests, not raw
  XML merging.

## Alternatives considered

- Yjs over raw XML: rejected for MVP because text convergence is not diagram
  semantic convergence.
- Last-write-wins saves: rejected because edits can disappear silently.
- No collaboration until CRDT editing exists: rejected because comments,
  reviews, presence, and approvals are independently valuable.
