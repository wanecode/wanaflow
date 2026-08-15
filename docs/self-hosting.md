# Self-host Wanaflow

The supported demo topology fits on one small Linux server:

```text
Internet → Caddy (automatic HTTPS) → Wanaflow web
                                      ↘ PostgreSQL
                                      ↘ runtime worker
                                      ↘ filesystem blob volume
```

Caddy is the only service with public ports. PostgreSQL, migrations, the web
container, and the runtime worker share a private Docker network. BPMN, DMN,
forms, reviews, and runtime checkpoints remain transactional in PostgreSQL.
The filesystem volume is reserved for attachments and other large blobs.

MinIO is deliberately not part of this single-server profile. Add an
S3-compatible store only when Wanaflow web or worker replicas run on more than
one host. On one host it adds administration without improving durability;
off-host backups are what matter.

## One-command public demo

Requirements are Docker Engine, Docker Compose v2, `curl`, a Linux server, and
one DNS record. Point an `A` record (and `AAAA` when IPv6 is configured) at the
server, then allow inbound TCP 22, 80, and 443 plus UDP 443 in the firewall.
Keep every database port closed.

From a fresh checkout, run:

```sh
tooling/selfhost/deploy.sh \
  --site process.example.com \
  --owner owner@example.com \
  --name "Awa Wane"
```

The command:

1. creates `.env.selfhost` with mode `600` and cryptographically random
   database, session, owner, and reviewer secrets;
2. builds one Wanaflow image;
3. starts PostgreSQL, applies migrations, and starts web and worker services;
4. provisions Caddy with an automatic public certificate;
5. idempotently bootstraps owner and independent-reviewer accounts; and
6. checks readiness, sign-in, the authenticated library, and all required
   containers through the public URL.

The generated credentials are printed only on the first run and remain in the
protected environment file. Back up that file separately from application
data. Public registration stays closed; the owner invites additional people
from the product.

The same command is the upgrade command after pulling a new version. It reuses
the environment file, runs forward migrations, and skips bootstrap when an
authenticated organization already exists.

## Local deployment rehearsal

Run the exact topology without DNS or certificates:

```sh
tooling/selfhost/deploy.sh \
  --site http://localhost \
  --owner owner@wanaflow.local \
  --name "Local owner"
```

Open `http://localhost`. This is a deployment rehearsal, not the normal
Node.js development loop. Stop it without deleting data using:

```sh
docker compose --env-file .env.selfhost -f compose.selfhost.yaml down
```

## Manual configuration

For infrastructure automation, copy `.env.selfhost.example` to
`.env.selfhost`, replace every placeholder, set file mode `600`, and run:

```sh
docker compose --env-file .env.selfhost -f compose.selfhost.yaml up -d --build --wait
docker compose --env-file .env.selfhost -f compose.selfhost.yaml \
  --profile setup run --rm --no-deps bootstrap
tooling/selfhost/smoke.sh
```

`WANAFLOW_SITE_ADDRESS` is the Caddy site address. Use a bare public hostname
for automatic HTTPS; `BETTER_AUTH_URL` must be the corresponding absolute
`https://` origin. Caddy persists certificate state in its own Docker volume.

### Optional AI experience studio

The core studio remains fully usable without an AI provider. To enable **Create
with Wana**, set `DEEPSEEK_API_KEY` in `.env.selfhost` and restart the `web`
service. The supported defaults are `deepseek-v4-flash` through
`https://api.deepseek.com/v1`; both can be overridden with
`WANAFLOW_AI_MODEL` and `WANAFLOW_AI_BASE_URL` for a compatible endpoint.

CopilotKit runs inside the Wanaflow web container as the open AG-UI transport;
Wanaflow does not use CopilotKit Intelligence or require a CopilotKit cloud
account. Conversation snapshots, choice evidence, artifact links, validation,
and revision history stay in Wanaflow PostgreSQL. Model prompts are sent to the
configured AI endpoint, so use non-sensitive demo data until the provider and
retention terms fit your deployment. Anonymous CopilotKit package telemetry is
disabled in the supplied self-host profile.

## Backup and restore

Create a complete local backup:

```sh
tooling/selfhost/backup.sh
```

This writes a PostgreSQL custom-format dump, the blob volume, and SHA-256
checksums. Copy the resulting directory off the server. A database-only backup
will become incomplete once referenced attachments exist.

Restore is explicit and destructive:

```sh
tooling/selfhost/restore.sh --confirm backups/20260814T120000Z
```

Restore verifies checksums, stops public traffic and workers, replaces the
database and blob volume, reapplies forward migrations, and waits for the
application to become healthy. Test restores on a separate server regularly.

## Operating checks

```sh
tooling/selfhost/smoke.sh
docker compose --env-file .env.selfhost -f compose.selfhost.yaml ps
docker compose --env-file .env.selfhost -f compose.selfhost.yaml logs -f web worker caddy
```

`/api/health` reports only readiness and database latency; it does not expose
the database name or credentials. Container logs use Docker's bounded local
driver so a noisy public demo cannot consume the host disk indefinitely. Caddy
adds compression, conservative browser security headers, upstream health
checks, and HTTP-to-HTTPS redirection.

## Demo security boundary

Wanaflow is pre-alpha. This profile is appropriate for a public demonstration
or a controlled pilot with non-sensitive data. It is not yet a general
production claim: MFA, password recovery, OIDC, generalized API credentials,
attachment scanning, and full abuse controls remain open security gates. Keep
the operating system and Docker patched, use unique identities, retain off-host
backups, and do not model real confidential processes in an internet demo.
