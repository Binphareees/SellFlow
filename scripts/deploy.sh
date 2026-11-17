#!/usr/bin/env bash
#
# SellFlow — production deploy.
#
#   ./scripts/deploy.sh              # full gate + deploy
#   SKIP_E2E=1 ./scripts/deploy.sh   # first deploy, or when no app is live yet
#
# Pipeline:
#   1. load .env.production (secrets are never baked into the image)
#   2. npm run typecheck
#   3. npm run test:e2e against the live deployment (the 106-assertion suite)
#   4. build the image and tag it with the current commit
#   5. npx prisma migrate deploy against the volume
#   6. boot a candidate container on a side port and wait for /api/health = 200
#   7. swap the app container to the new image, health-gated, with rollback
#
# On step 7: the swap recreates the app container, so there is a sub-second gap
# while Docker stops the old one and starts the new one. Genuinely zero-downtime
# needs an L7 proxy (nginx/Caddy/Traefik) load-balancing two app containers;
# SQLite allows only one writer, so this script keeps a single app container and
# shortens the window instead: the candidate proves the new image is healthy on
# the real database before the swap.

set -Eeuo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

APP_PORT="${APP_PORT:-3000}"
CANDIDATE_PORT="${CANDIDATE_PORT:-3001}"
CONTAINER_NAME="${SELLFLOW_CONTAINER:-sellflow-app}"
CANDIDATE_NAME="${CONTAINER_NAME}-candidate"
VOLUME_NAME="${SELLFLOW_VOLUME:-sellflow-data}"
E2E_BASE_URL="${E2E_BASE_URL:-http://127.0.0.1:${APP_PORT}}"
SKIP_E2E="${SKIP_E2E:-0}"
IMAGE_REPO="${SELLFLOW_REPO:-sellflow}"
GIT_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo nogit)"
TAG="${DEPLOY_TAG:-${GIT_SHA}-$(date -u +%Y%m%d%H%M%S)}"
IMAGE="${IMAGE_REPO}:${TAG}"
MIGRATE_IMAGE="${IMAGE_REPO}-migrate:${TAG}"

log()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m warn\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31mfail\033[0m %s\n' "$*" >&2; exit 1; }

cleanup_candidate() {
  docker rm -f "$CANDIDATE_NAME" >/dev/null 2>&1 || true
}
trap cleanup_candidate EXIT

wait_for_health() {
  local url="$1" timeout="${2:-90}" waited=0 code="000"
  while [ "$waited" -lt "$timeout" ]; do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$url" || true)"
    [ "$code" = "200" ] && return 0
    sleep 2
    waited=$((waited + 2))
  done
  warn "health check at $url last returned HTTP $code"
  return 1
}

command -v docker >/dev/null || die "docker is not installed"
docker compose version >/dev/null 2>&1 || die "docker compose v2 is required"
command -v curl >/dev/null || die "curl is required for health checks"

# --- 1. environment -----------------------------------------------------------
if [ -f .env.production ]; then
  log "Loading .env.production"
  set -a
  # shellcheck disable=SC1091
  . ./.env.production
  set +a
else
  warn "No .env.production found; using variables from the current shell"
fi

[ -n "${SESSION_SECRET:-}" ] || die "SESSION_SECRET is not set (openssl rand -base64 32)"
[ "${#SESSION_SECRET}" -ge 16 ] || die "SESSION_SECRET must be at least 16 characters"
NEXT_PUBLIC_APP_URL="${NEXT_PUBLIC_APP_URL:-http://localhost:${APP_PORT}}"

# --- 2. typecheck -------------------------------------------------------------
[ -d node_modules ] || { log "Installing dependencies"; npm ci; }
log "Typechecking"
npm run typecheck

# --- 3. end-to-end suite ------------------------------------------------------
if [ "$SKIP_E2E" = "1" ]; then
  warn "SKIP_E2E=1 — skipping the E2E suite (expected only for a first deploy)"
else
  log "Running E2E suite against ${E2E_BASE_URL}"
  health_code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "${E2E_BASE_URL}/api/health" || true)"
  if [ "$health_code" != "200" ]; then
    die "no healthy deployment at ${E2E_BASE_URL} (HTTP ${health_code}). Start it, or run with SKIP_E2E=1 for a first deploy."
  fi
  BASE_URL="$E2E_BASE_URL" npm run test:e2e
fi

# --- 4. build -----------------------------------------------------------------
PREV_IMAGE=""
app_id="$(docker compose ps -q app 2>/dev/null || true)"
if [ -n "$app_id" ]; then
  PREV_IMAGE="$(docker inspect --format '{{.Config.Image}}' "$app_id" 2>/dev/null || true)"
  [ -n "$PREV_IMAGE" ] && log "Current image: $PREV_IMAGE"
fi

log "Building $IMAGE"
docker build \
  --tag "$IMAGE" \
  --tag "${IMAGE_REPO}:latest" \
  --build-arg "NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}" \
  --build-arg "NEXT_PUBLIC_APP_NAME=${NEXT_PUBLIC_APP_NAME:-SellFlow}" \
  --build-arg "NEXT_PUBLIC_DEFAULT_CURRENCY=${NEXT_PUBLIC_DEFAULT_CURRENCY:-NGN}" \
  .

# --- 5. migrations ------------------------------------------------------------
# The runner image has no Prisma CLI (standalone tracing drops it), so migrations
# run from the dedicated migrator stage built from the same commit. They run as
# uid 1001, the same user the app container uses, so the SQLite file it creates
# stays writable by the app. Migrations must be expand-only: the old container
# keeps serving while they apply.
log "Building migrator image $MIGRATE_IMAGE"
docker build --target migrator --tag "$MIGRATE_IMAGE" .

log "Applying migrations (npx prisma migrate deploy)"
docker run --rm \
  --volume "${VOLUME_NAME}:/app/data" \
  --env DATABASE_URL=file:/app/data/prod.db \
  --env "SESSION_SECRET=${SESSION_SECRET}" \
  "$MIGRATE_IMAGE" npx prisma migrate deploy

# --- 6. candidate verification ------------------------------------------------
# Nothing to protect on a first deploy: let compose create the volume (it then
# labels it as its own) and start straight into the health-gated step below.
if [ -z "$app_id" ]; then
  log "No running app container — first deploy, skipping candidate verification"
else
  log "Starting candidate on 127.0.0.1:${CANDIDATE_PORT}"
  cleanup_candidate
  docker run -d \
    --name "$CANDIDATE_NAME" \
    --restart no \
    --publish "127.0.0.1:${CANDIDATE_PORT}:3000" \
    --volume "${VOLUME_NAME}:/app/data" \
    --env NODE_ENV=production \
    --env PORT=3000 \
    --env HOSTNAME=0.0.0.0 \
    --env DATABASE_URL=file:/app/data/prod.db \
    --env "SESSION_SECRET=${SESSION_SECRET}" \
    --env "SESSION_MAX_AGE_DAYS=${SESSION_MAX_AGE_DAYS:-30}" \
    --env "MAX_AUTH_ATTEMPTS=${MAX_AUTH_ATTEMPTS:-5}" \
    --env "NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}" \
    --env "NEXT_PUBLIC_APP_NAME=${NEXT_PUBLIC_APP_NAME:-SellFlow}" \
    --env "NEXT_PUBLIC_DEFAULT_CURRENCY=${NEXT_PUBLIC_DEFAULT_CURRENCY:-NGN}" \
    "$IMAGE" >/dev/null
  
  if ! wait_for_health "http://127.0.0.1:${CANDIDATE_PORT}/api/health" 90; then
    warn "Candidate logs:"
    docker logs --tail 40 "$CANDIDATE_NAME" 2>&1 || true
    die "candidate never became healthy — the live container was left untouched"
  fi
  log "Candidate is healthy"
fi

# --- 7. swap ------------------------------------------------------------------
log "Swapping the app container to $IMAGE"
if ! SELLFLOW_IMAGE="$IMAGE" docker compose up -d --no-deps --wait --wait-timeout 90 app; then
  warn "Swap failed; rolling back"
  if [ -n "$PREV_IMAGE" ]; then
    SELLFLOW_IMAGE="$PREV_IMAGE" docker compose up -d --no-deps app || true
    die "deploy failed — rolled back to $PREV_IMAGE"
  fi
  die "deploy failed and there was no previous image to roll back to"
fi

if ! wait_for_health "http://127.0.0.1:${APP_PORT}/api/health" 30; then
  if [ -n "$PREV_IMAGE" ]; then
    warn "New container is unhealthy; rolling back to $PREV_IMAGE"
    SELLFLOW_IMAGE="$PREV_IMAGE" docker compose up -d --no-deps app || true
    die "deploy failed — rolled back"
  fi
  die "deploy failed: app container is not healthy"
fi

cleanup_candidate
docker image prune --force --filter "label=stage=builder" >/dev/null 2>&1 || true

log "Deployed $IMAGE"
log "Health: $(curl -s "http://127.0.0.1:${APP_PORT}/api/health" || true)"
