# Staging runbook

Everything below was executed on 2026-11-27 against the built image
(`sellflow@sha256:3763498…`, `node .next/standalone/server.js`, SQLite on a
volume). Anything not executed is listed at the end as **UNVERIFIED**.

## 0. Prerequisites

- Docker 29 with a reachable daemon, on the staging host.
- A placeholder-free env file derived from `.env.production.example`.
- **HTTPS is mandatory.** In production the session cookie is set with
  `Secure; HttpOnly; SameSite=Lax`, so a browser will not store it over plain
  HTTP and nobody can sign in. Provision TLS (reverse proxy or host TLS) before
  handing the URL to testers.

## 1. Build the image and keep the current one for rollback

```bash
git fetch && git checkout main && git pull
docker tag sellflow:current sellflow:previous || true   # first deploy: nothing to tag
docker build -t sellflow:current .
docker build --target migrator -t sellflow:migrator .
```

## 2. Create the env file

Start from the template and fill every placeholder:

```bash
cp .env.production.example .env.production
chmod 600 .env.production
openssl rand -base64 32          # paste as SESSION_SECRET
```

Required keys (all read at runtime): `NODE_ENV=production`, `PORT=3000`,
`DATABASE_URL`, `SESSION_SECRET`, `NEXT_PUBLIC_APP_URL`, `APP_ORIGIN`,
`MAX_AUTH_ATTEMPTS`, `MAX_AUTH_IP_ATTEMPTS`, `MAX_REGISTRATION_IP_ATTEMPTS`,
`AUTH_ATTEMPT_WINDOW_SECONDS`, `AUTH_LOCKOUT_SECONDS`,
`AUTH_THROTTLE_RETENTION_SECONDS`, `AUTH_THROTTLE_MAX_ROWS`.

Two settings that cost a debugging cycle each:

- `DATABASE_URL` must be **absolute** inside the container:
  `DATABASE_URL=file:/app/data/prod.db`. The template's relative
  `file:./data/prod.db` resolves against `/app/prisma` and the health check then
  answers 503 with "Unable to open the database file".
- Set `APP_ORIGIN` to the exact public origin (`https://staging.example.com`).
  It is the CSRF origin check and the source of absolute URLs.

`.env.production.example` has **no email keys**. Add these or password reset
fails silently (`/api/health` then reports `email.configured: false`):

```
RESEND_FROM_EMAIL=SellFlow Security <security@your-domain>
RESEND_REPLY_TO=support@your-domain
RESEND_API_KEY=<provider key>
```

Docker's `--env-file` keeps quotes literally, so write values unquoted.

## 3. Run migrations (before starting the app, and after every deploy)

```bash
docker volume create sellflow-data
docker run --rm -v sellflow-data:/app/data sellflow:migrator
```

## 4. Start the app

```bash
docker run -d --name sellflow \
  --env-file .env.production \
  -p 3000:3000 \
  -v sellflow-data:/app/data \
  --restart unless-stopped \
  sellflow:current
```

The image runs as uid 1001 (`nextjs`), not root.

## 5. Verify the deployment

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/api/health   # 200
curl -s http://127.0.0.1:3000/api/health | head -c 400                      # status ok, email.configured
docker logs sellflow 2>&1 | grep '\[startup\]'                              # must print nothing
```

`/api/health` returns 503 when the database is unreachable, and
`email.configured: false` when the `RESEND_*` keys are missing or malformed; the
same condition logs one `[startup] Email is not configured…` line at boot.

Browser check of the production CSP, service worker and fonts:

```bash
BASE_URL=https://staging.example.com npm run verify:csp
```

## 6. Create tester accounts

Never use the demo seed in staging. Onboard real people with the pilot seeder,
which creates one supplier + one reseller, a 3–5 item catalogue and pre-approved
agreements, in one transaction, and prints nothing secret:

```bash
chmod 600 pilot-pair.json     # contains the two passwords; never commit it
npm run pilot:seed -- --config ./pilot-pair.json --dry-run   # review the plan
npm run pilot:seed -- --config ./pilot-pair.json --yes
```

Passwords may also come from `PILOT_SUPPLIER_PASSWORD` / `PILOT_RESELLER_PASSWORD`
instead of the file. They are bcrypt hashed and never echoed.

## 7. Nightly backup

`scripts/backup-sqlite.mjs` takes a consistent copy with `VACUUM INTO`, checks
`PRAGMA integrity_check` and compares row counts with the live database before
keeping the file, and prunes backups older than `BACKUP_RETENTION_DAYS`
(default 14).

Run it from a checkout on the host that can see the database file (bind mount
the data directory, e.g. `/srv/sellflow/data:/app/data`):

```bash
cd /srv/sellflow/app
DATABASE_URL=file:/srv/sellflow/data/prod.db \
BACKUP_DIR=/srv/sellflow/backups \
npm run backup:db
```

Cron line (installed by the operator, not by this repository):

```
15 2 * * * cd /srv/sellflow/app && DATABASE_URL=file:/srv/sellflow/data/prod.db BACKUP_DIR=/srv/sellflow/backups /usr/bin/npm run backup:db >> /srv/sellflow/backups/backup.log 2>&1
```

## 8. Restore a backup

```bash
docker stop sellflow
cp /srv/sellflow/backups/sellflow-YYYYMMDDTHHMMSSZ.db /srv/sellflow/data/prod.db
docker start sellflow
curl -s http://127.0.0.1:3000/api/health | head -c 200     # status ok, database up
```

To inspect a backup without touching production, point a scratch process at a
copy instead: `DATABASE_URL=file:/tmp/restored.db`.

## 9. Roll back to the previous image

```bash
docker stop sellflow && docker rm sellflow
docker run -d --name sellflow --env-file .env.production -p 3000:3000 \
  -v sellflow-data:/app/data --restart unless-stopped sellflow:previous
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/api/health   # 200
docker tag sellflow:previous sellflow:current                              # next deploy
```

Migrations are forward-only: a rollback restores the code, not the schema. If the
bad deploy added a migration, restore the pre-deploy backup from step 8 as well.

## UNVERIFIED

- HTTPS/TLS termination and the real staging hostname (no staging server exists
  yet); only the `Secure` cookie requirement itself was confirmed.
- Cron installation. The backup command was run by hand; the cron line above was
  not installed or triggered.
- Backups taken against a Docker named volume rather than a host bind mount.
- Real Resend delivery: only copy structure and the missing-config path were
  exercised; no live email was sent from staging.
- `verify:csp` against HTTPS (run against `http://127.0.0.1:3002`).
- Multi-host or load-balanced deployment: SQLite and the single volume assume one
  instance.
