# syntax=docker/dockerfile:1
#
# Build from the repository root, not from apps/web:
#   docker build -f apps/web/Dockerfile \
#     --build-arg PUBLIC_API_URL=https://beacon.example.com/api -t beacon-web .
#
# PUBLIC_API_URL is a RUNTIME environment variable. `src/lib/api/client.ts` reads it
# from `$env/dynamic/public`, which SvelteKit compiles to a standalone `_app/env.js`
# the shell imports on load — so the entrypoint rewrites that one file and the same
# published image serves any installation. The build arg below only sets the fallback
# baked in for a container started without the variable.

ARG NODE_VERSION=24-bookworm-slim
ARG NGINX_VERSION=1.29-alpine

FROM node:${NODE_VERSION} AS builder
ENV CI=true ELECTRON_SKIP_BINARY_DOWNLOAD=1
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/config/package.json packages/config/
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/desktop/package.json apps/desktop/

# The web build needs its scripts: `svelte-kit sync` runs from `prepare`, and Vite
# needs esbuild's postinstall. @beacon/shared's own `prepare` (tsc) is allowed to fail
# here — its sources arrive in the next layer and `web build` compiles it explicitly.
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter web... || \
    pnpm install --frozen-lockfile --ignore-scripts --filter web...

COPY packages ./packages
COPY apps/web ./apps/web

# Only the compile-time fallback; the entrypoint overrides it at start.
ARG PUBLIC_API_URL=/api
ENV PUBLIC_API_URL=${PUBLIC_API_URL}
RUN pnpm --filter web build

FROM nginxinc/nginx-unprivileged:${NGINX_VERSION} AS runtime
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY apps/web/docker-entrypoint.sh /usr/local/bin/beacon-entrypoint.sh
# uid 101 is the unprivileged image's nginx user, and it has to be able to rewrite
# _app/env.js at start.
COPY --from=builder --chown=101:101 /app/apps/web/build /usr/share/nginx/html
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/beacon-entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD ["/bin/sh", "-c", "wget -qO- http://127.0.0.1:8080/health >/dev/null || exit 1"]
