#!/usr/bin/env bash
set -euo pipefail

readonly COMPOSE_FILE="compose.test.yaml"
readonly TEST_DATABASE_URL="postgresql://wanaflow:wanaflow_test@127.0.0.1:55432/wanaflow_test"

cleanup() {
  if [[ -n "${WORKER_PID:-}" ]]; then
    kill "${WORKER_PID}" 2>/dev/null || true
    wait "${WORKER_PID}" 2>/dev/null || true
  fi
  docker compose -f "${COMPOSE_FILE}" down --volumes
}

trap cleanup EXIT INT TERM

docker compose -f "${COMPOSE_FILE}" up -d --wait postgres

export DATABASE_URL="${TEST_DATABASE_URL}"
export BETTER_AUTH_SECRET="wanaflow-integration-secret-at-least-32-characters"
export BETTER_AUTH_URL="http://127.0.0.1:3100"
export WANAFLOW_BOOTSTRAP_EMAIL="owner@wanaflow.test"
export WANAFLOW_BOOTSTRAP_PASSWORD="Wanaflow-test-2026!"
export WANAFLOW_BOOTSTRAP_NAME="Awa Wane"
export WANAFLOW_BOOTSTRAP_REVIEWER_EMAIL="reviewer@wanaflow.test"
export WANAFLOW_BOOTSTRAP_REVIEWER_PASSWORD="Wanaflow-reviewer-test-2026!"
export WANAFLOW_BOOTSTRAP_REVIEWER_NAME="Moussa Diop"
export WANAFLOW_AUTH_SIGN_IN_RATE_LIMIT="50"
export COPILOTKIT_TELEMETRY_DISABLED="true"
export NEXT_TELEMETRY_DISABLED="1"
export TURBO_TELEMETRY_DISABLED="1"

pnpm db:migrate
pnpm --filter @wanaflow/modeling test
pnpm --filter @wanaflow/db test
pnpm auth:bootstrap
pnpm worker >/dev/null 2>&1 &
WORKER_PID=$!
pnpm --filter @wanaflow/web test:ui
