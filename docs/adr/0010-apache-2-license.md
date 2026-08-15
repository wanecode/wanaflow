# ADR 0010: Apache License 2.0 for Wanaflow

Status: Accepted

Decision date: 2026-08-13

## Context

Wanaflow is intended to be real open-source process infrastructure. Its license
must permit self-hosting, commercial use, modification, and distribution while
providing an explicit patent grant suitable for infrastructure adopters and
contributors.

## Decision

License Wanaflow under the Apache License, Version 2.0. Keep the complete license
at the repository root, declare `Apache-2.0` in workspace package metadata, and
maintain `NOTICE` when redistributed material requires attribution.

Contributions are submitted under the same license unless the project adopts a
separate contributor agreement through a later recorded decision.

## Consequences

- Individuals and companies may use, modify, and redistribute Wanaflow under
  the license terms.
- Distributions must preserve required license, notice, and modification
  information.
- Dependency and copied-source provenance still require separate review; the
  project license does not relicense third-party material.
- A future relicensing decision would require a new ADR and the rights needed
  from contributors.

## Alternatives considered

- MIT: permissive and simple, but lacks Apache-2.0's explicit patent grant and
  patent-termination terms.
- AGPL-3.0: strong network copyleft can support an open-core strategy, but adds
  adoption and compliance friction that does not match Wanaflow's current goal.
