# ADR 0009: Progressive-disclosure Studio experience

Status: Accepted

Decision date: 2026-08-13

## Context

BPM products can easily become administration consoles: permanent navigation,
several panels, dense toolbars, metric cards, and every lifecycle action visible
at once. That presentation makes simple business work feel technical and turns
the modeling canvas into one small widget among many.

Using shadcn source does not prevent this outcome. Wanaflow needs an explicit
experience architecture from the beginning.

## Decision

Wanaflow uses a premium, calm, canvas-first experience built around progressive
disclosure. Each view prioritizes the current object and next decision, reveals
context on demand, and keeps technical depth directly accessible without making
it the default presentation.

Wanaflow rejects generic admin-dashboard composition and card grids as its
primary information architecture. Cards are used only for truly discrete,
glanceable objects. Lists, tables, full-bleed workspaces, split views,
inspectors, drawers, and strong typographic hierarchy are selected according to
the work being done.

The complete product rules and acceptance criteria are defined in
[the experience principles](../product/experience-principles.md).

## Consequences

- Information architecture, interaction flows, and visual direction begin in
  M0 rather than after feature implementation.
- Studio, Inbox, and Operations share a coherent shell but prioritize different
  work by role and intent.
- Advanced controls require excellent keyboard access and deep links so
  progressive disclosure does not penalize experts.
- Visual, responsive, accessibility, and workflow usability checks join the
  definition of done.
- shadcn primitives are adapted to the Wanaflow language instead of dictating
  page composition.

## Alternatives considered

- Generic admin template: rejected because it exposes system structure instead
  of guiding process work and would make Wanaflow visually interchangeable.
- Card-first dashboard: rejected because it wastes working space and weakens
  hierarchy for modeling, queues, and operational records.
- Design after functional MVP: rejected because information architecture and
  interaction debt would already be embedded in every workflow.
- Separate simplified and expert applications: rejected because progressive
  disclosure can support both audiences without fragmenting product semantics.
