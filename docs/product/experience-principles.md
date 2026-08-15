# Wanaflow experience principles

Status: Accepted product direction

## Experience thesis

Wanaflow should feel like a calm, premium professional workspace: focused
enough for a first-time reviewer, precise enough for a process expert, and fast
enough for a developer operating it all day.

The product does not present the whole system at once. It reveals the next
useful decision, keeps the active process or task visually dominant, and makes
deeper operational and technical detail available without allowing it to
overwhelm the default view.

The visual direction is **quiet precision**: editorial typography, generous but
purposeful space, controlled density, crisp hierarchy, restrained color, and
motion that explains state changes. It should not resemble a generic admin
template, analytics dashboard, or collection of shadcn demo cards.

## Progressive disclosure

Information is organized in three layers:

1. **Focus:** the current process, decision, form, task, incident, or approval
   and its one primary next action.
2. **Context:** properties, comments, validation, history, and related work shown
   only when the user selects or requests them.
3. **Depth:** IDs, XML/JSON, deployment hashes, retries, variables, audit detail,
   and engine metadata available in inspectors, drawers, dedicated views, or a
   command palette.

Progressive disclosure must not hide errors, destructive consequences, current
status, or information required for informed approval. It reduces noise; it
does not obscure risk.

Expert efficiency comes from keyboard navigation, command search, stable URLs,
saved preferences, and direct deep links—not from placing every action on the
screen.

## Spatial model

### Studio

- The modeling canvas is the workspace, not a widget inside a dashboard card.
- Project identity, artifact name, revision state, and the primary lifecycle
  action form a quiet top-level frame.
- Properties appear contextually for the selected element and can collapse
  completely.
- Comments anchor to their elements and open as a focused conversation layer.
- Validation stays quiet when healthy and becomes prominent when action is
  required.
- Review mode removes mutation tools and emphasizes the change, discussion,
  validation result, and approval decision.
- Technical source and deployment metadata are one intentional action away,
  never permanently competing with the canvas.

### Task Inbox

- The default view answers “what needs me now?” rather than summarizing the
  entire process estate.
- Opening a task prioritizes its form, instructions, due state, and completion
  action. BPMN context is optional supporting detail.
- Assignment, claim, and completion state remain unmistakable without exposing
  engine terminology to task workers.

### Operations

- Operations begins with exceptions and work requiring intervention, not a wall
  of vanity metrics.
- Instance detail uses a readable timeline and current waits as the primary
  model; variables, raw events, and engine detail are progressively revealed.
- Dense tables are preferred for comparable operational records. Cards are not
  used as substitutes for tables or information architecture.

## Surface and card policy

Cards are reserved for genuinely discrete, glanceable objects or choices. They
must not become the default container around every section.

Prefer:

- full-bleed work areas;
- typographic grouping and whitespace;
- dividers used only where hierarchy needs reinforcement;
- lists for navigation and queues;
- tables for comparable records;
- split views for object plus context; and
- drawers or inspectors for temporary depth.

Avoid nested rounded rectangles, repeated shadows, icon-plus-stat tiles,
dashboard grids without a decision purpose, permanent left-and-right panels,
and large headings that reduce the actual work area.

## Visual language

- Typography establishes hierarchy before borders or background fills.
- A mostly neutral working environment lets BPMN/DMN semantics and status color
  carry meaning.
- Accent color is scarce and signals focus, selection, or the primary action.
- Status never relies on color alone.
- Corners, shadows, borders, and translucency use a restrained, documented
  scale rather than component defaults.
- Motion communicates continuity—opening context, accepting work, publishing a
  revision, advancing an instance—and respects reduced-motion preferences.
- Empty, loading, error, conflict, read-only, and reconnecting states receive
  the same design attention as the happy path.

Wanaflow should be recognizable without its logo. The first design exploration
must select and document a distinctive type system, spacing rhythm, color
system, icon treatment, and motion character before feature pages multiply.

## shadcn boundary

shadcn supplies accessible component source, behavior patterns, and a practical
starting point. It is not the Wanaflow design system by itself.

- Components are composed and styled around Wanaflow tasks, not presented as a
  catalog of primitives.
- Default dashboard examples, typography, radii, shadows, and layouts are not
  product direction.
- A component is added when a real workflow needs it; installing every registry
  component does not mean exposing every pattern in the UI.
- Domain components such as artifact status, review decision, task form,
  incident timeline, and contextual modeler inspector own the product language.

## Role-shaped entry points

The product has one coherent information architecture, but the first useful
view depends on intent:

- designers return to recent artifacts and work in progress;
- reviewers see review requests requiring a decision;
- task workers see claimable and assigned work;
- operators see incidents, overdue work, and unhealthy delivery; and
- developers can reach API keys, deployments, events, and technical contracts
  without those controls dominating business workflows.

This is contextual prioritization, not a set of disconnected role-specific
applications.

## Experience acceptance criteria

Before a workflow is considered complete:

- its default view has one visually dominant purpose and at most one primary
  action;
- secondary and advanced controls appear only in relevant context;
- the core task works by keyboard and with assistive technology;
- focus, loading, empty, validation, conflict, read-only, failure, and success
  states are designed and tested;
- a narrow viewport preserves task completion and review even when full diagram
  editing requires a larger screen;
- visual regression tests protect hierarchy, density, and modeler integration;
- representative designers, reviewers, task workers, and operators can identify
  the next action without being taught Wanaflow's internal architecture; and
- design review explicitly rejects generic admin-dashboard and card-grid drift.

## Initial design deliverables

M0 produces:

1. information architecture and role-based entry-point map;
2. low-fidelity flows for the complete MVP journey;
3. visual direction and design tokens;
4. the application frame, navigation, command palette, inspector, and status
   language;
5. interaction prototypes for editing, review, task completion, and incident
   handling; and
6. accessibility, responsive, motion, and visual-regression test criteria.

These foundations precede a broad page build. Premium quality is part of system
design, not a visual cleanup milestone.
