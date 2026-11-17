# syntax=docker/dockerfile:1
#
# SellFlow — production image (Next.js 15 App Router, standalone output).
#
# Build:  docker build -t sellflow:latest .
# Run:    docker compose up -d
#
# Four runtime/build stages plus a one-off pilot tool:
#   deps     -> full node_modules (cached on package-lock.json)
#   builder  -> prisma generate + next build (standalone output)
#   migrator -> small image with the Prisma CLI, used for `prisma migrate deploy`
#   runner   -> next server.js, non-root, SQLite on a named volume
#   pilot    -> full deps + source, for one-off real-user onboarding (not runtime)

# -----------------------------------------------------------------------------
# Stage 1 — deps: install once, cached on package-lock.json
# -----------------------------------------------------------------------------
FROM node:18-alpine AS deps
WORKDIR /app

# libc6-compat: glibc shim some native modules expect on musl.
# openssl: Prisma's query engine links against it on alpine.
RUN apk add --no-cache libc6-compat openssl

COPY package.json package-lock.json ./
# Full install: the builder needs typescript, prisma CLI and tsx.
RUN npm ci

# -----------------------------------------------------------------------------
# Stage 2 — builder: compile the app and generate the Prisma client
# -----------------------------------------------------------------------------
FROM node:18-alpine AS builder
WORKDIR /app

RUN apk add --no-cache libc6-compat openssl
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_* values are inlined into the browser bundle at build time, so
# branding has to be known here, not just at `docker run`.
ARG NEXT_PUBLIC_APP_URL=http://localhost:3000
ARG NEXT_PUBLIC_APP_NAME=SellFlow
ARG NEXT_PUBLIC_DEFAULT_CURRENCY=NGN
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_APP_NAME=$NEXT_PUBLIC_APP_NAME \
    NEXT_PUBLIC_DEFAULT_CURRENCY=$NEXT_PUBLIC_DEFAULT_CURRENCY

# The build never opens the database (every page that reads data is dynamic),
# but `prisma generate` wants a valid URL shape. The real URL is injected at
# runtime by compose and must point at the mounted volume.
ARG DATABASE_URL=file:/app/data/prod.db
ENV DATABASE_URL=$DATABASE_URL

# `npm run build` = prisma generate && next build (output: "standalone").
RUN npm run build

# -----------------------------------------------------------------------------
# Stage 3 — migrator: Prisma CLI + migrations, no app code
#
# Migrations cannot run from the runner image: the standalone trace bundles only
# what server.js imports, so the Prisma CLI is missing its own dependencies. This
# stage keeps the full install and is only pulled for the migrate step.
# -----------------------------------------------------------------------------
FROM deps AS migrator
WORKDIR /app
ENV NODE_ENV=production \
    DATABASE_URL=file:/app/data/prod.db

COPY prisma ./prisma
COPY package.json ./

# Own the mount point as uid 1001 so a fresh named volume is initialised with
# the same ownership the app container runs as.
RUN mkdir -p /app/data && chown 1001:1001 /app/data

USER 1001:1001
CMD ["npx", "prisma", "migrate", "deploy"]

# -----------------------------------------------------------------------------
# Stage 4 — pilot: one-off onboarding tool, never the app runtime
#
# Uses the full install (tsx + Prisma CLI) and the real source so the seeder can
# import src/lib/auth/password.ts and src/lib/money.ts directly. Run it against
# the same volume as the app:
#
#   docker compose --profile pilot run --rm pilot
#   docker compose --profile pilot run --rm \
#     -v "$PWD/pilot-pair.json:/app/pilot-pair.json:ro" pilot \
#     --config /app/pilot-pair.json --dry-run
# -----------------------------------------------------------------------------
FROM deps AS pilot
WORKDIR /app

ARG DATABASE_URL=file:/app/data/prod.db
ENV NODE_ENV=production \
    DATABASE_URL=$DATABASE_URL \
    HOME=/tmp \
    XDG_CACHE_HOME=/tmp/.cache

COPY prisma ./prisma
COPY src ./src
COPY scripts ./scripts
COPY tsconfig.json package.json ./

RUN npx prisma generate \
    && mkdir -p /app/data \
    && chown 1001:1001 /app/data

USER 1001:1001
ENTRYPOINT ["npx", "tsx", "scripts/seed-pilot.mjs"]

# -----------------------------------------------------------------------------
# Stage 5 — runner: minimal image, non-root, writable data volume only
# -----------------------------------------------------------------------------
FROM node:18-alpine AS runner
WORKDIR /app

RUN apk add --no-cache libc6-compat openssl \
    && addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 --ingroup nodejs nextjs

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DATABASE_URL=file:/app/data/prod.db

# Static assets are not part of the traced standalone bundle.
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# SQLite lives on a named volume; the app user must own it (uid 1001).
RUN mkdir -p /app/data && chown -R nextjs:nodejs /app/data

USER nextjs
EXPOSE 3000

# Same probe Grafana/Uptime will use; returns 503 when the database is down.
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health > /dev/null || exit 1

CMD ["node", "server.js"]
