#!/bin/sh
set -eu

compose_file=${WANAFLOW_COMPOSE_FILE:-compose.selfhost.yaml}
env_file=${WANAFLOW_ENV_FILE:-.env.selfhost}
[ -f "$env_file" ] || { echo "Missing $env_file" >&2; exit 1; }
command -v curl >/dev/null 2>&1 || { echo "curl is required for the deployment check" >&2; exit 1; }

read_value() {
  sed -n "s/^$1=//p" "$env_file" | tail -n 1
}

base_url=${WANAFLOW_SMOKE_URL:-$(read_value BETTER_AUTH_URL)}
owner_email=$(read_value WANAFLOW_BOOTSTRAP_EMAIL)
owner_password=$(read_value WANAFLOW_BOOTSTRAP_PASSWORD)
[ -n "$base_url" ] || { echo "BETTER_AUTH_URL is missing from $env_file" >&2; exit 1; }

temporary_dir=$(mktemp -d)
cleanup() {
  rm -rf "$temporary_dir"
}
trap cleanup EXIT INT TERM

ready=false
attempt=1
while [ "$attempt" -le 30 ]; do
  if curl --fail --silent --show-error --max-time 5 "$base_url/api/health" > "$temporary_dir/health.json" 2>/dev/null \
    && grep -q '"status":"ready"' "$temporary_dir/health.json"; then
    ready=true
    break
  fi
  attempt=$((attempt + 1))
  sleep 2
done
[ "$ready" = true ] || { echo "Wanaflow did not become ready at $base_url/api/health" >&2; exit 1; }

escape_json() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

if [ -n "$owner_email" ] && [ -n "$owner_password" ]; then
  payload=$(printf '{"email":"%s","password":"%s"}' "$(escape_json "$owner_email")" "$(escape_json "$owner_password")")
  curl --fail --silent --show-error --max-time 10 \
    --cookie-jar "$temporary_dir/cookies.txt" \
    --header 'Content-Type: application/json' \
    --data "$payload" \
    "$base_url/api/auth/sign-in/email" > "$temporary_dir/sign-in.json"
  curl --fail --silent --show-error --max-time 10 \
    --cookie "$temporary_dir/cookies.txt" \
    "$base_url/api/v1/library" > "$temporary_dir/library.json"
  grep -q '"workspaces"' "$temporary_dir/library.json" \
    || { echo "Authenticated library check returned an unexpected response" >&2; exit 1; }
fi

running_services=$(docker compose --env-file "$env_file" -f "$compose_file" ps --status running --services)
for service in postgres web worker caddy; do
  printf '%s\n' "$running_services" | grep -qx "$service" \
    || { echo "Required service is not running: $service" >&2; exit 1; }
done

echo "Wanaflow deployment check passed at $base_url"
