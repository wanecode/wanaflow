#!/bin/sh
set -eu

compose_file=${WANAFLOW_COMPOSE_FILE:-compose.selfhost.yaml}
env_file=${WANAFLOW_ENV_FILE:-.env.selfhost}
site=""
owner_email=""
owner_name="Wanaflow owner"

usage() {
  cat <<'EOF'
Usage:
  tooling/selfhost/deploy.sh --site process.example.com --owner owner@example.com [--name "Owner name"]

The first run creates .env.selfhost with generated secrets, starts Wanaflow,
and creates owner and reviewer accounts. Later runs safely rebuild and migrate
the same installation. Point the hostname at this server before a public run.

For a local deployment check, use --site http://localhost.
EOF
}

fail() {
  echo "Wanaflow deploy: $*" >&2
  exit 1
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --site)
      [ "$#" -ge 2 ] || fail "--site needs a value"
      site=$2
      shift 2
      ;;
    --owner)
      [ "$#" -ge 2 ] || fail "--owner needs a value"
      owner_email=$2
      shift 2
      ;;
    --name)
      [ "$#" -ge 2 ] || fail "--name needs a value"
      owner_name=$2
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail "unknown option: $1"
      ;;
  esac
done

command -v docker >/dev/null 2>&1 || fail "Docker is required"
docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is required"
[ -f "$compose_file" ] || fail "compose file not found: $compose_file"

generate_secret() {
  bytes=$1
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex "$bytes"
  else
    od -An -N "$bytes" -tx1 /dev/urandom | tr -d ' \n'
  fi
}

validate_single_line() {
  value=$1
  label=$2
  case "$value" in
    *'
'*) fail "$label must fit on one line" ;;
  esac
}

created=false
if [ ! -f "$env_file" ]; then
  [ -n "$site" ] || fail "--site is required for the first deployment"
  [ -n "$owner_email" ] || fail "--owner is required for the first deployment"
  validate_single_line "$site" "site"
  validate_single_line "$owner_email" "owner email"
  validate_single_line "$owner_name" "owner name"

  case "$owner_email" in
    *@*.*) ;;
    *) fail "--owner must be a valid email address" ;;
  esac

  case "$site" in
    http://localhost|http://127.0.0.1)
      auth_url=$site
      reviewer_email=reviewer@wanaflow.local
      ;;
    *://*)
      fail "use a hostname without a scheme, or http://localhost for a local check"
      ;;
    *)
      printf '%s' "$site" | grep -Eq '^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$' \
        || fail "--site must be a public hostname such as process.example.com"
      auth_url=https://$site
      reviewer_email=reviewer@$site
      ;;
  esac

  database_password=$(generate_secret 32)
  auth_secret=$(generate_secret 48)
  owner_password=$(generate_secret 18)
  reviewer_password=$(generate_secret 18)

  umask 077
  {
    printf 'WANAFLOW_SITE_ADDRESS=%s\n' "$site"
    printf 'BETTER_AUTH_URL=%s\n' "$auth_url"
    printf 'ACME_EMAIL=%s\n' "$owner_email"
    printf 'POSTGRES_DB=wanaflow\n'
    printf 'POSTGRES_USER=wanaflow\n'
    printf 'POSTGRES_PASSWORD=%s\n' "$database_password"
    printf 'BETTER_AUTH_SECRET=%s\n' "$auth_secret"
    printf 'WANAFLOW_AUTH_SIGN_IN_RATE_LIMIT=5\n'
    printf 'WANAFLOW_IMAGE=wanaflow:local\n'
    printf 'WANAFLOW_HTTP_PORT=80\n'
    printf 'WANAFLOW_HTTPS_PORT=443\n'
    printf 'WANAFLOW_BOOTSTRAP_EMAIL=%s\n' "$owner_email"
    printf 'WANAFLOW_BOOTSTRAP_PASSWORD=%s\n' "$owner_password"
    printf 'WANAFLOW_BOOTSTRAP_NAME=%s\n' "$owner_name"
    printf 'WANAFLOW_BOOTSTRAP_REVIEWER_EMAIL=%s\n' "$reviewer_email"
    printf 'WANAFLOW_BOOTSTRAP_REVIEWER_PASSWORD=%s\n' "$reviewer_password"
    printf 'WANAFLOW_BOOTSTRAP_REVIEWER_NAME=Independent reviewer\n'
    printf 'WANAFLOW_BOOTSTRAP_ORGANIZATION_KEY=local\n'
    printf 'WANAFLOW_BOOTSTRAP_ORGANIZATION_NAME=Wanaflow demo\n'
    printf 'WANAFLOW_BOOTSTRAP_WORKSPACE_KEY=default\n'
    printf 'WANAFLOW_BOOTSTRAP_PROJECT_KEY=people-operations\n'
  } > "$env_file"
  chmod 600 "$env_file"
  created=true
else
  echo "Using existing protected configuration: $env_file"
fi

compose() {
  docker compose --env-file "$env_file" -f "$compose_file" "$@"
}

compose config --quiet
compose up -d --build --wait
compose --profile setup run --rm bootstrap

WANAFLOW_ENV_FILE=$env_file WANAFLOW_COMPOSE_FILE=$compose_file tooling/selfhost/smoke.sh

base_url=$(sed -n 's/^BETTER_AUTH_URL=//p' "$env_file" | tail -n 1)
if [ "$created" = true ]; then
  reviewer_email=$(sed -n 's/^WANAFLOW_BOOTSTRAP_REVIEWER_EMAIL=//p' "$env_file" | tail -n 1)
  reviewer_password=$(sed -n 's/^WANAFLOW_BOOTSTRAP_REVIEWER_PASSWORD=//p' "$env_file" | tail -n 1)
  owner_email=$(sed -n 's/^WANAFLOW_BOOTSTRAP_EMAIL=//p' "$env_file" | tail -n 1)
  owner_password=$(sed -n 's/^WANAFLOW_BOOTSTRAP_PASSWORD=//p' "$env_file" | tail -n 1)
  cat <<EOF

Wanaflow is ready at $base_url

Owner:    $owner_email
Password: $owner_password

Reviewer: $reviewer_email
Password: $reviewer_password

These credentials are stored in $env_file (mode 600). Keep that file private.
EOF
else
  echo "Wanaflow is ready at $base_url"
fi
