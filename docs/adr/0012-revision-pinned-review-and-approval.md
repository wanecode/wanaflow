# ADR 0012: Revision-pinned review and approval

Status: Accepted

Decision date: 2026-08-13

## Context

An approval is meaningful only when everyone can identify exactly what was
approved. Attaching review state to an artifact's mutable draft head would let
later edits silently change the subject of an open or completed decision.
Comments also need BPMN context without modifying portable XML solely to carry
collaboration metadata.

## Decision

Each review pins one immutable artifact revision ID. Its requester, brief,
assignments, and pinned revision are immutable. The lifecycle is:

~~~text
OPEN ──approve──────────> APPROVED
  ├────request changes──> CHANGES_REQUESTED
  └────cancel───────────> CANCELLED
~~~

Terminal reviews never reopen. Continuing work means saving another immutable
draft revision and requesting another review. A revision can be the subject of
only one review, preventing a terminal result from being bypassed by submitting
the unchanged source again.

Review assignments name explicit principals. The baseline separation-of-duty
policy requires a deciding principal to:

- hold review-decision permission in the artifact's workspace;
- be assigned to the review; and
- be different from both the requester and revision author.

Review comments are separate tenant-scoped records anchored to BPMN element IDs
that are verified against the pinned XML. Comment bodies and anchors do not
alter the BPMN source. Approval additionally requires a structurally valid
revision and no unresolved comments. Requesting changes remains possible when
either approval prerequisite fails and requires an explanatory note.

Every request, comment, resolution, decision, and cancellation appends an audit
record and transactional outbox event. A database view derives publication
eligibility from an approved review joined to its valid pinned revision. It is
not stored on the artifact draft head.

## Consequences

- Reviewers see stable content even while authors continue editing.
- Approval proves actor, time, outcome, source hash, and exact revision.
- New edits do not invalidate or broaden an older approval; they are simply not
  covered by it.
- BPMN remains portable because collaboration metadata is not injected into XML.
- The current single-approval policy can later grow into a manifest and quorum
  policy without weakening existing audit records.
- Publication creation consumes this decision's authoritative eligibility fact
  through the immutable boundary defined in ADR 0013.

## Alternatives considered

- Review the mutable draft head: rejected because review content could change
  after inspection.
- Copy review state onto artifacts: rejected because an artifact may have many
  historical and superseding reviews.
- Store comments as BPMN extension elements: rejected because collaboration
  state is tenant metadata and should not pollute portable source.
- Let owners self-approve: rejected as a default because it provides no
  independent governance signal.
