#!/bin/sh
set -eu

backup_dir=${1:-"backups/$(date -u +%Y%m%dT%H%M%SZ)"}
compose_file=${WANAFLOW_COMPOSE_FILE:-compose.selfhost.yaml}
env_file=${WANAFLOW_ENV_FILE:-.env.selfhost}
[ -f "$env_file" ] || { echo "Missing $env_file" >&2; exit 1; }
mkdir -p "$backup_dir"

compose() {
  docker compose --env-file "$env_file" -f "$compose_file" "$@"
}

compose exec -T postgres sh -c \
  'pg_dump --format=custom --no-owner --username="$POSTGRES_USER" "$POSTGRES_DB"' \
  > "$backup_dir/database.dump"
compose exec -T web sh -c \
  'tar -C /var/lib/wanaflow -czf - blobs' \
  > "$backup_dir/blobs.tar.gz"
(cd "$backup_dir" && sha256sum database.dump blobs.tar.gz > SHA256SUMS)

echo "Wanaflow backup written to $backup_dir"
