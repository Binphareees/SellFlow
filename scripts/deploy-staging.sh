#!/usr/bin/env bash
#
# SellFlow — deploy staging from the laptop.
#
#   SSH_TARGET=deploy@staging.sellflow.shop ./scripts/deploy-staging.sh        # dry run
#   SSH_TARGET=deploy@staging.sellflow.shop ./scripts/deploy-staging.sh --yes  # run it
#
# The host compiles nothing: the three images are built here, streamed over one
# ssh connection and loaded on the other side. `next build` needs more memory
# than a small VPS has, and a build that dies on the server has already stopped
# the old container by the time it fails.
#
# Order matters for the rollback: the host's current image is tagged
# sellflow:previous *before* `docker load` overwrites sellflow:current. Tagging
# afterwards would point "previous" at the image that just failed.
#
# Inputs (environment):
#   SSH_TARGET                user@host (required)
#   NEXT_PUBLIC_APP_URL       public origin, default https://staging.sellflow.shop
#   NEXT_PUBLIC_APP_NAME      build arg, default SellFlow
#   REMOTE_ROOT               server tree, default /srv/sellflow
#   HEALTH_TIMEOUT            seconds to wait for /api/health, default 180
#   ALLOW_DIRTY=1             skip the clean-tree refusal (rehearsals only)
#   SKIP_BUILD=1              reuse local sellflow:* images (rehearsals only)
#
# It copies exactly two files — deploy/docker-compose.staging.yml and
# deploy/Caddyfile — into $REMOTE_ROOT/app/deploy/, and never touches
# $REMOTE_ROOT/app/.env.production, which belongs to the operator.

set -Eeuo pipefail

SSH_TARGET="${SSH_TARGET:-}"
NEXT_PUBLIC_APP_URL="${NEXT_PUBLIC_APP_URL:-https://staging.sellflow.shop}"
NEXT_PUBLIC_APP_NAME="${NEXT_PUBLIC_APP_NAME:-SellFlow}"
NEXT_PUBLIC_DEFAULT_CURRENCY="${NEXT_PUBLIC_DEFAULT_CURRENCY:-NGN}"
REMOTE_ROOT="${REMOTE_ROOT:-/srv/sellflow}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-180}"
EXECUTE=0

APP_DIR="$REMOTE_ROOT/app"
DEPLOY_DIR="$APP_DIR/deploy"
HEALTH_URL="${NEXT_PUBLIC_APP_URL%/}/api/health"
COMPOSE="docker compose --env-file .env.production -f deploy/docker-compose.staging.yml"

log()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
note() { printf '      %s\n' "$*"; }
warn() { printf '\033[1;33m warn\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31mfail\033[0m %s\n' "$*" >&2; exit 1; }
trap 'printf "\033[1;31mfail\033[0m stopped at line %s\n" "$LINENO" >&2' ERR

usage() {
  cat <<'EOF'
Deploy SellFlow staging from this laptop.

  SSH_TARGET=user@host scripts/deploy-staging.sh          # dry run (default)
  SSH_TARGET=user@host scripts/deploy-staging.sh --yes    # execute

Options:
  --yes, -y    run the commands (without this nothing is executed)
  --dry-run    print the commands only (the default)
  --help, -h   this text

Environment: SSH_TARGET (required), NEXT_PUBLIC_APP_URL, NEXT_PUBLIC_APP_NAME,
REMOTE_ROOT, HEALTH_TIMEOUT, ALLOW_DIRTY, SKIP_BUILD — see the header.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --yes|-y) EXECUTE=1 ;;
    --dry-run) EXECUTE=0 ;;
    --help|-h) usage; exit 0 ;;
    *) usage >&2; die "unknown argument: $1" ;;
  esac
  shift
done

# Prints a command and runs it only with --yes. Use for argv-safe local commands.
run_local() {
  printf '  [local] %s\n' "$*"
  [ "$EXECUTE" = 1 ] || return 0
  "$@"
}

# Prints a shell string and runs it with bash only with --yes. Needed where the
# step is a pipeline; every interpolated value goes through q().
run_shell() {
  printf '  [local] %s\n' "$1"
  [ "$EXECUTE" = 1 ] || return 0
  bash -c "$1"
}

# Prints a remote command string and runs it over ssh only with --yes.
run_remote() {
  printf '  [ssh]   %s\n' "$1"
  [ "$EXECUTE" = 1 ] || return 0
  ssh "$SSH_TARGET" "$1"
}

# Single-quotes a value for the printed command line. ssh receives it as one
# argument, so this is about readability and valid re-entry, not word splitting.
q() {
  local s="$1"
  s="${s//\'/\'\\\'\'}"
  printf "'%s'" "$s"
}

# --- 0. preconditions --------------------------------------------------------
command -v docker >/dev/null 2>&1 || die "docker is not installed"
command -v gzip   >/dev/null 2>&1 || die "gzip is not installed"
command -v curl   >/dev/null 2>&1 || die "curl is not installed"
command -v ssh    >/dev/null 2>&1 || die "ssh is not installed"
[ -n "$SSH_TARGET" ] || die "SSH_TARGET is not set (export SSH_TARGET=user@host)"
# Remote command strings carry these values unquoted, so they must not contain
# whitespace or a single quote.
case "${SSH_TARGET} ${REMOTE_ROOT} ${NEXT_PUBLIC_APP_URL}" in
  *"'"*) die "SSH_TARGET, REMOTE_ROOT and NEXT_PUBLIC_APP_URL must not contain a single quote" ;;
esac
case "${SSH_TARGET}${REMOTE_ROOT}${NEXT_PUBLIC_APP_URL}" in
  *[[:space:]]*) die "SSH_TARGET, REMOTE_ROOT and NEXT_PUBLIC_APP_URL must not contain whitespace" ;;
esac
git rev-parse --git-dir >/dev/null 2>&1 || die "not inside a git checkout"

branch="$(git rev-parse --abbrev-ref HEAD)"
[ "$branch" = "main" ] || die "on branch '$branch'; deploy from main"

# Untracked files are part of the build context (`COPY . .`), so they count as
# dirty: a stray local file can end up in the image.
if [ "${ALLOW_DIRTY:-0}" = "1" ]; then
  warn "ALLOW_DIRTY=1 — skipping the clean-tree check (rehearsal only)"
else
  dirty="$(git status --porcelain)"
  if [ -n "$dirty" ]; then
    printf '%s\n' "$dirty" >&2
    die "working tree is dirty; commit or stash first (ALLOW_DIRTY=1 overrides, rehearsals only)"
  fi
fi

log "Deploying $(git rev-parse --short HEAD) to ${SSH_TARGET}:${APP_DIR}"
note "public origin: ${NEXT_PUBLIC_APP_URL}"
[ "$EXECUTE" = 1 ] || note "DRY RUN — nothing below is executed (pass --yes to run it)"

# --- 0b. the host layout this script refuses to create ----------------------
# Both of these belong to the operator (runbook §1 and §5). Checked before the
# build, so a missing directory costs seconds rather than a four-minute build.
log "Checking the host layout"
run_remote "test -d $REMOTE_ROOT/data || { echo 'missing $REMOTE_ROOT/data — create it and chown 1001:1001 (runbook section 1)'; exit 3; }"
run_remote "test -f $APP_DIR/.env.production || { echo 'missing $APP_DIR/.env.production — create it from .env.production.example (runbook section 5)'; exit 3; }"

# --- 1. build locally --------------------------------------------------------
if [ "${SKIP_BUILD:-0}" = "1" ]; then
  warn "SKIP_BUILD=1 — reusing the local sellflow:current / :migrator / :pilot"
else
  log "Building images"
  run_local docker build \
    --build-arg "NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}" \
    --build-arg "NEXT_PUBLIC_APP_NAME=${NEXT_PUBLIC_APP_NAME}" \
    --build-arg "NEXT_PUBLIC_DEFAULT_CURRENCY=${NEXT_PUBLIC_DEFAULT_CURRENCY}" \
    -t sellflow:current .
  run_local docker build --target migrator -t sellflow:migrator .
  run_local docker build --target pilot    -t sellflow:pilot .
fi

# --- 2. tag the old image, then stream the new ones -------------------------
# The tag happens in the same remote shell, before `docker load` replaces the
# sellflow:current tag, so a rollback target always exists after the first
# deploy. The archive arrives on stdin: nothing is written to the host's disk.
log "Streaming the images (docker save | gzip | ssh | docker load)"
run_shell "docker save sellflow:current sellflow:migrator sellflow:pilot | gzip -1 | ssh $(q "$SSH_TARGET") $(q "if docker image inspect sellflow:current >/dev/null 2>&1; then docker tag sellflow:current sellflow:previous && echo \"[deploy] tagged the running image as sellflow:previous\"; else echo \"[deploy] first deploy: no sellflow:current to tag\"; fi; gunzip | docker load")"

# --- 3. copy the two deployment files, nothing else -------------------------
# A tar of exactly these two paths: no rsync, no --delete, no other file in the
# checkout can reach the server this way.
log "Copying the compose file and Caddyfile"
run_remote "mkdir -p $DEPLOY_DIR"
run_shell "tar -C deploy -cf - docker-compose.staging.yml Caddyfile | ssh $(q "$SSH_TARGET") $(q "tar -C $DEPLOY_DIR -xf -")"

# --- 4. migrate --------------------------------------------------------------
# Runs as uid 1001 over the same mount the app uses, before the new code starts.
log "Applying migrations"
if ! run_remote "docker run --rm -v $REMOTE_ROOT/data:/app/data sellflow:migrator"; then
  warn "migration failed. The migrator runs as uid 1001: check that $REMOTE_ROOT/data"
  warn "exists and is owned by 1001:1001 (runbook section 1). Nothing was restarted."
  exit 1
fi

# --- 5. recreate the app -----------------------------------------------------
log "Recreating the app container"
if ! run_remote "cd $APP_DIR && ${COMPOSE} up -d --force-recreate app"; then
  warn "compose could not recreate the app. The previous container is still tagged"
  warn "sellflow:previous; see the rollback commands in the health-check failure below."
  exit 1
fi

# --- 6. health gate ----------------------------------------------------------
log "Waiting for ${HEALTH_URL} (timeout ${HEALTH_TIMEOUT}s)"
if [ "$EXECUTE" = 1 ]; then
  waited=0
  code="000"
  while [ "$waited" -lt "$HEALTH_TIMEOUT" ]; do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$HEALTH_URL" || true)"
    [ "$code" = "200" ] && break
    sleep 3
    waited=$((waited + 3))
  done
  if [ "$code" != "200" ]; then
    warn "last response from ${HEALTH_URL}: HTTP ${code}"
    cat >&2 <<EOF

Roll back on the host (nothing here is automatic):

  ssh ${SSH_TARGET} 'docker tag sellflow:previous sellflow:current'
  ssh ${SSH_TARGET} 'cd ${APP_DIR} && ${COMPOSE} up -d --force-recreate app'
  curl -s -o /dev/null -w '%{http_code}\\n' ${HEALTH_URL}   # expect 200

Migrations are forward-only: if this deploy added one, also restore the
pre-deploy backup (runbook, "Restore a backup").
EOF
    die "health check never returned 200"
  fi
  note "health 200"
  curl -s --max-time 5 "$HEALTH_URL" | head -c 300 || true
  echo
else
  note "would poll until HTTP 200, else print the rollback commands and exit 1"
fi

# --- 7. startup warnings -----------------------------------------------------
log "Startup lines from the new container (empty is good)"
run_remote "cd $APP_DIR && ${COMPOSE} logs --tail 50 app 2>&1 | grep '\\[startup\\]' || true"

log "Done: $(git rev-parse --short HEAD) on ${NEXT_PUBLIC_APP_URL}"