# Security policy

## Supported versions

Wanaflow is pre-alpha. Security fixes are made on the latest `main` branch and
included in the next tagged release. Older commits and deployments are not
supported.

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability.

Use GitHub's **Security → Report a vulnerability** flow for this repository.
Include the affected revision, deployment assumptions, reproduction steps,
impact, and any suggested mitigation. Reports involving tenant isolation,
authentication, review integrity, deployment immutability, process execution,
or secret exposure are especially important.

The maintainers will acknowledge a complete report as soon as practical,
validate it privately, and coordinate remediation and disclosure. Please avoid
accessing data that is not yours, disrupting a live service, or publishing the
issue before a fix is available.

## Deployment boundary

The included single-host profile is intended for evaluation and controlled
demonstrations. Read [the threat model](docs/security/threat-model.md) and
[self-hosting guidance](docs/self-hosting.md) before exposing it to the
internet. Do not use pre-alpha deployments for sensitive or regulated process
data.
