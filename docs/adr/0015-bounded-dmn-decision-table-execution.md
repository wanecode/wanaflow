# ADR 0015: Bounded DMN decision-table execution

Status: Accepted

Date: 2026-08-14

## Context

Wanaflow needs decisions to be portable, reviewable, callable by developers,
and usable inside a process. Implementing the whole DMN specification would
delay that vertical and make deterministic recovery harder to audit.

## Decision

Ship one closed profile, `wanaflow-dmn-table@1`:

- one named decision and one decision table per artifact;
- `UNIQUE` and `FIRST` hit policies;
- stable named string, number, and boolean inputs/outputs;
- FEEL unary tests and output expressions through `@bpmn-io/feelin`, with
  time-dependent functions blocked;
- BPMN Business Rule Task binding by stable artifact key and explicit maps;
- review-time resolution and immutable Publication/Deployment pinning; and
- durable evidence containing the decision artifact version, input, output,
  hit policy, and matched rule IDs.

Public evaluation accepts a Deployment ID, never draft XML or a draft key
alone. Runtime evaluation participates in the fenced checkpoint transaction;
its evidence has a deterministic identity so recovery cannot commit duplicates.

## Consequences

The Studio can be business-friendly without hiding execution semantics, and the
API and process runtime share one evaluator. DRDs, decision services,
boxed/literal expressions, temporal functions, complex FEEL contexts, and
additional hit policies remain preserved for modeling where possible but are
not executable until a later named profile and fixtures are accepted.
