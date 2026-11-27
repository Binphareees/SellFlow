# Staging runbook

Staging is `https://staging.sellflow.shop`, served by Caddy in
`deploy/Caddyfile` from `deploy/docker-compose.staging.yml`. The app container
publishes **no host port**; Caddy is the only published surface and the only
trusted proxy the app accepts.

Two drills back this document:

- **Restore (T6, 2026-11-27):** migrate, start, register through the API, seed
  the pilot pair, back up, delete the database, restore, start again, sign in.
- **Proxy and compose (T7, 2026-11-28):** the real Caddyfile in front of the
  real image, forged proxy headers, registration throttling, a second source
  address, the unset-secret case, security headers and an unpublished port.

Both ran on one host bind mount (`/srv/sellflow/data:/app/data`). Anything not
executed is listed under **UNVERIFIED** at the end.

## 0. Prerequisites

- Docker 24+ with a reachable daemon and Compose v2, on the staging host.
- A public IPv4 address for the host and control of the `sellflow.shop` DNS zone.
- A placeholder-free env file derived from `.env.production.example`.
- **HTTPS is mandatory.** In production the session cookie is set with
  `Secure; HttpOnly; SameSite=Lax`, so a browser will not store it over plain
  HTTP and nobody can sign in. Caddy obtains the certificate; do not hand out an
  `http://` URL.

## 1. Host layout

One directory tree, three paths. Everything addresses the same bind mount, so
the database the app writes is the file the backup reads.

| Path | Owner | Mode | Holds |
| --- | --- | --- | --- |
| `/srv/sellflow/app` | operator | 0755 | git checkout, `.env.production`, `pilot-pair.json` |
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
database file". (A root-owned `/srv/sellflow/data` is exactly what the T7 drill
hit when Docker auto-created the path; the app stayed unhealthy until the
`chown` above was applied.)

Keep the env file owned by the operator and mode 0600 — the `docker` CLI reads
it as you, not as uid 1001. In the T6 drill an env file inside the chowned tree
became unreadable and `docker run --env-file` failed with "permission denied".

## 2. DNS — UNVERIFIED

Before Caddy can get a certificate, `staging.sellflow.shop` must resolve to this
host. At the DNS provider:

| Type | Name | Value | TTL |
| --- | --- | --- | --- |
| A | `staging` | the host's public IPv4 | 300 |
| AAAA | `staging` | the host's public IPv6, only if the host really serves it | 300 |

```bash
dig +short A staging.sellflow.shop      # must be the host's address
dig +short AAAA staging.sellflow.shop   # empty is fine; a stale AAAA breaks ACME
```

Nothing was created in this drill: there is no staging host and no zone access
here. Caddy retries certificate issuance on its own, but a wrong or missing
record means no HTTPS, which means no sign-in.

## 3. Firewall — UNVERIFIED

Expose only SSH, HTTP and HTTPS. Caddy needs 80 for the ACME HTTP challenge and
the redirect, and 443 for traffic; the app port is never published.

```bash
sudo ufw default deny incoming
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status numbered
```

Do not open 3000. `deploy/docker-compose.staging.yml` gives the app no `ports:`
entry, so there is nothing on the host to open.

## 4. Build the images

`NEXT_PUBLIC_*` values are compiled into the browser bundle, so the public URL
must be passed at **build** time as well as set in the env file:

```bash
cd /srv/sellflow/app
git fetch && git checkout main && git pull
docker tag sellflow:current sellflow:previous || true   # first deploy: nothing to tag
docker build \
  --build-arg NEXT_PUBLIC_APP_URL=https://staging.sellflow.shop \
  --build-arg NEXT_PUBLIC_APP_NAME=SellFlow \
  -t sellflow:current .
docker build --target migrator -t sellflow:migrator .
docker build --target pilot -t sellflow:pilot .
```

`sellflow:current` is the runtime the compose file references.
`sellflow:pilot` is not the runtime: the runner image has no Prisma CLI and no
`tsx`, and a host-side `npm run` cannot open a `0600` database owned by uid 1001
(verified: `Error code 14: Unable to open the database file`). The seeder and
the backup script both run inside the pilot image, as uid 1001, over the same
mount.

## 5. Create the env file

```bash
cp .env.production.example /srv/sellflow/app/.env.production
chmod 600 /srv/sellflow/app/.env.production
openssl rand -base64 32          # SESSION_SECRET
openssl rand -hex 32             # TRUSTED_PROXY_SECRET
```

Values that must match this deployment:

| Key | Staging value |
| --- | --- |
| `NODE_ENV` | `production` |
| `PORT` | `3000` |
| `DATABASE_URL` | `file:/app/data/prod.db` (absolute **inside** the container) |
| `SESSION_SECRET` | 32 random bytes, base64 |
| `NEXT_PUBLIC_APP_URL` | `https://staging.sellflow.shop` (also a build arg) |
| `APP_ORIGIN` | `https://staging.sellflow.shop` |
| `SITE_ADDRESS` | `https://staging.sellflow.shop` |
| `TRUSTED_PROXY_SECRET` | 32 random bytes, hex — the same value Caddy sends |

The relative `DATABASE_URL` from the template (`file:./data/prod.db`) resolves
against `/app/prisma`, not the mount, and the health check then answers 503.
`APP_ORIGIN` is the CSRF origin check and the source of absolute URLs.

`TRUSTED_PROXY_SECRET` is not optional here. `deploy/Caddyfile` sends it as
`x-sellflow-trusted-proxy`, the app ignores all forwarding headers unless it
matches, and the compose file refuses to start when the value is empty. Both
containers read this one file, so they cannot drift.

```bash
docker compose --env-file .env.production \
  -f deploy/docker-compose.staging.yml config >/dev/null   # validates the values
```

## 6. Migrations (before the first start, and after every deploy)

```bash
docker run --rm \
  -v /srv/sellflow/data:/app/data \
  sellflow:migrator
```

Expect `All migrations have been successfully applied.` and a `prod.db` owned by
1001 in `/srv/sellflow/data`.

## 7. Start the stack

Run from the checkout root: `--env-file` supplies `SITE_ADDRESS` and
`TRUSTED_PROXY_SECRET` to Caddy, while the app reads the same file through its
`env_file:` entry.

```bash
cd /srv/sellflow/app
docker compose --env-file .env.production \
  -f deploy/docker-compose.staging.yml up -d
docker compose --env-file .env.production \
  -f deploy/docker-compose.staging.yml ps
```

Caddy waits for the app's `HEALTHCHECK` before starting, so a 502 in the first
minute is normal and a stack that stays unhealthy is not.

## 8. Verify the deployment

Through the proxy — the only path that exists:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://staging.sellflow.shop/api/health  # 200
curl -s https://staging.sellflow.shop/api/health | head -c 400   # status ok, email.configured
docker compose --env-file .env.production -f deploy/docker-compose.staging.yml \
  logs app 2>&1 | grep '\[startup\]'                              # must print nothing
docker compose --env-file .env.production -f deploy/docker-compose.staging.yml \
  exec app id                                                    # uid=1001
```

`/api/health` returns 503 when the database is unreachable, and
`email.configured: false` when the `RESEND_*` keys are missing or malformed.

Both startup warnings are actionable and name no variable:

- `[startup] Email is not configured…` — password-reset mail will fail.
- `[startup] No trusted proxy is configured…` — IP throttling is off.

Security headers come from the app (`next.config.ts`), not from Caddy, and each
appears exactly once end to end:

```bash
curl -sD - -o /dev/null https://staging.sellflow.shop/api/health |
  grep -ic '^content-security-policy:'
# repeat for strict-transport-security, x-frame-options,
# x-content-type-options, referrer-policy, permissions-policy — each must be 1
```

Browser check of the production CSP, service worker and fonts:

```bash
BASE_URL=https://staging.sellflow.shop npm run verify:csp
```

Caddy logs one warning at boot:
`Unnecessary header_up X-Forwarded-For: the reverse proxy's default behavior is
to pass headers to the upstream`. It is expected and harmless: the directive is
required, because deleting the header instead leaves the app with **no** client
address at all (verified). The upstream receives the proxy's own peer address and
nothing the client sent.

Caddy matches on `Host`. A request to `https://<host-ip>/api/health` instead of
the domain gets Caddy's empty default site, not the app.

## 9. Resend domain verification — UNVERIFIED

Password reset sends through Resend, and Resend refuses a sender on a domain it
has not verified. In the Resend dashboard, add `sellflow.shop` and publish the
records it shows:

| Record | Purpose |
| --- | --- |
| `TXT` SPF on the sending domain (`v=spf1 include:…`) | authorises Resend to send |
| `TXT`/`CNAME` DKIM selectors | signs the mail |
| optional `MX`/`TXT` on the bounce subdomain | receives bounces |

Wait until the dashboard says **Verified** before testing — propagation is
usually minutes but can take hours. Then set, in `.env.production`:

```
RESEND_FROM_EMAIL=SellFlow Security <security@sellflow.shop>
RESEND_REPLY_TO=support@sellflow.shop
RESEND_API_KEY=…
```

Docker's `--env-file` keeps quotes literally; Compose's `env_file:` parses them,
so write values unquoted either way. Restart the app, confirm
`/api/health` reports `email.configured: true` and no `[startup] Email…` line
appears, then request one password reset for a real mailbox.

No record was published and no live email was sent in this drill; only the
missing-configuration path was exercised.

## 10. Onboard the pilot pair

One supplier + one reseller, a 3–5 item catalogue and pre-approved agreements,
written in a single transaction. Passwords are bcrypt-hashed and never printed.

Create the config **with a umask of 077**, so the file is 0600 before it ever
holds a secret:

```bash
cd /srv/sellflow/app
(umask 077; touch pilot-pair.json)
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

## 11. Nightly backup

`scripts/backup-sqlite.mjs` copies the database with `VACUUM INTO` (a
transactionally consistent snapshot, not a byte copy of a live file), then:

- checks `PRAGMA integrity_check` on the copy;
- samples row counts on the live database before and after the copy and accepts
  the copy only when every count lands inside that window;
- writes the file mode `0600` in a `0700` directory;
- **deletes the copy and exits non-zero** if either check fails;
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

## 12. Restore a backup

Stop the app first. A restore replaces the file underneath a running server, and
any `prod.db-wal` / `prod.db-shm` left by the old database would be replayed into
the restored copy and corrupt it.

```bash
docker compose --env-file .env.production \
  -f deploy/docker-compose.staging.yml stop app

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

docker compose --env-file .env.production \
  -f deploy/docker-compose.staging.yml start app
curl -s https://staging.sellflow.shop/api/health | head -c 200   # status ok
```

Then sign in as a known account. The T6 drill signed in through the API after
the restore and `/api/auth/me` returned the same user, profile and workspace IDs
that existed before the backup.

**Do not skip the `-wal`/`-shm` removal.** This deployment currently runs SQLite
in `journal_mode=delete` (verified), so those files are normally absent — but
they appear if WAL is ever enabled or after a crash mid-write, and a stale
journal from the deleted database is exactly what makes a "restored" database
look corrupt. `rm -f` is harmless when they are not there.

To inspect a backup without touching production, point a scratch process at a
copy instead: `DATABASE_URL=file:/tmp/restored.db`.

## 13. Upgrade and roll back

Upgrade — image, then schema, then app:

```bash
cd /srv/sellflow/app
git fetch && git checkout main && git pull
docker tag sellflow:current sellflow:previous
docker build \
  --build-arg NEXT_PUBLIC_APP_URL=https://staging.sellflow.shop \
  --build-arg NEXT_PUBLIC_APP_NAME=SellFlow \
  -t sellflow:current .

docker compose --env-file .env.production -f deploy/docker-compose.staging.yml stop app
docker run --rm -v /srv/sellflow/data:/app/data sellflow:migrator
docker compose --env-file .env.production -f deploy/docker-compose.staging.yml \
  up -d --force-recreate app
docker compose --env-file .env.production -f deploy/docker-compose.staging.yml \
  logs --tail 20 app 2>&1 | grep '\[startup\]' || true
```

Roll back the code by re-pointing the tag — Caddy and its certificate volumes
keep running:

```bash
docker tag sellflow:previous sellflow:current
docker compose --env-file .env.production -f deploy/docker-compose.staging.yml \
  up -d --force-recreate app
curl -s -o /dev/null -w '%{http_code}\n' https://staging.sellflow.shop/api/health   # 200
```

Migrations are forward-only: a rollback restores the code, not the schema. If the
bad deploy added a migration, restore the pre-deploy backup from §12 as well.

## 14. Offsite copy — UNVERIFIED

**A backup on the same disk is not a backup.** `/srv/sellflow/backups` lives on
the same volume as `/srv/sellflow/data`: a disk failure, a ransomware run, or a
mistyped `rm -rf` takes the database and every backup together. Copy each new
backup off the host, to storage the host cannot delete.

Sketch, not executed:

```bash
restic -r s3:... backup /srv/sellflow/backups
rclone copy /srv/sellflow/backups remote:sellflow-$(date -u +%Y-%m)
```

Whichever you use, it must:

- run after the nightly backup and only on files that passed validation;
- keep at least the same 14-day window as the local directory;
- be readable back **by you**, at least once, into a scratch directory — an
  offsite copy nobody has ever restored is a hope, not a backup.

The destination, its credentials and its retention are operator decisions;
nothing in this repository configures them.

## 15. What the drills proved

**T6 restore drill (2026-11-27)**, in `/tmp/t6-restore-drill`:

1. `chown 1001:1001` on the mount, then `migrate deploy`:
   `All migrations have been successfully applied.`
2. App started on the mount; `/api/health` 200.
3. `POST /api/auth/register` 201, creating a user, profile and workspace.
4. `pilot:seed --yes`: 3 listings, 3 ACTIVE agreements.
5. `backup:db`: 688128-byte copy, `integrity_check: ok`, counts `User 3,
   Profile 3, Product 3, ProductListing 3, AuditLog 6`, file `-rw-------`,
   directory `drwx------`.
6. Container stopped, `prod.db` and `-wal`/`-shm` deleted, backup copied in.
7. Container started: health 200, login 200, `/api/auth/me` returned the same
   IDs, and the seeder again refused the existing pilot emails.

**T7 proxy drill (2026-11-28)**, in `/tmp/t7-drill`, same images, real
`deploy/Caddyfile`, `SITE_ADDRESS=http://localhost:8080`, `MAX_REGISTRATION_IP_ATTEMPTS=2`:

1. **Forged headers are replaced.** A probe upstream behind the real Caddyfile
   received `x-sellflow-trusted-proxy: t7secret` (client sent `forged-value`),
   `x-forwarded-for: 172.21.0.1` (client sent `198.51.100.77`), and **no**
   `x-real-ip` (client sent `203.0.113.5`).
2. **Throttling counts the real address.** From `172.21.0.101`, each request
   forged a *different* `x-forwarded-for`: 201, 201, then **429 with
   `Retry-After: 899`** on the N+1th. The stored keys were
   `sha256("ip:172.21.0.101:<session-secret>")` with `failures=2, lockedUntil`
   set, and `sha256("ip:172.21.0.102:…")` with `failures=1` — no row for the
   forged address. The second address was simulated with a second client
   container pinned to a different static IP on the same compose network
   (`--network sellflow-staging_default --ip 172.21.0.102`); it reused the
   forged `198.51.100.77` and still got 201.
3. **No secret, no throttling.** A second stack with `TRUSTED_PROXY_SECRET`
   unset answered 201 to four registrations from one address (limit 2) and wrote
   zero throttle rows, and the app logged
   `[startup] No trusted proxy is configured…`.
4. **Headers survive the proxy.** `/api/health` through Caddy: 200, and CSP,
   HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy and
   Permissions-Policy each appeared exactly once.
5. **Port 3000 is not published.** `docker inspect` reported
   `{"3000/tcp":null}`, `docker port` printed nothing, and only Caddy had a host
   mapping. `app:3000` is reachable from another container on the compose
   network, so the listener exists and the publish is what is absent.

## UNVERIFIED

- Real DNS: no A/AAAA record was created (§2).
- Real TLS issuance: the drill used `http://localhost:8080`, no certificate was
  requested. `Secure` cookie behaviour over HTTPS was not re-run (T6 verified the
  cookie flags on `http://127.0.0.1:3002`).
- Firewall rules: nothing was applied (§3).
- Resend domain verification, SPF/DKIM records and a live password-reset email
  (§9). Only the missing-config path was exercised.
- Cron installation. The backup command was run by hand; the cron line was not
  installed or triggered.
- The offsite copy in §14: nothing was configured, run or restored.
- `verify:csp` against HTTPS (it was last run on `http://127.0.0.1:3002`).
- Multi-host or load-balanced deployment: SQLite, one bind mount and one trusted
  proxy hop assume one instance on one host with a local filesystem.
- Restore of a physically corrupt database: the drill deleted a healthy file and
  restored a validated copy; integrity checking catches a bad copy at backup
  time, it does not repair a corrupt source.