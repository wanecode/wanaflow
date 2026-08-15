# Contributing to Wanaflow

Wanaflow is pre-alpha and combines design review with an implemented Studio,
artifact registry, and initial REST contract.

Contributions are accepted under the repository's Apache-2.0 license. Useful
review targets include the product contract, experience flows, execution
profile, security boundaries, implemented API/database behavior, and Proposed
architecture decisions. Use [GitHub issues](https://github.com/wanecode/wanaflow/issues)
for reproducible bugs and bounded proposals. Please follow the private process
in [SECURITY.md](SECURITY.md) for vulnerabilities.

## Change workflow

1. Search existing issues and discussions before starting substantial work.
2. Fork the repository and create a focused branch from `main`.
3. Keep product behavior, tests, documentation, and ADRs consistent.
4. Run the verification commands below.
5. Open a pull request that explains the user impact, tradeoffs, and evidence.

Prefer small, reviewable changes. Do not combine unrelated refactors with a
feature or bug fix. New dependencies need a clear reason and a compatible
license. Never commit credentials, production data, `.env` files, database
backups, or generated browser artifacts.

## Architecture decision workflow

1. A costly or difficult-to-reverse choice starts as a Proposed ADR.
2. Review must test it against the MVP journey, self-hosting goal, failure
   recovery, security boundaries, and credible alternatives.
3. The project maintainer records material objections and resolves them in the
   ADR rather than only in chat or an issue.
4. The maintainer changes its status to Accepted, Rejected, or Superseded and
   records the decision date before implementation relies on it.
5. Reversing an Accepted choice requires a new ADR that links to the old one.

Acceptance means the project intends to implement and maintain the choice; it
does not claim that the implementation already exists.

## Documentation review

A useful review identifies a concrete ambiguity, contradiction, unsafe failure
mode, missing acceptance test, or unnecessary scope item. When possible, point
to the exact document section and propose testable replacement language.

## Local development

The tested baseline is Node.js 22 or newer with the repository-pinned pnpm
version.

~~~shell
corepack enable
pnpm install
pnpm dev:setup
pnpm dev
~~~

The web application runs at `http://localhost:3000`. Before handing off a
change, run:

~~~shell
pnpm typecheck
pnpm lint
pnpm build
pnpm test:integration
~~~

`pnpm test:integration` uses a dedicated PostgreSQL container, runs database and
modeling tests, builds the production application, and runs the REST plus
desktop/mobile Playwright journeys. Install Chromium once with
`pnpm --filter @wanaflow/web exec playwright install chromium` if needed.

Studio BPMN saves, revision-pinned review/approval, Publications, artifact
versions, environments, and Deployment records are persisted, and browser/API
access is protected by durable sessions plus Wanaflow tenant roles. Inbox work
and Operations state are persisted. The separate worker executes Wanaflow's
documented, bounded BPMN profile; changes to that profile require tests and
documentation.
The first owner is created with `pnpm auth:bootstrap`; public sign-up is closed.
Development bootstrap also creates an independent reviewer for policy testing.

TypeScript changes should remain strict, avoid hidden mutable state, and keep
tenant authorization at server boundaries. UI work should preserve progressive
disclosure, keyboard access, and the quiet business-language default. Formatting
is enforced by the repository's existing ESLint and TypeScript configuration.
