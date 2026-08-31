# syntax=docker/dockerfile:1
#
# Build from the repository root, not from apps/api:
#   docker build -f apps/api/Dockerfile -t beacon-api .
#
# The pnpm workspace is the unit that installs — the api imports runtime values from
# @beacon/shared (DEFAULT_ROLES), so the image needs that package built, not just its
# types.

ARG NODE_VERSION=24-bookworm-slim

# ---------------------------------------------------------------------------
# builder — full workspace install, then compile shared + api to dist/
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS builder
ENV CI=true ELECTRON_SKIP_BINARY_DOWNLOAD=1
WORKDIR /app
RUN corepack enable

# Manifests before sources: this is the layer the dependency cache keys on, so a
# source-only change never reinstalls. Every workspace package's manifest is copied,
# including the desktop app's — `--frozen-lockfile` checks the lockfile against all
# of them, even though only the api's dependency graph is installed.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/config/package.json packages/config/
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/desktop/package.json apps/desktop/

# --ignore-scripts because @beacon/shared's `prepare` runs tsc and its sources are not
# in this layer yet; the build below compiles it explicitly. Nothing in the api's tree
# needs a native build — @node-rs/argon2 resolves a prebuilt binary for the platform.
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts --filter api...

COPY packages ./packages
COPY apps/api ./apps/api

# `api build` is `@beacon/shared build && nest build`.
RUN pnpm --filter api build

# ---------------------------------------------------------------------------
# runtime — production dependencies only, plus the two dist/ trees
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS runtime

# Links the published package to this repository, which is what lets GitHub show the
# source alongside the image and grants the workflow's GITHUB_TOKEN the right to push
# to it. metadata-action sets the same label in CI; having it here keeps a locally
# built image linked too.
LABEL org.opencontainers.image.source="https://github.com/Achneoder/beacon" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.title="beacon-api" \
      org.opencontainers.image.description="Beacon API — attendance, holidays, people and documents"

ENV CI=true ELECTRON_SKIP_BINARY_DOWNLOAD=1 NODE_ENV=production
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/config/package.json packages/config/
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/desktop/package.json apps/desktop/

# A second, --prod install rather than pruning the builder's: it is the only way to be
# sure no devDependency (the Nest CLI, typescript, vitest) reaches the shipped image.
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts --prod --filter api...

COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY apps/api/docker/migrate.mjs ./apps/api/docker/migrate.mjs

# MikroORM resolves `migrations.path` ('dist/migrations') relative to the working
# directory, so the process must start from the api package, not the repo root.
WORKDIR /app/apps/api
USER node

ENV PORT=3000
EXPOSE 3000

# /api/health is @Public() and reports the database connection — the same check the
# compose file and Traefik use.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"

CMD ["node", "dist/main.js"]
