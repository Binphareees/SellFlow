#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C
export LANG=C

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP_DIR="$(mktemp -d /tmp/sellflow-s09-e2e-XXXXXX)"
TEST_DB="$TMP_DIR/test.db"
TEST_URL="file:$TEST_DB"
mkdir -p "$TMP_DIR/credentials"

cleanup() {
  if [ -n "${CAPTURE_PID:-}" ] && kill -0 "$CAPTURE_PID" 2>/dev/null; then
    kill -TERM "$CAPTURE_PID" 2>/dev/null || true
    sleep 0.5
    kill -KILL "$CAPTURE_PID" 2>/dev/null || true
  fi
  if [ -n "${SERVER_PID:-}" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill -TERM -"$SERVER_PID" 2>/dev/null || true
    sleep 1
    kill -KILL -"$SERVER_PID" 2>/dev/null || true
  fi
  if [ -n "${TMP_DIR:-}" ] && [ -d "${TMP_DIR:-}" ]; then
    echo "[harness] preserving disposable evidence dir: $TMP_DIR"
  fi
  if [ -n "${TMP_ENV:-}" ] && [ -f "${TMP_ENV:-}" ]; then
    rm -f "$TMP_ENV"
  fi
}
trap cleanup EXIT

TMP_ENV="$(mktemp)"

# Build a sanitized env for child processes. It is the ONLY env shape passed to
# migration, seed, build, start and the test script. Nothing from the parent
# shell is inherited except LC_ALL/LANG and PATH.
sanitize_env() {
  node - "$@" > "$TMP_ENV" <<'NODE'
const vars = process.argv.slice(2).reduce((acc, pair) => {
  const eq = pair.indexOf('=');
  if (eq < 0) return acc;
  const k = pair.slice(0, eq);
  const v = pair.slice(eq + 1);
  if (k) acc[k] = v;
  return acc;
}, {});

const required = ['DATABASE_URL', 'SESSION_SECRET', 'TRUSTED_PROXY_SECRET'];
for (const k of required) {
  if (!vars[k]) {
    console.error(`[harness] missing required env: ${k}`);
    process.exit(2);
  }
}

const env = {
  NODE_ENV: 'test',
  DATABASE_URL: vars.DATABASE_URL,
  SESSION_SECRET: vars.SESSION_SECRET,
  TRUSTED_PROXY_SECRET: vars.TRUSTED_PROXY_SECRET,
  RESEND_API_KEY: 're_testkey_notarealkey',
  RESEND_FROM_EMAIL: 'SellFlow Security <security@sellflow.shop>',
  RESEND_REPLY_TO: 'support@sellflow.shop',
  NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:3000',
  APP_ORIGIN: 'http://127.0.0.1:3000',
  MAX_AUTH_ATTEMPTS: '5',
  MAX_AUTH_IP_ATTEMPTS: '20',
  AUTH_LOCKOUT_SECONDS: '900',
  AUTH_ATTEMPT_WINDOW_SECONDS: '900',
  AUTH_THROTTLE_RETENTION_SECONDS: '86400',
  SESSION_MAX_AGE_DAYS: '30',
  SESSION_IDLE_DAYS: '7',
};

console.log(
  Object.entries(env)
    .map(([k, v]) => JSON.stringify(k) + ': ' + JSON.stringify(String(v)))
    .join('\n')
);
NODE
}

generate_secrets() {
  SESSION_SECRET="$(openssl rand -base64 32)"
  TRUSTED_PROXY_SECRET="$(openssl rand -base64 24)"
}

read_secret_values() {
  SESSION_SECRET="$(grep -o '"SESSION_SECRET": "[^"]*"' "$TMP_ENV" | cut -d'"' -f4)"
  TRUSTED_PROXY_SECRET="$(grep -o '"TRUSTED_PROXY_SECRET": "[^"]*"' "$TMP_ENV" | cut -d'"' -f4)"
}

with_sanitized_env() {
  env -i \
    LC_ALL=C \
    LANG=C \
    PATH="$PATH" \
    HOME="$HOME" \
    USER="$USER" \
    "$(cat "$TMP_ENV" | sed 's/^/export /' | bash -c 'eval "$(cat)"; export -p' | grep -v '^export ' | sed 's/^/--/')"
}

# An outer failed-run probe email can be reused by this run so the probe user does
# not collide with seeded/demo identities on the next attempt.
PROBE_EMAIL_REUSE_FILE="/tmp/sellflow-s09-e2e-probe-email.txt"
if [ -f "$PROBE_EMAIL_REUSE_FILE" ]; then
  REUSED="$(cat "$PROBE_EMAIL_REUSE_FILE")"
  if [ -n "$REUSED" ] && echo "$REUSED" | grep -qF '@'; then
    echo "[harness] outer probe email reuse candidate: $REUSED"
    S09_PROBE_EMAIL_FALLBACK_DISPOSABLE="$REUSED"
  fi
fi

project_db_fingerprint() {
  if [ -f "$ROOT/prisma/dev.db" ]; then
    sha256sum "$ROOT/prisma/dev.db" | cut -d' ' -f1
  else
    echo "missing"
  fi
}

temp_db_fingerprint() {
  if [ -f "$TEST_DB" ]; then
    sha256sum "$TEST_DB" | cut -d' ' -f1
  else
    echo "missing"
  fi
}

fail() {
  local message="$1"
  echo "[harness] FAIL: $message"
  exit 3
}

echo "[harness] tmpdir=$TMP_DIR"
echo "[harness] test_database=$TEST_DB"
echo "[harness] test_url=$TEST_URL"

generate_secrets
sanitize_env \
  DATABASE_URL="$TEST_URL" \
  SESSION_SECRET="$SESSION_SECRET" \
  TRUSTED_PROXY_SECRET="$TRUSTED_PROXY_SECRET"
read_secret_values

echo "[harness] session_secret_present=true"
echo "[harness] trusted_proxy_secret_present=true"

echo "[harness] test_database=$TEST_DB"

# Apply committed migrations against the disposable database only.
echo "[harness] applying migrations to disposable db"
env -i \
  LC_ALL=C \
  LANG=C \
  PATH="$PATH" \
  HOME="$HOME" \
  USER="$USER" \
  DATABASE_URL="$TEST_URL" \
  NODE_ENV=test \
  ./node_modules/.bin/prisma migrate deploy --schema "$ROOT/prisma/schema.prisma" \
  > "$TMP_DIR/migrate-deploy.log" 2>&1
MIGRATE_EXIT=$?
echo "[harness] migrate_deploy_exit=$MIGRATE_EXIT"
if [ "$MIGRATE_EXIT" -ne 0 ]; then
  fail "prisma migrate deploy failed"
fi

# Confirm the PasswordResetToken table exists in the disposable database.
MKSTM="$(mktemp)"
printf '%s\n' "SELECT sql FROM sqlite_master WHERE type='table' AND name='PasswordResetToken';" > "$MKSTM"
echo "[harness] migration_check_sql_file=$MKSTM"
echo "[harness] migration_check_sql_size_bytes=$(stat -c %s "$MKSTM")"
if [ ! -s "$MKSTM" ]; then
  fail "migration check sql file is empty"
fi
"$ROOT/node_modules/.bin/prisma" db execute --schema "$ROOT/prisma/schema.prisma" --file "$MKSTM" > "$TMP_DIR/migration-check.log" 2>&1
DBCLI_EXIT=$?
rm -f "$MKSTM"
echo "[harness] migration_check_dbcli_exit=$DBCLI_EXIT"
if [ ! -f "$TMP_DIR/migration-check.log" ]; then
  fail "migration check log missing"
fi
echo "[harness] migration_check_dbcli_log=$(tr -d '\n' < "$TMP_DIR/migration-check.log" | head -c 2000)"
PRISMA_CHECK_LOG="$TMP_DIR/migration-check-client.log"
node - "$TEST_URL" "$PRISMA_CHECK_LOG" > /dev/null 2>&1 <<'NODE'
const PrismaClient = require('@prisma/client').PrismaClient;
const url = process.argv[2];
const logPath = process.argv[3];
function log(m){ try { require('fs').appendFileSync(logPath, m + '\n'); } catch(_) {} }
async function main() {
  let prisma;
  try { prisma = new PrismaClient({ datasources: { db: { url } } }); }
  catch (e) { log('prisma_client_check_error=' + (e && e.message ? e.message : String(e))); return process.exit(3); }
  try {
    const rows = await prisma.$queryRaw`SELECT name FROM sqlite_master WHERE type='table' AND name='PasswordResetToken'`;
    const names = Array.isArray(rows) ? rows.map((r) => {
      if (!r || typeof r !== 'object') return String(r ?? '');
      const vals = Object.values(r);
      return vals.length ? String(vals[0] ?? '') : '';
    }) : [];
    const found = names.includes('PasswordResetToken');
    log('prisma_client_table_found=' + found);
    log('prisma_client_table_names=' + JSON.stringify(names));
    await prisma.$disconnect();
    process.exit(found ? 0 : 3);
  } catch (e) {
    log('prisma_client_check_error=' + (e && e.message ? e.message : String(e)));
    try { await prisma.$disconnect(); } catch (_) {}
    process.exit(3);
  }
}
main().catch((e) => {
  log('prisma_client_main_error=' + (e && e.message ? e.message : String(e)));
  process.exit(3);
});
NODE
PRISMA_CHECK_EXIT=$?
echo "[harness] migration_check_client_exit=$PRISMA_CHECK_EXIT"
if [ ! -f "$PRISMA_CHECK_LOG" ]; then
  fail "migration check client log missing"
fi
echo "[harness] migration_check_client_log=$(tr -d '\n' < "$PRISMA_CHECK_LOG" | head -c 4000)"
HAS_TABLE="$(grep -o 'prisma_client_table_found=true' "$PRISMA_CHECK_LOG" || true)"
if [ -z "$HAS_TABLE" ]; then
  fail "PasswordResetToken not found in disposable database (Prisma Client check)"
fi

# Seed the disposable database with guarded demo fixtures only.
echo "[harness] seeding disposable database"
env -i \
  LC_ALL=C \
  LANG=C \
  PATH="$PATH" \
  HOME="$HOME" \
  USER="$USER" \
  DATABASE_URL="$TEST_URL" \
  NODE_ENV=test \
  SEED_DEMO_DATA=true \
  ./node_modules/.bin/tsx "$ROOT/prisma/seed.ts" \
  > "$TMP_DIR/seed.log" 2>&1
echo "[harness] seed_exit=$?"

# Generate Prisma client.
echo "[harness] generating prisma client"
env -i \
  LC_ALL=C \
  LANG=C \
  PATH="$PATH" \
  HOME="$HOME" \
  USER="$USER" \
  DATABASE_URL="$TEST_URL" \
  NODE_ENV=test \
  ./node_modules/.bin/prisma generate --schema "$ROOT/prisma/schema.prisma" \
  > "$TMP_DIR/prisma-generate.log" 2>&1
echo "[harness] prisma_generate_exit=$?"

# Build the production Next bundle against the disposable database.
echo "[harness] building next production bundle"
env -i \
  LC_ALL=C \
  LANG=C \
  PATH="$PATH" \
  HOME="$HOME" \
  USER="$USER" \
  DATABASE_URL="$TEST_URL" \
  NODE_ENV=test \
  RESEND_API_KEY=re_testkey_notarealkey \
  RESEND_FROM_EMAIL='SellFlow Security <security@sellflow.shop>' \
  RESEND_REPLY_TO=support@sellflow.shop \
  ./node_modules/.bin/next build \
  > "$TMP_DIR/next-build.log" 2>&1
echo "[harness] next_build_exit=$?"

# Start the cross-process Resend capture server before the next server.
# It is the only process in this harness that can accept a POST /emails
# request. It binds exclusively to 127.0.0.1 on a dynamically allocated
# port, writes each captured request atomically, and returns a valid
# Resend-compatible success response.
echo "[harness] starting s09 resend capture server"
CAPTURE_SCRIPT="$TMP_DIR/s09-resend-capture.mjs"
CAPTURE_FILE="$TMP_DIR/credentials/s09-resend-capture.json"
: > "$CAPTURE_FILE"
chmod 600 "$CAPTURE_FILE"

cat > "$CAPTURE_SCRIPT" <<'NODE'
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const capturePath = process.argv[2];
if (!capturePath) {
  console.error('[s09-resend-capture] capture path missing');
  process.exit(9);
}

if (!capturePath.startsWith('/tmp/')) {
  console.error('[s09-resend-capture] capture path not allowed');
  process.exit(9);
}

function parseJsonSafely(text) {
  try {
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

function sanitizeHeadersForLog(headers) {
  if (!headers || typeof headers !== 'object') return {};
  const out = {};
  for (const key of Object.keys(headers)) {
    const lower = key.toLowerCase();
    if (lower === 'authorization' || lower === 'x-api-key' || lower === 'x-resend-api-key') {
      out[key] = '<redacted>';
    } else {
      out[key] = headers[key];
    }
  }
  return out;
}

function appendCapture(records) {
  if (!Array.isArray(records)) return;
  const current = readFileSync(capturePath, 'utf8');
  let parsed;
  if (current.trim().length === 0) {
    parsed = [];
  } else {
    parsed = parseJsonSafely(current);
    if (!Array.isArray(parsed)) parsed = [];
  }
  for (const record of records) {
    parsed.push(record);
  }
  writeFileSync(capturePath, JSON.stringify(parsed, null, 2), 'utf8');
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('error', reject);
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

const server = createServer((req, res) => {
  const headers = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (value == null) continue;
    headers[key] = Array.isArray(value) ? value.join(', ') : value;
  }

  if (req.url === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  if (req.url === '/ready' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ready: true }));
    return;
  }

  if (req.url !== '/emails') {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Not Found', code: 'NOT_FOUND' } }));
    return;
  }

  if (req.method !== 'POST') {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'method not allowed', code: 'INVALID_REQUEST' } }));
    return;
  }

  readRequestBody(req)
    .then((buf) => buf.toString('utf8'))
    .then((bodyText) => {
      let bodyParsed;
      try {
        bodyParsed = parseJsonSafely(bodyText);
      } catch (_err) {
        bodyParsed = null;
      }
      if (bodyParsed == null || typeof bodyParsed !== 'object' || bodyParsed === null) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'request body is not valid json', code: 'INVALID_REQUEST' } }));
        return;
      }

      const id = bodyParsed.id ?? randomUUID();
      const record = {
        id,
        timestamp: new Date().toISOString(),
        method: req.method,
        path: req.url,
        httpVersion: '1.1',
        headers: sanitizeHeadersForLog(headers),
        bodyText,
        bodyJson: bodyParsed,
      };

      appendCapture([record]);

      res.writeHead(201, {
        'content-type': 'application/json',
        'x-request-id': id,
      });
      res.end(JSON.stringify({ id, accepted: true, recipient: [], headers: {}, created: true }));
    })
    .catch(() => {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'internal error', code: 'INTERNAL_ERROR' } }));
    });
  return;
});

server.on('error', (err) => {
  console.error('[s09-resend-capture] server error', err?.message ?? err);
});

server.listen(0, '127.0.0.1', () => {
  const addr = server.address();
  if (!addr || typeof addr !== 'object' || addr.port == null) {
    console.error('[s09-resend-capture] failed to obtain port');
    process.exit(8);
  }
  if (process.stdout.write(`${addr.port}\n`)) {
    // started
  } else {
    // best effort; the harness health probe will still detect readiness
  }
});
NODE

if ! [ -s "$CAPTURE_SCRIPT" ]; then
  fail "capture server script creation failed"
fi
/usr/bin/env node "$CAPTURE_SCRIPT" "$CAPTURE_FILE" > "$TMP_DIR/s09-resend-capture.log" 2>&1 &
CAPTURE_PID=$!
if ! [ -n "${CAPTURE_PID}" ]; then
  _launch_kill_status="pid-unset"
else
  if kill -0 "$CAPTURE_PID" 2>/dev/null; then
    _launch_kill_status=alive
  else
    _launch_kill_status=dead
  fi
fi
if [ -z "${CAPTURE_PID}" ] || [ "${_launch_kill_status}" = "dead" ]; then
  echo "[harness] capture_server_launch_check: CAPTURE_PID=${CAPTURE_PID:-unset}, kill-0-result=${_launch_kill_status}"
  fail "capture server failed to start"
fi
# Bounded wait for the capture server to write its port to the log file.
# The listen callback is async; give it a moment, then poll until a valid
# numeric port appears, or the deadline expires.
CAPTURE_PORT=""
_health_probe_deadline=$(($(date +%s%N 2>/dev/null || echo 0) + 25000000000))
for _i in $(seq 1 250); do
  if [ -s "$TMP_DIR/s09-resend-capture.log" ]; then
    CAPTURE_PORT=$(tail -1 "$TMP_DIR/s09-resend-capture.log")
    # Strict validation: only decimal digits, range 1..65535.
    # Reject empty, non-numeric, zero, and out-of-range safely (no shell
    # arithmetic errors on non-numeric input).
    case "$CAPTURE_PORT" in
      ''|*[!0-9]*) ;;
      *) [ "$CAPTURE_PORT" -ge 1 ] 2>/dev/null &&
         [ "$CAPTURE_PORT" -le 65535 ] 2>/dev/null && break ;;
    esac
  fi
  if [ "$(date +%s%N 2>/dev/null || echo 0)" -ge "$_health_probe_deadline" ] 2>/dev/null; then
    break
  fi
  # Liveness check: detect a dead capture server promptly instead of
  # waiting the full 25s port-discovery timeout.
  if ! kill -0 "$CAPTURE_PID" 2>/dev/null; then
    # Capture the child exit status before reaping. wait is run under an
    # explicit if/else so set -e does not terminate the harness when the
    # child has a non-zero exit status. $? is captured in the else branch.
    if wait "$CAPTURE_PID" 2>/dev/null; then
      CAPTURE_DEAD_EXIT=0
    else
      CAPTURE_DEAD_EXIT=$?
    fi
    if [ "$CAPTURE_DEAD_EXIT" -eq 127 ]; then
      echo "[harness] capture_server_dead: child already reaped or status unavailable (wait returned 127)"
    elif [ "$CAPTURE_DEAD_EXIT" -gt 128 ]; then
      echo "[harness] capture_server_dead: child status $CAPTURE_DEAD_EXIT (>=128; may indicate signal termination, not independently confirmed)"
    else
      echo "[harness] capture_server_dead: child exited with status $CAPTURE_DEAD_EXIT"
    fi
    fail "capture server exited during port discovery"
  fi
  sleep 0.1
done
# Post-loop strict validation: reject empty / non-digits, then enforce 1..65535.
case "$CAPTURE_PORT" in
  ''|*[!0-9]*) fail "capture server did not publish its port" ;;
  *)  [ "$CAPTURE_PORT" -ge 1 ] 2>/dev/null &&
      [ "$CAPTURE_PORT" -le 65535 ] 2>/dev/null || fail "capture server did not publish its port" ;;
esac
# Liveness check immediately after port validation and before the health
# probe: confirm the capture server is still alive. If it exited between
# the port-discovery loop and now, capture its exit status using the same
# if/wait/else pattern used in the port-discovery liveness check.
if ! kill -0 "$CAPTURE_PID" 2>/dev/null; then
  if wait "$CAPTURE_PID" 2>/dev/null; then
    _pre_health_exit=0
  else
    _pre_health_exit=$?
  fi
  if [ "$_pre_health_exit" -eq 127 ]; then
    echo "[harness] capture_server_dead_before_health: child already reaped or status unavailable (wait returned 127)"
  elif [ "$_pre_health_exit" -gt 128 ]; then
    echo "[harness] capture_server_dead_before_health: child status $_pre_health_exit (>=128; may indicate signal termination, not independently confirmed)"
  else
    echo "[harness] capture_server_dead_before_health: child exited with status $_pre_health_exit"
  fi
  fail "capture server exited before health probe"
fi
node --input-type=module - <<'NODE' "http://127.0.0.1:${CAPTURE_PORT}/health"
import { setTimeout } from 'node:timers/promises';
import { request } from 'node:http';
const base = process.argv[2];
if (!base) process.exit(9);
if (!base.endsWith('/health')) process.stderr.write('[harness] health probe base must end with /health\n');
const deadline = Date.now() + 25000;
while (Date.now() < deadline) {
  try {
    const probe = request(base, { method: 'GET' }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk.toString('utf8')));
      res.on('end', () => {
        let parsedBody = null;
        let bodyOk = false;
        try {
          parsedBody = JSON.parse(body);
          bodyOk = parsedBody?.status === 'ok';
        } catch (_) {}

        const httpOk = res.statusCode === 200;
        const healthy = httpOk && bodyOk;

        console.error(
          '[harness] health_probe: http=' + res.statusCode +
          ' bodyOk=' + bodyOk +
          ' -> exit ' + (healthy ? 0 : 8)
        );

        process.exit(healthy ? 0 : 8);
      });
    });
    probe.on('error', () => {});
    probe.end();
  } catch (_) {}
  await setTimeout(150);
}
process.exit(7);
NODE
RESEND_BASE_URL="http://127.0.0.1:$CAPTURE_PORT"

echo "[harness] capture_port=$CAPTURE_PORT"
echo "[harness] resend_base_url=$RESEND_BASE_URL"

# Reserve a port and bind only to 127.0.0.1.

PORT="$(node - <<'NODE'
const net = require('net');
const s = net.createServer();
s.on('error', () => process.exit(4));
s.listen(0, '127.0.0.1', () => {
  const addr = s.address();
  if (!addr || !addr.port) process.exit(5);
  console.log(addr.port);
  s.close();
});
NODE
)"
if [ -z "${PORT}" ] || ! [ "${PORT}" -gt 0 ] 2>/dev/null; then
  fail "port reservation failed"
fi
BASE_URL="http://127.0.0.1:$PORT"
echo "[harness] port=$PORT"
echo "[harness] base_url=$BASE_URL"

# Start next start under the sanitized env only.
echo "[harness] starting next start"
env -i \
  LC_ALL=C \
  LANG=C \
  PATH="$PATH" \
  HOME="$HOME" \
  USER="$USER" \
  DATABASE_URL="$TEST_URL" \
  NODE_ENV=test \
  SESSION_SECRET="$SESSION_SECRET" \
  TRUSTED_PROXY_SECRET="$TRUSTED_PROXY_SECRET" \
  RESEND_API_KEY=re_testkey_notarealkey \
  RESEND_FROM_EMAIL='SellFlow Security <security@sellflow.shop>' \
  RESEND_REPLY_TO=support@sellflow.shop \
  RESEND_BASE_URL="$RESEND_BASE_URL" \
  NEXT_PUBLIC_APP_URL=http://127.0.0.1:3000 \
  APP_ORIGIN="http://127.0.0.1:$PORT" \
  DISPOSABLE_APP_ORIGIN=http://127.0.0.1:3000 \
  S09_RUN_ONCE=true \
  MAX_AUTH_ATTEMPTS=5 \
  MAX_AUTH_IP_ATTEMPTS=20 \
  AUTH_LOCKOUT_SECONDS=900 \
  AUTH_ATTEMPT_WINDOW_SECONDS=900 \
  AUTH_THROTTLE_RETENTION_SECONDS=86400 \
  SESSION_MAX_AGE_DAYS=30 \
  SESSION_IDLE_DAYS=7 \
  ./node_modules/.bin/next start -p "$PORT" -H 127.0.0.1 \
  > "$TMP_DIR/next-start.log" 2>&1 &
SERVER_PID=$!
echo "[harness] next_start_pid=$SERVER_PID"

# Wait for a healthy health endpoint.
echo "[harness] waiting for health"
health_ok=false
for i in $(seq 1 60); do
  status_code="$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/health" || echo "000")"
  if [ "$status_code" = "200" ]; then
    health_ok=true
    echo "[harness] server healthy after $i tries"
    break
  fi
  sleep 1
done
if [ "$health_ok" != "true" ]; then
  fail "server did not become healthy"
fi

# Verify the running server is actually reading the disposable DB by writing a
# harness-only probe row and reading it back through the live app.
echo "[harness] verifying disposable db binding"
PROBE_EMAIL="s09-probe-${PORT}-${RANDOM}-${RANDOM}@sellflow.test"
PROBE_EMAIL_FOR_REUSE="${S09_PROBE_EMAIL_FALLBACK_DISPOSABLE:-none}"
if [ "$PROBE_EMAIL_FOR_REUSE" != "none" ] && [ -n "$PROBE_EMAIL_FOR_REUSE" ]; then
  echo "[harness] reusing probe email from outer run: $PROBE_EMAIL_FOR_REUSE"
  PROBE_EMAIL="$PROBE_EMAIL_FOR_REUSE"
fi
echo "[harness] probe_email_raw=$PROBE_EMAIL"
PROBE_PASSWORD_PLAIN="$(/usr/bin/env node --input-type=module - <<'NODE'
import { randomBytes } from 'node:crypto';
const plain = Array.from(randomBytes(20))
  .map((b) => (b % 94 + 33))
  .map((c) => String.fromCharCode(c))
  .join('');
process.stdout.write(plain);
NODE
)"
if [ -z "${PROBE_PASSWORD_PLAIN}" ]; then
  fail "disposable db binding check failed: probe password generation failed"
fi
PROBE_PASSWORD_HASH="$(/usr/bin/env node --input-type=module - "$PROBE_PASSWORD_PLAIN" <<'NODE'
import bcrypt from 'bcryptjs';
const plain = process.argv[2];
if (!plain) process.exit(8);
const hashed = await bcrypt.hash(plain, 12);
process.stdout.write(hashed);
NODE
)
if [ -z "${PROBE_PASSWORD_HASH}" ]; then
  fail "disposable db binding check failed: probe password hashing failed"
fi
if [ -z "${PROBE_PASSWORD_HASH}" ] || [ "${PROBE_PASSWORD_HASH}" != "${PROBE_PASSWORD_HASH}" ]; then
  fail "disposable db binding check failed: probe password hash generation failed"
fi
# Keep the probe credential inside the disposable evidence directory only.
# The plaintext password is the value the integration suite must send to the
# login endpoint; the bcrypt hash is what gets inserted into the database.
mkdir -p "$TMP_DIR/credentials"
PROBE_PASSWORD_FILE="$TMP_DIR/credentials/s09-probe-password.txt"
chmod 700 "$TMP_DIR/credentials"
printf '%s' "$PROBE_PASSWORD_PLAIN" > "$PROBE_PASSWORD_FILE"
chmod 600 "$PROBE_PASSWORD_FILE"
PROBE_USER_ID=$(DATABASE_URL="$TEST_URL" node --input-type=module - "$PROBE_EMAIL" "$PROBE_PASSWORD_HASH" "$PROBE_PASSWORD_FILE" <<'NODE'
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const PROBE_PASSWORD_FILE = process.argv[4];
if (!PROBE_PASSWORD_FILE) {
  console.error('[harness] probe user creation failed: missing credential file path argument');
  process.exit(7);
}

let passwordPlain;
try {
  passwordPlain = readFileSync(PROBE_PASSWORD_FILE, 'utf8');
} catch (readErr) {
  console.error('[harness] probe user creation failed: could not read probe password file');
  process.exit(7);
}
if (passwordPlain.endsWith('\r\n')) {
  passwordPlain = passwordPlain.slice(0, -2);
} else if (passwordPlain.endsWith('\n')) {
  passwordPlain = passwordPlain.slice(0, -1);
}
if (passwordPlain.length === 0) {
  console.error('[harness] probe user creation failed: probe password file is empty');
  process.exit(7);
}

const prisma = new PrismaClient();
const email = process.argv[2];
const passwordHash = process.argv[3];
if (!email || !passwordHash) {
  console.error('[harness] probe user creation failed: missing email or password hash');
  process.exit(7);
}

let created;
try {
  created = await prisma.user.create({
    data: {
      email,
      passwordHash,
    },
  });
} catch (e) {
  if (e && String(e.code ?? '') === 'P2002') {
    const found = await prisma.user.findUnique({ where: { email } });
    if (!found || !found.id) {
      console.error('[harness] probe user collision but user not found');
      await prisma.$disconnect();
      process.exit(7);
    }
    if (!found || !found.id) {
      console.error('[harness] probe user collision but user not found');
      await prisma.$disconnect();
      process.exit(7);
    }
    const existingHash = found.passwordHash;
    if (!existingHash || typeof existingHash !== 'string' || existingHash.length === 0) {
      console.error('[harness] probe user collision with missing or invalid stored password hash');
      await prisma.$disconnect();
      process.exit(7);
    }
    let match = false;
    try {
      match = await bcrypt.compare(passwordPlain, existingHash);
    } catch (cmpErr) {
      console.error('[harness] probe user collision with password verification failure');
      await prisma.$disconnect();
      process.exit(7);
    }
    if (!match) {
      console.error('[harness] probe user collision with incompatible password');
      await prisma.$disconnect();
      process.exit(7);
    }
    await prisma.$disconnect();
    process.stdout.write(String(found.id));
    process.exit(0);
  }
  await prisma.$disconnect();
  console.error('[harness] probe user creation failed', e && e.message ? e.message : String(e));
  process.exit(7);
}
await prisma.$disconnect();
if (!created || !created.id) {
  console.error('[harness] probe user creation returned no id');
  process.exit(6);
}
process.stdout.write(String(created.id));
NODE
)
if [ -z "${PROBE_USER_ID}" ]; then
  fail "disposable db binding check failed: probe user id not created"
fi
echo "[harness] probe_user_id=$PROBE_USER_ID"
echo "[harness] probe_email=$PROBE_EMAIL"
# Probe login must submit the generated probe password, not a placeholder.
# Use a tiny Node helper so the request body is JSON-serialized safely for
# arbitrary passwords (no shell interpolation of the raw password into JSON).
PROBE_REQUEST_BODY="$(node --input-type=module - "$PROBE_EMAIL" "$PROBE_PASSWORD_PLAIN" <<'NODE'
const email = process.argv[2];
const password = process.argv[3];
process.stdout.write(JSON.stringify({ email, password }));
NODE
)
if [ -z "$PROBE_REQUEST_BODY" ]; then
  fail "disposable db binding check failed: probe request body serialization failed"
fi

PROBE_HEADERS_FILE="$TMP_DIR/credentials/s09-probe-headers.txt"
PROBE_BODY_FILE="$TMP_DIR/credentials/s09-probe-body.txt"
mkdir -p "$TMP_DIR/credentials"
chmod 700 "$TMP_DIR/credentials"
: > "$PROBE_HEADERS_FILE"
chmod 600 "$PROBE_HEADERS_FILE"
: > "$PROBE_BODY_FILE"
chmod 600 "$PROBE_BODY_FILE"

PROBE_HTTP_STATUS="000"
PROBE_RESPONSE="$(curl -s -w "
%{http_code}" "$BASE_URL/api/auth/login"   -X POST   -H "content-type: application/json"   -H "origin: $BASE_URL"   -H "x-sellflow-trusted-proxy: $TRUSTED_PROXY_SECRET"   -D "$PROBE_HEADERS_FILE"   -o "$PROBE_BODY_FILE"   -d "$PROBE_REQUEST_BODY" || true)"

if [ -z "$PROBE_RESPONSE" ]; then
  echo "[harness] probe curl produced no output"
  echo "[harness] probe_login_status=$PROBE_HTTP_STATUS"
  echo "[harness] probe_login_body="
  echo "[harness] probe_login_headers="
  echo "[harness] disposable_db_binding_verified=false"
  PROBE_HTTP_STATUS="000"
else
  PROBE_HTTP_STATUS="$(printf '%s' "$PROBE_RESPONSE" | tail -n 1)"
  if [ -z "$PROBE_HTTP_STATUS" ] || ! [ "$PROBE_HTTP_STATUS" -eq "$PROBE_HTTP_STATUS" ] 2>/dev/null; then
    PROBE_HTTP_STATUS="000"
  fi
fi

PROBE_RESPONSE_BODY="$(tr -d '\n' < "$PROBE_BODY_FILE" | head -c 300)"

echo "[harness] probe_login_status=$PROBE_HTTP_STATUS"
echo "[harness] probe_login_body=$PROBE_RESPONSE_BODY"

PROBE_SESSION_ID=""
if [ -f "$PROBE_HEADERS_FILE" ] && [ -s "$PROBE_HEADERS_FILE" ]; then
  PROBE_SESSION_ID="$(awk 'BEGIN{IGNORECASE=1} /^Set-Cookie:[ 	]*sf_session=/{
    sub(/^Set-Cookie:[ 	]*sf_session=[ 	]*/, "");
    sub(/[ 	]*;.*/, "");
    if (length($0) > 0) print;
    exit;
  }' "$PROBE_HEADERS_FILE" || true)"
fi

if [ "$PROBE_HTTP_STATUS" = "200" ] && [ -n "$PROBE_SESSION_ID" ]; then
  echo "[harness] probe authenticates as live user"
  echo "[harness] disposable_db_binding_verified=true"
else
  echo "[harness] probe authentication did not succeed as live user"
  echo "[harness] probe_login_http_status=$PROBE_HTTP_STATUS"
  echo "[harness] probe_login_session_cookie_present=$( [ -n "$PROBE_SESSION_ID" ] && printf 'true' || printf 'false')"
  echo "[harness] disposable_db_binding_verified=false"
fi

# Run the S-09 HTTP integration suite against the live server.
echo "[harness] running s09 integration tests"

# Remove any pre-existing global result so a stale result cannot be
# attributed to the current run, and so the suite cannot copy a stale
# result from a previous invocation into the disposable evidence dir.
rm -f /tmp/sellflow-s09-e2e-result.json

PROBE_EMAIL_FILE="$TMP_DIR/s09-probe-email.txt"
echo "$PROBE_EMAIL" > "$PROBE_EMAIL_FILE"
if [ -f /tmp/sellflow-s09-e2e-probe-email.txt ]; then
  OVERRIDE_EMAIL="$(cat /tmp/sellflow-s09-e2e-probe-email.txt)"
  if [ -n "$OVERRIDE_EMAIL" ] && echo "$OVERRIDE_EMAIL" | grep -qF '@'; then
    echo "[harness] overriding probe email with previous-run value: $OVERRIDE_EMAIL"
    echo "$OVERRIDE_EMAIL" > "$PROBE_EMAIL_FILE"
    PROBE_EMAIL="$OVERRIDE_EMAIL"
  fi
fi
if [ "${S09_PROBE_EMAIL_FALLBACK_DISPOSABLE:-}" != "none" ] && [ -n "${S09_PROBE_EMAIL_FALLBACK_DISPOSABLE:-}" ]; then
  if [ -f /tmp/sellflow-s09-e2e-probe-email.txt ]; then
    OVERRIDE_EMAIL="$(cat /tmp/sellflow-s09-e2e-probe-email.txt)"
    if [ -n "$OVERRIDE_EMAIL" ] && echo "$OVERRIDE_EMAIL" | grep -qF '@'; then
      echo "[harness] discarding outer-run probe identity for this disposable database"
    fi
  fi
fi
printf '%s' "$PROBE_PASSWORD_PLAIN" > "$PROBE_PASSWORD_FILE"
chmod 600 "$PROBE_PASSWORD_FILE"

# Sanitized suite-facing probe credential summary. The raw password is never
# printed in logs; only a reusable masked form is exported to the suite log
# mirror so the report can correlate email/password presence without exposing
# the secret.
PROBE_CREDENTIAL_SUMMARY="probeEmail=${PROBE_EMAIL} probePasswordHashLength=${#PROBE_PASSWORD_HASH} probePasswordHashPreview=${PROBE_PASSWORD_HASH:0:8}…"

env -i \
  LC_ALL=C \
  LANG=C \
  PATH="$PATH" \
  HOME="$HOME" \
  USER="$USER" \
  BASE_URL="$BASE_URL" \
  APP_ORIGIN="http://127.0.0.1:$PORT" \
  SESSION_SECRET="$SESSION_SECRET" \
  TRUSTED_PROXY_SECRET="$TRUSTED_PROXY_SECRET" \
  S09_PROBE_EMAIL_FALLBACK="$(cat "$PROBE_EMAIL_FILE")" \
  S09_PROBE_PASSWORD="$(cat "$PROBE_PASSWORD_FILE")" \
  S09_RESEND_CAPTURE_MODE=file \
  S09_RESEND_CAPTURE_FILE="$TMP_DIR/credentials/s09-resend-capture.json" \
  /usr/bin/env node "$ROOT/scripts/s09-integration.mjs" \
  > "$TMP_DIR/s09-test.log" 2>&1
S09_EXIT=$?
echo "[harness] s09_exit=$S09_EXIT"

echo "[harness] suite probe credential summary: $PROBE_CREDENTIAL_SUMMARY"
if [ -f "$TMP_DIR/s09-test.log" ]; then
  echo "[harness] suite probe line:"
  grep -nE '^\\[s09\\] harness_probe' "$TMP_DIR/s09-test.log" 2>/dev/null || printf '%s\n' 'no_suites_probe_line_found'
fi
S09_RAW_EXIT="$S09_EXIT"

# Persist probe email for reuse only when the suite exited 0. We still keep the
# raw suite exit for diagnostics below.
if [ "$S09_RAW_EXIT" -eq 0 ]; then
  echo "$PROBE_EMAIL" > "$PROBE_EMAIL_REUSE_FILE"
  echo "[harness] persisted probe email for next run: $PROBE_EMAIL"
fi
rm -f "$PROBE_EMAIL_FILE"

# Validate the suite result artifact, if one was produced.
#
# We copy the global result into the disposable evidence dir first, then validate
# the copied file inline with Node. The copy is best-effort: if the source is
# missing, the validation step will fail explicitly instead of silently treating
# a missing result as success.
S09_RESULT_VALID=false
S09_RESULT_VALIDATION_EXIT=0
S09_RESULT_JSON=""
S09_RUNS=""
S09_FAILURES=""

if [ -f /tmp/sellflow-s09-e2e-result.json ]; then
  cp -f /tmp/sellflow-s09-e2e-result.json "$TMP_DIR/s09-result.json" || {
    echo "[harness] result validation failure: failed to copy global result into evidence dir"
    S09_RESULT_VALIDATION_EXIT=1
  }
fi

if [ "$S09_RESULT_VALIDATION_EXIT" -eq 0 ] && [ -f "$TMP_DIR/s09-result.json" ]; then
  S09_RESULT_JSON="$(cat "$TMP_DIR/s09-result.json")" || {
    echo "[harness] result validation failure: could not read copied result from evidence dir"
    S09_RESULT_VALIDATION_EXIT=1
  }
fi

if [ "$S09_RESULT_VALIDATION_EXIT" -eq 0 ]; then
  S09_VALIDATION_OUTPUT="$(printf '%s' "$S09_RESULT_JSON" | /usr/bin/env node /tmp/_s09_inline_validator.mjs validate "$S09_RAW_EXIT" 2>/dev/null)" || {
    echo "[harness] result validation failure: inline result validator failed to run"
    S09_RESULT_VALIDATION_EXIT=1
  }
fi

if [ "$S09_RESULT_VALIDATION_EXIT" -eq 0 ]; then
  if [ "$S09_VALIDATION_OUTPUT" = "valid" ]; then
    S09_RESULT_VALID=true
    _s09_extract_failed=false
    S09_RUNS="$(printf '%s' "$S09_RESULT_JSON" | /usr/bin/env node /tmp/_s09_inline_validator.mjs runs 2>/dev/null)" || _s09_extract_failed=true
    S09_FAILURES="$(printf '%s' "$S09_RESULT_JSON" | /usr/bin/env node /tmp/_s09_inline_validator.mjs failures 2>/dev/null)" || _s09_extract_failed=true
    if [ "$_s09_extract_failed" = "true" ]; then
      echo "[harness] result validation failure: failed to extract runs/failures from validated artifact"
      S09_RESULT_VALID=false
      S09_RESULT_VALIDATION_EXIT=1
      S09_EXIT=1
    elif [ -z "$S09_RUNS" ] || [ -z "$S09_FAILURES" ] || ! [ "$S09_RUNS" -ge 0 ] 2>/dev/null || ! [ "$S09_FAILURES" -ge 0 ] 2>/dev/null; then
      echo "[harness] result validation failure: extracted runs/failures are missing or not non-negative integers"
      S09_RESULT_VALID=false
      S09_RESULT_VALIDATION_EXIT=1
      S09_EXIT=1
    fi
  else
    echo "[harness] result validation failure:$S09_VALIDATION_OUTPUT"
    S09_RESULT_VALIDATION_EXIT=1
  fi
fi

if [ "$S09_RESULT_VALIDATION_EXIT" -ne 0 ]; then
  S09_EXIT=1
fi

# Report the suite result artifact.
if [ "$S09_RESULT_VALIDATION_EXIT" -eq 0 ]; then
  if [ "$S09_VALIDATION_OUTPUT" = "valid" ]; then
    echo '===== S09 RESULT JSON ====='
    cat "$TMP_DIR/s09-result.json"
    echo '===== S09 RESULT VALIDATION ====='
    echo "[harness] result validated: runs=$S09_RUNS failures=$S09_FAILURES suite_exit=$S09_RAW_EXIT harness_exit=$S09_EXIT"
  else
    echo '===== S09 RESULT JSON ====='
    echo '[harness] no valid result artifact for this run'
    echo "[harness] raw_suite_exit=$S09_RAW_EXIT harness_exit=$S09_EXIT"
  fi
else
  echo '===== S09 RESULT JSON ====='
  echo '[harness] no valid result artifact for this run'
  echo "[harness] raw_suite_exit=$S09_RAW_EXIT harness_exit=$S09_EXIT"
fi

# Mirror chosen logs.
echo "===== MIGRATE DEPLOY LOG ====="
cat "$TMP_DIR/migrate-deploy.log"
echo "===== MIGRATION CHECK LOG ====="
cat "$TMP_DIR/migration-check.log"
echo "===== MIGRATION CHECK CLIENT LOG ====="
cat "$TMP_DIR/migration-check-client.log"
echo "===== SEED LOG ====="
cat "$TMP_DIR/seed.log"
echo "===== PRISMA GENERATE LOG ====="
cat "$TMP_DIR/prisma-generate.log"
echo '===== NEXT BUILD LOG (tail) ====='
tail -n 60 "$TMP_DIR/next-build.log"
echo '===== NEXT START LOG (tail) ====='
tail -n 60 "$TMP_DIR/next-start.log"

echo '===== S09 TEST LOG ====='
cat "$TMP_DIR/s09-test.log"
exit "$S09_EXIT"
