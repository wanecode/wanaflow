# ADR 0011: Better Auth sessions and Wanaflow tenant authorization

Status: Accepted

Decision date: 2026-08-13

## Context

Wanaflow now exposes durable artifact APIs and therefore needs a real identity
boundary before expanding collaboration. Authentication, organization
membership, and product authorization are related concerns, but coupling all
three to an identity library would make Wanaflow's domain and self-hosting model
dependent on that library's organization abstraction.

The first release also needs a safe, understandable way to establish its first
owner without temporarily opening public registration.

## Decision

Use Better Auth 1.6.27 for human email/password authentication and PostgreSQL-
backed browser sessions. Wanaflow owns organizations, principals, memberships,
roles, workspace scope, and permission checks in its domain schema.

The initial browser-session profile is:

- public registration disabled;
- a 12-hour absolute session lifetime with refresh and cookie caching disabled;
- HTTP-only, same-site session cookies under the `wanaflow` prefix;
- the configured Wanaflow origin as the trusted browser origin;
- authentication rate limiting enabled, with email sign-in limited to five
  attempts per source bucket per minute; and
- a required production secret and canonical public base URL.

The local administrative command `pnpm auth:bootstrap` creates the first Better
Auth user and an organization-owner membership. Bootstrap mode exists only in
that command's process, not in the running web application. The command refuses
to create another first owner after an authenticated membership exists. A
production operator must explicitly provide the owner's email, name, and a
unique password through environment variables.

Every `/api/v1` route resolves the session to a Wanaflow principal and membership
before reading or changing domain data. Authorization is deny-by-default. The
current artifact-registry permission matrix is:

| Role | Read projects/artifacts | Create project | Create/update artifact |
| --- | --- | --- | --- |
| Organization owner | Yes | Yes | Yes |
| Workspace admin | Yes, in scope | Yes, in scope | Yes, in scope |
| Designer | Yes, in scope | No | Yes, in scope |
| Reviewer | Yes, in scope | No | No |
| Operator | Yes, in scope | No | No |
| Task worker | No | No | No |

When a user belongs to more than one organization, API requests must select one
with `X-Wanaflow-Organization`. A requested organization or resource outside the
resolved tenant/scope returns not found, avoiding a cross-tenant existence
oracle.

## Consequences

- Session revocation and credential records are durable in the same PostgreSQL
  operational boundary as the current application.
- The Studio and public artifact API now share the same authenticated tenant
  and role checks.
- Better Auth schema changes and upgrades are pinned, migrated, and tested like
  other persistence changes.
- Browser cookies are not an API-key strategy. Workspace invitations use
  expiring, single-use tokens inside the same authorization boundary. OIDC,
  service accounts, scoped API keys, password recovery, and MFA require later
  decisions.
- Wanaflow can replace the identity provider without replacing its organization
  and authorization model.

## Alternatives considered

- Better Auth's organization plugin: useful, but would make library-owned
  organization semantics authoritative over Wanaflow's workspace scopes and
  workflow roles.
- Auth.js: a credible Next.js integration, but Better Auth provides the selected
  database-backed credential/session baseline with a direct server API for the
  one-time bootstrap command.
- Hosted identity only: reduces local credential work, but conflicts with a
  self-hosted installation being useful without an external control plane.
- A bespoke session implementation: adds security-sensitive code without a
  product-specific advantage.
