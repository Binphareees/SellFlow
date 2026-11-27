# Staging runbook

Everything below was executed on 2026-11-27 with the built images, against **one
host bind mount** (`/srv/sellflow/data:/app/data`). The drill in §9 ran end to
end: migrate, start, register through the API, seed the pilot pair, back up,
delete the database, restore, start again and sign in. Anything not executed is
listed at the end as **UNVERIFIED**.

## 0. Prerequisites

- Docker 24+ with a reachable daemon, on the staging host.
- A placeholder-free env file derived from `.env.production.example`.
- **HTTPS is mandatory.** In production the session cookie is set with
  `Secure; HttpOnly; SameSite=Lax`, so a browser will not store it over plain
  HTTP and nobody can sign in. Provision TLS (reverse proxy or host TLS) before
  handing the URL to testers.

## 1. Host layout

One directory tree, three paths. Everything in this runbook addresses the same
bind mount, so the database the app writes is the file the backup reads.

| Path | Owner | Mode | Holds |
| --- | --- | --- | --- |
| `/srv/sellflow/app` | operator | 0755 | git checkout, env file, `pilot-pair.json` |
| `/srv/sellflow/data` | `1001:1001` | 0750 | `prod.db` (the only writable mount) |
| `/srv/sellflow/backups` | `1001:1001` | 0700 | `sellflow-YYYYMMDDTHHMMSSZ.db` |

```bash
sudo mkdir -p /srv/sellflow/{data,backups}
sudo chown -R 1001:1001 /srv/sellflow/data /srv/sellflow/backups
sudo chmod 750 /srv/sellflow/data
sudo chmod 700 /srv/sellflow/backups
```

The images run as uid 1001 (`nextjs`), so that uid must own the data directory;
a root-owned directory makes the app answer 503 with "Unable to open the
database file". The drill performed this same `chown 1001:1001` through a root
container because the test user had no `sudo`.

Keep the env file itself owned by the operator and mode 0600 — the `docker` CLI
reads it as you, not as uid 1001. (In the drill, an env file inside the
chowned tree became unreadable and `docker run --env-file` failed with
"permission denied".)

## 2. Build the images

```bash
cd /srv/sellflow/app
git fetch && git checkout main && git pull
docker tag sellflow:current sellflow:previous || true   # first deploy: nothing to tag
docker build -t sellflow:current .
docker build --target migrator -t sellflow:migrator .
docker build --target pilot -t sellflow:pilot .          # seeder + backup, one-off only
```

`sellflow:pilot` is not the runtime. It exists because the runner image has no
Prisma CLI and no `tsx`, and because a host-side `npm run` cannot open a
`0600` database owned by uid 1001 (verified: `Error code 14: Unable to open the
database file`). Both operator tools run inside this image, as uid 1001, over
the same mount.

## 3. Create the env file

```bash
cp .env.production.example /srv/sellflow/app/.env.production
chmod 600 /srv/sellflow/app/.env.production
openssl rand -base64 32          # paste as SESSION_SECRET
```

Required keys (all read at runtime): `NODE_ENV=production`, `PORT=3000`,
`DATABASE_URL`, `SESSION_SECRET`, `NEXT_PUBLIC_APP_URL`, `APP_ORIGIN`,
`MAX_AUTH_ATTEMPTS`, `MAX_AUTH_IP_ATTEMPTS`, `MAX_REGISTRATION_IP_ATTEMPTS`,
`AUTH_ATTEMPT_WINDOW_SECONDS`, `AUTH_LOCKOUT_SECONDS`,
`AUTH_THROTTLE_RETENTION_SECONDS`, `AUTH_THROTTLE_MAX_ROWS`.

Two settings that cost a debugging cycle each:

- `DATABASE_URL` must be **absolute inside the container**:
  `DATABASE_URL=file:/app/data/prod.db`. The template's relative
  `file:./data/prod.db` resolves against `/app/prisma`, not the mount, and the
  health check then answers 503.
- Set `APP_ORIGIN` to the exact public origin (`https://staging.example.com`).
  It is the CSRF origin check and the source of absolute URLs.

The template ships the email keys commented out. Uncomment and fill all three,
or password reset silently sends nothing (`/api/health` then reports
`email.configured: false` and the boot log prints one
`[startup] Email is not configured…` line):

```
RESEND_FROM_EMAIL=SellFlow Security <security@your-domain>
RESEND_REPLY_TO=support@your-domain
RESEND_API_KEY=<provider key>
```

Docker's `--env-file` keeps quotes literally, so write values unquoted.

## 4. Migrations (before the first start, and after every deploy)

```bash
docker run --rm \
  -v /srv/sellflow/data:/app/data \
  sellflow:migrator
```

Expect `All migrations have been successfully applied.` and a `prod.db` owned by
1001 in `/srv/sellflow/data`.

## 5. Start the app

```bash
docker run -d --name sellflow \
  --env-file /srv/sellflow/app/.env.production \
  -p 3000:3000 \
  -v /srv/sellflow/data:/app/data \
  --restart unless-stopped \
  sellflow:current
```

## 6. Verify the deployment

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/api/health   # 200
curl -s http://127.0.0.1:3000/api/health | head -c 400                      # status ok, email.configured
docker logs sellflow 2>&1 | grep '\[startup\]'                              # must print nothing
docker exec sellflow id                                                     # uid=1001
```

`/api/health` returns 503 when the database is unreachable, and
`email.configured: false` when the `RESEND_*` keys are missing or malformed.

Browser check of the production CSP, service worker and fonts:

```bash
BASE_URL=https://staging.example.com npm run verify:csp
```

## 7. Onboard the pilot pair

One supplier + one reseller, a 3–5 item catalogue and pre-approved agreements,
written in a single transaction. The passwords are bcrypt-hashed and never
printed.

Create the config **with a umask of 077**, so the file cannot be read by other
users on the host even before you chmod it:

```bash
cd /srv/sellflow/app
(umask 077; touch pilot-pair.json)   # created 0600 before it ever holds a secret
chmod 600 pilot-pair.json
$EDITOR pilot-pair.json             # shape: npm run pilot:seed -- --help
# real people, real prices, real passwords, then:
docker run --rm \
  -v /srv/sellflow/data:/app/data \
  -v /srv/sellflow/app/pilot-pair.json:/app/pilot-pair.json:ro \
  sellflow:pilot --config /app/pilot-pair.json --dry-run
docker run --rm \
  -v /srv/sellflow/data:/app/data \
  -v /srv/sellflow/app/pilot-pair.json:/app/pilot-pair.json:ro \
  sellflow:pilot --config /app/pilot-pair.json --yes
```

The dry run prints the plan and writes nothing; the second command writes the
pair and prints only IDs. Re-running refuses an email that already exists, so it
is safe to retry. Passwords may instead come from `PILOT_SUPPLIER_PASSWORD` /
`PILOT_RESELLER_PASSWORD`.

## 8. Nightly backup

`scripts/backup-sqlite.mjs` copies the database with `VACUUM INTO` (a
transactionally consistent snapshot, not a byte copy of a live file), then:

- checks `PRAGMA integrity_check` on the copy;
- samples row counts on the live database before and after the copy and accepts
  the copy only when every count lands inside that window;
- writes the file mode `0600` in a `0700` directory;
- **deletes the copy and exits non-zero** if either check fails, so a bad backup
  is never left behind looking restorable;
- prunes backups older than `BACKUP_RETENTION_DAYS` (default 14), protecting the
  one just written.

Run it against the same mount, inside the pilot image:

```bash
docker run --rm --entrypoint node \
  -v /srv/sellflow/data:/app/data \
  -v /srv/sellflow/backups:/app/backups \
  -e BACKUP_DIR=/app/backups \
  sellflow:pilot /app/scripts/backup-sqlite.mjs
```

Cron line (installed by the operator, not by this repository):

```
15 2 * * * docker run --rm --entrypoint node -v /srv/sellflow/data:/app/data -v /srv/sellflow/backups:/app/backups -e BACKUP_DIR=/app/backups sellflow:pilot /app/scripts/backup-sqlite.mjs >> /var/log/sellflow-backup.log 2>&1
```

## 9. Restore a backup

Stop the container first. A restore replaces the file underneath a running
server, and any `prod.db-wal` / `prod.db-shm` left by the old database would be
replayed into the restored copy and corrupt it.

```bash
docker stop sellflow

# List the backups (the directory is 0700, so read it as uid 1001).
docker run --rm --entrypoint ls \
  -v /srv/sellflow/backups:/app/backups sellflow:pilot -l /app/backups

# Remove the database AND its journal files, then copy the chosen backup in.
docker run --rm --entrypoint sh \
  -v /srv/sellflow/data:/app/data \
  -v /srv/sellflow/backups:/app/backups \
  sellflow:pilot -c '
    rm -f /app/data/prod.db /app/data/prod.db-wal /app/data/prod.db-shm &&
    cp /app/backups/sellflow-YYYYMMDDTHHMMSSZ.db /app/data/prod.db &&
    chmod 600 /app/data/prod.db &&
    ls -la /app/data'

docker start sellflow
curl -s http://127.0.0.1:3000/api/health | head -c 200      # status ok, database up
```

Then sign in as a known account. The drill signed in through the API after the
restore and `/api/auth/me` returned the same user, profile and workspace IDs
that existed before the backup.

**Do not skip the `-wal`/`-shm` removal.** This deployment currently runs
SQLite in `journal_mode=delete` (verified), so those files are normally absent —
but they appear if WAL is ever enabled or after a crash mid-write, and a stale
journal from the deleted database is exactly what makes a "restored" database
look corrupt. `rm -f` is harmless when they are not there.

To inspect a backup without touching production, point a scratch process at a
copy instead: `DATABASE_URL=file:/tmp/restored.db`.

## 10. Offsite copy — UNVERIFIED

**A backup on the same disk is not a backup.** `/srv/sellflow/backups` lives on
the same volume as `/srv/sellflow/data`: a disk failure, a ransomware run, or a
mistyped `rm -rf` takes the database and every backup together. Copy each new
backup off the host, to storage the host cannot delete.

Sketch, not executed:

```bash
# Any of these; pick one and time it in a restore drill of its own.
restic -r s3:... backup /srv/sellflow/backups
rclone copy /srv/sellflow/backups remote:sellflow-$(date -u +%Y-%m)
```

Whichever you use, it must:

- run after the nightly backup and only on files that passed validation;
- keep at least the same 14-day window as the local directory;
- be readable back **by you**, at least once, into a scratch directory — an
  offsite copy nobody has ever restored is a hope, not a backup.

The offsite destination, its credentials and its retention are operator
decisions; nothing in this repository configures them.

## 11. Roll back to the previous image

```bash
docker stop sellflow && docker rm sellflow
docker run -d --name sellflow \
  --env-file /srv/sellflow/app/.env.production \
  -p 3000:3000 \
  -v /srv/sellflow/data:/app/data \
  --restart unless-stopped \
  sellflow:previous
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/api/health   # 200
docker tag sellflow:previous sellflow:current                              # next deploy
```

Migrations are forward-only: a rollback restores the code, not the schema. If
the bad deploy added a migration, restore the pre-deploy backup from §9 as well.

## 12. What the drill proved on 2026-11-27

Run in `/tmp/t6-restore-drill` (a stand-in for `/srv/sellflow`) with
`sellflow:pilot-t3`, `sellflow:pilot-t3-migrator` and `sellflow:pilot-t6`:

1. `chown 1001:1001` on the mount, then `migrate deploy`:
   `All migrations have been successfully applied.`, `prod.db` created.
2. App started on the mount; `/api/health` 200.
3. `POST /api/auth/register` 201, creating a user, profile and workspace.
4. `pilot:seed --yes` inside `sellflow:pilot` on the same mount: 3 listings,
   3 ACTIVE agreements.
5. `backup:db` inside `sellflow:pilot`: 688128-byte copy, `integrity_check: ok`,
   counts `User 3, Profile 3, Product 3, ProductListing 3, AuditLog 6`, file mode
   `-rw-------`, directory mode `drwx------`.
6. Container stopped, `prod.db` and its `-wal`/`-shm` deleted, backup copied in.
7. Container started: health 200, `POST /api/auth/login` 200,
   `/api/auth/me` returned the same user/profile/workspace IDs, and the seeder
   again refused the existing pilot emails — both the registered account and the
   seeded pair came back.

## UNVERIFIED

- HTTPS/TLS termination and the real staging hostname (no staging server exists
  yet); only the `Secure` cookie requirement itself was confirmed.
- Cron installation. The backup command was run by hand; the cron line above was
  not installed or triggered.
- The offsite copy in §10: nothing was configured, run or restored.
- Real Resend delivery: only copy structure and the missing-config path were
  exercised; no live email was sent from staging.
- `verify:csp` against HTTPS (run against `http://127.0.0.1:3002`).
- Multi-host or load-balanced deployment: SQLite and the single bind mount
  assume one instance, on one host, with a local filesystem (not NFS/SMB).
- Restore of a physically corrupt database: the drill deleted a healthy file and
  restored a validated copy. Integrity checking and row-count windows catch a bad
  copy at backup time; they do not repair a corrupt source.