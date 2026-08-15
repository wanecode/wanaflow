# ADR 0003: Separate runtime worker and engine port

Status: Accepted

Decision owner: Project maintainer

Implemented by: `@wanaflow/runtime`, `@wanaflow/worker`, and migrations 0006,
0009, and 0010

## Context

bpmn-engine provides the initial JavaScript BPMN execution implementation.
Long-running process instances suspend on tasks, messages, timers, and external
work and must survive application restarts. Next.js request handlers are not an
appropriate owner for those lifecycles.

Directly exposing bpmn-engine objects throughout the product would also bind
domain persistence, APIs, and operational semantics to one library.

## Decision

Run process advancement in a separate Node.js worker. Place bpmn-engine behind
a Wanaflow ProcessEngine port. Persist a versioned engine state envelope at
every externally visible wait.

The Wanaflow domain owns deployments, tasks, jobs, timers, incidents, variables,
audit, and domain events. The adapter owns translation between bpmn-engine
events/state and that domain.

This decision does not treat default engine behavior as Wanaflow semantics. The
adapter must provide custom external-job, durable-timer, message-correlation,
script-rejection, and FEEL integration behavior. Atomic checkpointing, fenced
leases, state authority, and quiescence are governed by ADR 0007.

Implementation is intentionally staged. The current executable adapter accepts
one linear path of none start/end events, user tasks, Wanaflow external service
jobs, intermediate date/duration timer catches, and sequence flows. It installs
custom service-task and timer behavior; messages, gateways, scripts,
expressions, boundary races, and concurrent tokens remain closed-gate rejected.

## Consequences

- Web deployments can scale independently from runtime workers.
- Worker crashes do not lose acknowledged waits.
- Engine upgrades require state compatibility fixtures and may require
  side-by-side adapter versions.
- The abstraction reduces coupling but does not make different engines
  semantically interchangeable.
- Runtime progress is asynchronous after API acknowledgement.

## Alternatives considered

- Execute inside Next.js handlers: rejected due lifecycle, timeout, scaling, and
  recovery constraints.
- Expose bpmn-engine directly as the domain: rejected due coupling and weak
  governance/operations boundaries.
- Build a new BPMN engine immediately: rejected because Wanaflow should first
  prove product semantics and conformance requirements.
