# ADR 0014: Form artifacts and human-task bindings

Status: Accepted

Date: 2026-08-13

## Context

Wanaflow needs forms that remain portable, reusable, reviewable, and safe to
execute. A runtime task must not render a mutable form draft, and arbitrary form
fields must not silently become process variables.

## Decision

- A form is a first-class `FORM` artifact whose canonical source is form-js
  JSON. Wanaflow stores every save as an immutable revision and validates the
  schema on the server.
- A BPMN user task references a form by project-scoped stable key using
  `wanaflow:formKey` in the Wanaflow BPMN namespace.
- `wanaflow:inputMapping` is a JSON object mapping form field keys to process
  variable keys. `wanaflow:outputMapping` maps process variable keys to form
  field keys. The initial profile supports top-level keys only.
- Requesting review resolves every referenced form to the form's current draft
  revision and writes immutable review-dependency rows. Missing or invalid forms
  block the review request.
- Publication creates numbered artifact versions for the root BPMN process and
  every pinned form. Deployments therefore contain an exact, checksummed bundle.
- When execution reaches a bound user task, the runtime copies the exact
  deployed form schema, its hash, initial mapped data, and both mappings into
  the task projection.
- The browser renders that snapshot with form-js. Completion is validated again
  on the server. The raw submission is retained for audit, while only values in
  the explicit output mapping enter process variables.
- A user task without a form remains completable through the generic output
  object for backward compatibility with the first runtime slice.

## Consequences

- Editing a form after review or deployment cannot change work already under
  review or waiting in an Inbox.
- A process and its forms can be exported without Wanaflow database identifiers.
- Mapping is intentionally explicit and conservative. Nested-path mapping,
  file fields, expression mappings, and dynamic option providers require later
  profiles with their own security and conformance rules.
