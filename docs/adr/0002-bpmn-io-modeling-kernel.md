# ADR 0002: Use bpmn.io as the modeling kernel

Status: Accepted

Decision date: 2026-08-13

## Context

Wanaflow requires standards-based BPMN, DMN, and form authoring. Rebuilding
diagram rendering, modeling semantics, properties panels, moddle parsing, and
validation would consume the project while producing a less compatible editor.

## Decision

Wanaflow uses the maintained bpmn.io ecosystem as its modeling kernel:

- bpmn-js, diagram-js, and bpmn-moddle;
- dmn-js and dmn-moddle;
- form-js;
- properties panels and lint integrations; and
- maintained supporting modules selected through a compatibility matrix.

Wanaflow creates a curated composition, not an indiscriminate dependency on
every repository in the organization.

Wanaflow consumes upstream packages directly and avoids a permanent fork.
Wanaflow-specific executable metadata uses documented moddle extensions and
element templates.

## Consequences

- Browser modelers require client-only hosting; ADR 0008 defines the concrete
  Next.js integration.
- CSS and interaction integration require dedicated compatibility tests.
- Upgrades are grouped and validated against round-trip and interaction
  fixtures.
- The application shell and diagram-js canvas remain separate integration
  boundaries; ADR 0008 defines the shell UI stack.
- Wanaflow contributes generally useful fixes upstream where practical.

## Alternatives considered

- Build custom modelers: rejected due cost, compatibility risk, and poor focus.
- Embed a vendor desktop modeler: rejected because Wanaflow needs integrated
  web collaboration and governance.
- Fork bpmn.io: rejected as the default because it creates a long-term merge and
  security burden.
