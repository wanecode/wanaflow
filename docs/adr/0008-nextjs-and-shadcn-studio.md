# ADR 0008: Next.js and shadcn for Wanaflow Studio

Status: Accepted

Decision date: 2026-08-13

## Context

Wanaflow needs a browser application for modeling, governance, the Task Inbox,
and operations while keeping every durable action available through public
application contracts. The modelers are browser-heavy and must not leak into
server-rendered dashboard bundles.

## Decision

Build Wanaflow Studio with the Next.js App Router. Use shadcn's CLI and registry
to install component source into the repository, with Wanaflow-owned design
tokens and compositions around it.

At scaffold time, select current stable compatible releases of Next.js, React,
Tailwind CSS, and shadcn, pin exact resolved versions in one lockfile, and record
the resulting compatibility set. `latest` is an installation-time selection,
not a floating production dependency range.

bpmn.io modelers live in client-only, route-split components. shadcn owns the
application shell and ordinary controls; it does not replace or deeply restyle
diagram-js canvas internals.

shadcn is implementation material, not Wanaflow's visual identity or page
architecture. ADR 0009 defines the premium progressive-disclosure experience
and rejects generic admin-dashboard and card-grid composition.

## Consequences

- Studio routes can combine server-rendered data views with client-only editor
  islands.
- Editor routes require browser and visual regression tests.
- shadcn components are application source and may be adapted to Wanaflow,
  while upstream provenance and licenses remain recorded.
- Framework and UI upgrades are grouped and verified against modeling,
  accessibility, and end-to-end fixtures.

## Alternatives considered

- A client-only SPA: rejected because Wanaflow also benefits from server-side
  data loading and API composition in one deployable web process.
- A closed component package: rejected because source-owned shadcn components
  allow deliberate product-specific adaptation.
- Custom UI primitives from scratch: rejected because they add accessibility
  and maintenance work without differentiating the modeling product.
