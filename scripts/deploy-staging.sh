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
# --app-only ships and restarts just sellflow:current, for a change that touched
# no migration, no backup script and no Caddyfile. The migrator and pilot images
# must already be on the host; the script checks and refuses instead of guessing.
#
# Before migrating, the deploy backs up $REMOTE_ROOT/data/prod.db with the same
# command runbook section 12 documents, and stops if that backup fails: a
# migration is forward-only, so the backup has to exist first. A first deploy (no
# prod.db yet) prints that and carries on.
#
# Every ssh call keeps the connection alive (ServerAliveInterval=30,
# ServerAliveCountMax=6). ssh's default gives up after 45 silent seconds, which
# is shorter than streaming and loading the images takes on a slow link.
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
APP_ONLY=0
# One place for the keepalive options: every ssh below uses this array, and the
# two ssh calls inside pipelines interpolate the same flags as a string.
SSH_OPTS=(-o ServerAliveInterval=30 -o ServerAliveCountMax=6)

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
  --app-only   build and ship only sellflow:current; refuses unless
               sellflow:migrator and sellflow:pilot are already on the host
  --help, -h   this text

Environment: SSH_TARGET (required), NEXT_PUBLIC_APP_URL, NEXT_PUBLIC_APP_NAME,
REMOTE_ROOT, HEALTH_TIMEOUT, ALLOW_DIRTY, SKIP_BUILD — see the header.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --yes|-y) EXECUTE=1 ;;
    --dry-run) EXECUTE=0 ;;
    --app-only) APP_ONLY=1 ;;
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
# pipefail, not just -e: a pipeline that fails in the middle (a `docker save`
# that dies after a few bytes) still reports failure, so the script stops
# instead of loading a truncated stream and migrating on top of it.
run_shell() {
  printf '  [local] %s\n' "$1"
  [ "$EXECUTE" = 1 ] || return 0
  bash -o pipefail -c "$1"
}

# Prints a remote command string and runs it over ssh only with --yes.
run_remote() {
  printf '  [ssh]   %s\n' "$1"
  [ "$EXECUTE" = 1 ] || return 0
  ssh "${SSH_OPTS[@]}" "$SSH_TARGET" "$1"
}

# Prints a remote command string and writes its stdout into the named variable.
# A dry run leaves it empty, so callers read "unknown" as "may have changed".
remote_capture() {
  local name="$1" cmd="$2"
  printf '  [ssh]   %s\n' "$cmd"
  if [ "$EXECUTE" = 1 ]; then
    printf -v "$name" '%s' "$(ssh "${SSH_OPTS[@]}" "$SSH_TARGET" "$cmd" 2>/dev/null || true)"
  else
    printf -v "$name" '%s' ""
  fi
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

# --- 0c. --app-only reuses images this script does not ship ------------------
# The migrator applies the schema and the pilot image takes the pre-deploy
# backup. Checked before the build, so the refusal costs one round trip.
if [ "$APP_ONLY" = 1 ]; then
  log "Checking the images --app-only reuses on the host"
  if ! run_remote "docker image inspect sellflow:migrator sellflow:pilot >/dev/null 2>&1"; then
    die "--app-only ships only sellflow:current: sellflow:migrator and sellflow:pilot must already be on the host (run a full deploy first, runbook section 4)"
  fi
fi

# --- 1. build locally --------------------------------------------------------
if [ "$APP_ONLY" = 1 ]; then
  IMAGES="sellflow:current"
else
  IMAGES="sellflow:current sellflow:migrator sellflow:pilot"
fi

if [ "${SKIP_BUILD:-0}" = "1" ]; then
  warn "SKIP_BUILD=1 — reusing the local images ($IMAGES)"
else
  log "Building images"
  run_local docker build \
    --build-arg "NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}" \
    --build-arg "NEXT_PUBLIC_APP_NAME=${NEXT_PUBLIC_APP_NAME}" \
    --build-arg "NEXT_PUBLIC_DEFAULT_CURRENCY=${NEXT_PUBLIC_DEFAULT_CURRENCY}" \
    -t sellflow:current .
  if [ "$APP_ONLY" = 0 ]; then
    run_local docker build --target migrator -t sellflow:migrator .
    run_local docker build --target pilot    -t sellflow:pilot .
  else
    note "--app-only: not building sellflow:migrator / sellflow:pilot"
  fi
fi

# --- 2. tag the old image, then stream the new ones -------------------------
# The tag happens in the same remote shell, before `docker load` replaces the
# sellflow:current tag, so a rollback target always exists after the first
# deploy. The archive arrives on stdin: nothing is written to the host's disk.
log "Streaming the images (docker save | gzip | ssh | docker load)"
# The remote half runs under pipefail too: a short or corrupt archive makes
# `gunzip` fail, and without pipefail `docker load`'s own status would hide it.
remote_load="if docker image inspect sellflow:current >/dev/null 2>&1; then docker tag sellflow:current sellflow:previous && echo '[deploy] tagged the running image as sellflow:previous'; else echo '[deploy] first deploy: no sellflow:current to tag'; fi; gunzip | docker load"
# ssh joins its arguments with spaces and hands the result to the remote shell,
# so the remote command has to be one quoted argument: `bash -o pipefail -c
# '<script>'`, built by nesting q().
run_shell "docker save $IMAGES | gzip -1 | ssh ${SSH_OPTS[*]} $(q "$SSH_TARGET") $(q "bash -o pipefail -c $(q "$remote_load")")"

# --- 3. copy the two deployment files, nothing else -------------------------
# A tar of exactly these two paths: no rsync, no --delete, no other file in the
# checkout can reach the server this way.
log "Copying the compose file and Caddyfile"
run_remote "mkdir -p $DEPLOY_DIR"
# Caddy keeps its running config in memory and the Caddyfile is a read-only
# mount, so Docker never recreates the container for a changed file: only a
# reload picks it up. Checksum before and after the copy decides whether one is
# needed. `sha256sum`, or `shasum -a 256` on a host that has no coreutils.
caddy_sha_cmd="if [ -f $DEPLOY_DIR/Caddyfile ]; then { sha256sum $DEPLOY_DIR/Caddyfile 2>/dev/null || shasum -a 256 $DEPLOY_DIR/Caddyfile; } | cut -d' ' -f1; else echo absent; fi"
caddy_sha_before=""
remote_capture caddy_sha_before "$caddy_sha_cmd"
run_shell "tar -C deploy -cf - docker-compose.staging.yml Caddyfile | ssh ${SSH_OPTS[*]} $(q "$SSH_TARGET") $(q "tar -C $DEPLOY_DIR -xf -")"
caddy_sha_after=""
remote_capture caddy_sha_after "$caddy_sha_cmd"

RELOAD_CADDY=0
if [ "$EXECUTE" != 1 ]; then
  RELOAD_CADDY=1
  note "dry run: would reload Caddy only if the remote Caddyfile checksum changed"
elif [ -n "$caddy_sha_before" ] && [ "$caddy_sha_before" = "$caddy_sha_after" ]; then
  note "deploy/Caddyfile unchanged on the host (${caddy_sha_after}): Caddy keeps its running config"
else
  RELOAD_CADDY=1
  note "deploy/Caddyfile changed on the host (${caddy_sha_before:-unknown} -> ${caddy_sha_after:-unknown})"
fi

# --- 4. back up the database before the migration ---------------------------
# A migration is forward-only: re-pointing the image tag does not undo it. So the
# database that is about to be migrated is backed up first, with the same command
# the nightly job uses (runbook section 12). If that fails, stop here — the old
# code is still serving the old schema and nothing has been touched.
log "Backing up the database before migrating"
db_present=""
remote_capture db_present "test -f $REMOTE_ROOT/data/prod.db && echo yes || echo no"
if [ "$EXECUTE" = 1 ] && [ "$db_present" != "yes" ]; then
  note "no database at $REMOTE_ROOT/data/prod.db yet (first deploy) — nothing to back up"
else
  if ! run_remote "docker run --rm --entrypoint node -v $REMOTE_ROOT/data:/app/data -v $REMOTE_ROOT/backups:/app/backups -e BACKUP_DIR=/app/backups sellflow:pilot /app/scripts/backup-sqlite.mjs"; then
    warn "the pre-deploy backup failed. Nothing was migrated and no container was restarted;"
    warn "the running app is still on the old schema. Fix the backup (runbook section 12) first."
    exit 1
  fi
  if [ "$EXECUTE" = 1 ]; then
    note 'the pre-deploy backup is the "[backup] wrote …" line above; restore it with runbook section 13'
  fi
fi

# --- 5. migrate --------------------------------------------------------------
# Runs as uid 1001 over the same mount the app uses, before the new code starts.
log "Applying migrations"
if ! run_remote "docker run --rm -v $REMOTE_ROOT/data:/app/data sellflow:migrator"; then
  warn "migration failed. The migrator runs as uid 1001: check that $REMOTE_ROOT/data"
  warn "exists and is owned by 1001:1001 (runbook section 1). Nothing was restarted."
  exit 1
fi

# --- 6. recreate the app, then bring the whole stack up ----------------------
log "Recreating the app container"
if ! run_remote "cd $APP_DIR && ${COMPOSE} up -d --force-recreate app"; then
  warn "compose could not recreate the app. The previous container is still tagged"
  warn "sellflow:previous; see the rollback commands in the health-check failure below."
  exit 1
fi

# `up -d` with no service name starts Caddy on a first deploy and recreates it
# when the compose file changed. Recreating only `app` leaves a fresh host with
# nothing listening on 80/443 and an old Caddyfile in a running container.
log "Bringing the whole stack up (Caddy included)"
if ! run_remote "cd $APP_DIR && ${COMPOSE} up -d"; then
  warn "compose could not start the whole stack. The app container is up; check Caddy"
  warn "and deploy/docker-compose.staging.yml (runbook section 7)."
  exit 1
fi

# Caddy reads the mounted Caddyfile on reload without dropping connections.
# Verified in a real caddy:2 container (v2.11.9): `caddy reload --config
# /etc/caddy/Caddyfile` exits 0 and the new directive answers immediately, while
# an invalid file exits 1 and the running config keeps serving. That is why a
# failed reload is reported rather than followed by a restart: a restart of a
# broken Caddyfile takes the site down instead of leaving it on the old config.
if [ "$RELOAD_CADDY" = 1 ]; then
  log "Reloading Caddy"
  if ! run_remote "cd $APP_DIR && ${COMPOSE} exec -T caddy caddy reload --config /etc/caddy/Caddyfile"; then
    warn "Caddy refused the new Caddyfile and is still serving the previous config."
    warn "The app and its database are already on the new version; fix deploy/Caddyfile."
    exit 1
  fi
else
  note "Caddy not reloaded (its Caddyfile did not change)"
fi

# --- 7. health gate ----------------------------------------------------------
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

# --- 8. startup warnings -----------------------------------------------------
log "Startup lines from the new container (empty is good)"
run_remote "cd $APP_DIR && ${COMPOSE} logs --tail 50 app 2>&1 | grep '\\[startup\\]' || true"

log "Done: $(git rev-parse --short HEAD) on ${NEXT_PUBLIC_APP_URL}"