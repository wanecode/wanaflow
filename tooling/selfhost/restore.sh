#!/bin/sh
set -eu

if [ "${1:-}" != "--confirm" ] || [ -z "${2:-}" ]; then
  echo "Usage: $0 --confirm BACKUP_DIRECTORY"
  echo "This replaces the current Wanaflow database and blob files."
  exit 2
fi

backup_dir=$2
compose_file=${WANAFLOW_COMPOSE_FILE:-compose.selfhost.yaml}
env_file=${WANAFLOW_ENV_FILE:-.env.selfhost}
[ -f "$env_file" ] || { echo "Missing $env_file" >&2; exit 1; }
(cd "$backup_dir" && sha256sum -c SHA256SUMS)

compose() {
  docker compose --env-file "$env_file" -f "$compose_file" "$@"
}

compose stop caddy web worker
compose exec -T postgres sh -c \
  'dropdb --if-exists --username="$POSTGRES_USER" "$POSTGRES_DB" && createdb --username="$POSTGRES_USER" "$POSTGRES_DB"'
compose exec -T postgres sh -c \
  'pg_restore --no-owner --username="$POSTGRES_USER" --dbname="$POSTGRES_DB"' \
  < "$backup_dir/database.dump"
compose run --rm -T web sh -c \
  'rm -rf /var/lib/wanaflow/blobs && tar -C /var/lib/wanaflow -xzf -' \
  < "$backup_dir/blobs.tar.gz"
compose run --rm migrate
compose up -d --wait web worker caddy

echo "Wanaflow restore completed from $backup_dir"
