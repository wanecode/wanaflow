# ADR 0001: Developer-first and API-first product

Status: Superseded by ADR 0016

Decision date: 2026-08-13

## Context

Wanaflow must serve developers embedding process infrastructure into
applications while remaining approachable to process designers, reviewers, and
operators. A studio-led architecture could make core capabilities inaccessible
to CI, integrations, and automation.

## Decision

The API and runtime are the primary product. Wanaflow Studio is a first-party
client of the same application services and durable contracts available to
external clients.

Every durable Studio operation must have a public API-level equivalent. The
choice of REST/OpenAPI, SDK generation, webhook delivery, and external-job
protocol is governed separately by ADR 0006.

Business-friendly means clear terminology, guided validation, reviews, forms,
and operational views. It does not mean executing arbitrary user code or hiding
deployment/version semantics.

## Consequences

- Public contracts are designed before or with UI workflows.
- Studio cannot bypass authorization, validation, idempotency, or audit logic.
- End-to-end tests exercise both Studio and generated SDK paths.
- Some local UI interactions, such as canvas selection and unsaved undo, remain
  client-only because they are not durable product operations.

## Alternatives considered

- Studio-first application with internal endpoints: rejected because it weakens
  embedding and creates accidental private contracts.
- Engine library only: rejected because collaboration, governance, forms, and
  operations are core Wanaflow value.
