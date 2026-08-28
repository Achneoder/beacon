# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Beacon is an attendance / time-tracking, holiday-planning, employee-data and document-storage
application for organizations. `README.md` holds the product spec; this file holds the working
rules.

The monorepo is green (build, lint, typecheck, unit tests, e2e). Authentication and organization
setup are implemented; attendance, holidays, employee data and documents are not.

## Layout

pnpm workspaces. `apps/*` and `packages/*` are the workspace globs.

```
apps/web         SvelteKit + Svelte 5 + Tailwind 4 — client-only SPA
apps/api         NestJS 12 (ESM) + MikroORM 6 + PostgreSQL
packages/shared  @beacon/shared — permissions, tenant types shared by both apps
packages/config  @beacon/config — shared tsconfig base
infra            docker-compose: postgres, MinIO, Prometheus/Loki/Alloy/Grafana
```

`apps/mobile` and `apps/desktop` are planned but not created; their frameworks are undecided.

## Commands

```bash
pnpm install
pnpm -r build | lint | typecheck | test        # whole workspace

pnpm --filter web dev                          # http://localhost:5173
pnpm --filter api start:dev                    # http://localhost:3000/api

# single test — BOTH apps use Vitest
pnpm --filter web test -- src/lib/api/client.test.ts
pnpm --filter api test -- permissions.guard.spec.ts
pnpm --filter api test -- -t "requires every declared permission"

pnpm --filter api test:e2e                     # brings up its own throwaway db, like `pnpm e2e`
pnpm e2e                                       # browser e2e: SPA + real API + real db
pnpm e2e:down                                  # drop the e2e containers and their data
pnpm --filter api mikro-orm migration:create   # add --initial for the first one
pnpm --filter api mikro-orm migration:up

pnpm infra:up                                  # postgres, minio, observability
pnpm infra:down
```

Copy `apps/api/.env.example` to `apps/api/.env` and `apps/web/.env.example` to `apps/web/.env`
before running either app.

Linting is asymmetric because the generators disagree: **web uses ESLint** (flat config,
`eslint.config.js`) and **api uses oxlint** (`oxlint.json`). Don't unify them without a reason.

## Architecture rules

- **`apps/web` is client-only.** `src/routes/+layout.ts` sets `ssr = false`, `prerender = false`,
  and `vite.config.ts` uses `adapter-static` with an `index.html` fallback. Never add
  `+page.server.ts`, server `load`, or a server-rendering adapter — the frontend is a static SPA
  that talks to the NestJS API over REST.
- **The API is the only contract.** Shared types live in `packages/shared` and are imported by
  both sides as `@beacon/shared`. Never redeclare a DTO in the frontend. All HTTP goes through
  `apps/web/src/lib/api/client.ts`.
- **Multi-tenant by organization.** `Organization` is the tenant root. Tenant-owned entities
  extend `OrganizationScopedEntity` (`apps/api/src/common/entities/`), and every query must be
  scoped by organization — there is no global view of employees, attendance or documents.
- **Check permissions, never role names.** Roles are customizable per organization.
  Handlers declare `@RequirePermissions(...)` from `apps/api/src/common/auth/`; the permission
  union and `DEFAULT_ROLES` live in `packages/shared/src/permissions.ts`.
- **Requests are authenticated by default.** `JwtAuthGuard` and `PermissionsGuard` are registered
  as `APP_GUARD`s in `app.module.ts`, in that order — 401 then 403. A new controller is protected
  unless it opts out with `@Public()` (`apps/api/src/modules/auth/public.decorator.ts`). Read the
  caller with `@CurrentUser()`, and resolve the tenant from `user.organizationId` — **never** take
  an organization id from the client. `/api/organizations/current` is the shape to copy.
- **Optional services sit behind interfaces.** Documents go through the abstract `StorageService`
  (`apps/api/src/common/storage/`), implemented by `MinioStorageService`. Inject `StorageService`;
  never import the `minio` SDK — or any other vendor SDK — from feature code. The same rule will
  apply to search and monitoring.
- **i18n and a11y are not optional.** All copy goes through `svelte-i18n`
  (`apps/web/src/lib/i18n/`, locales `en` + `de`). No hardcoded strings. Target WCAG 2.1.

## Auth

Email/password today; passkeys, social login and SSO are planned, which is why `User.passwordHash`
is nullable and hashing sits behind `PasswordService` rather than calling `@node-rs/argon2` directly.

- **Two tokens.** A 15-minute JWT access token (the SPA holds it in memory, never in
  `localStorage`) and a 30-day opaque refresh token in an `HttpOnly` cookie. Only the SHA-256 hash
  of the refresh token is stored. Refreshing rotates; replaying a spent token revokes the user's
  whole token family.
- **The access token carries the permission set**, so authorizing costs no query — the trade-off is
  that a permission change only takes effect when the token expires. `/auth/me` re-reads from the
  database, so the UI is not stale.
- **Users are scoped to one organization**, and email is unique *per organization*, not globally.
  One address may therefore exist in several tenants; `AuthService.login` picks the account whose
  password matches rather than asking which organization up front.
- **Web guards are UX only.** The redirects in `src/routes/(app)/+layout.svelte` are convenience;
  the API re-checks every request. `session.can()` decides what to *offer*, never what to allow.

## MikroORM specifics

Three non-obvious constraints, each of which caused a real failure during setup:

- **A derived property must be named in `OptionalProps`.** `BaseEntity<Optional>` takes a type
  parameter for this — `class User extends OrganizationScopedEntity<'permissions'>` keeps
  `em.create()` from demanding the getter as input. The timestamps are already covered.
- **Entities are registered explicitly** in `apps/api/src/entities.ts`, not by glob. Glob
  discovery would need to `require()` `.ts` sources, which breaks under ESM and Vitest. Add every
  new entity to `ENTITIES`.
- **`@beacon/shared` is compiled.** It emits to `packages/shared/dist` (a `prepare` script builds
  it on install) because `apps/api` imports runtime values from it — `DEFAULT_ROLES` — and plain
  `node dist/main` cannot load `.ts`. The app scripts that execute Node rebuild it first. Type-only
  imports never needed this; runtime ones do.
- **Always declare property types explicitly** (`@Property({ type: 'string' })`). The CLI runs
  through `tsx`/esbuild, which does not emit decorator metadata, so reflection-based type
  inference is unavailable.
- **Two config entry points.** `mikro-orm.config.ts` exports `createOrmConfig(clientUrl)`, which
  `app.module.ts` calls via `forRootAsync` + `ConfigService` — so `.env` is loaded before the URL
  is read. `mikro-orm.cli.ts` is the CLI's entry and loads `.env` itself. Reading
  `process.env.DATABASE_URL` at module scope in the shared config would evaluate before
  `ConfigModule` runs.

Schema changes ship as migrations; auto-synchronisation is off.

## Testing notes

`$env/dynamic/public` only exists inside the Kit runtime, so `apps/web/vite.config.ts` aliases it
to `src/testing/env-dynamic-public.ts` under `test.alias`. Web and api must stay on the same
Vitest major — Vitest 3 bundles Vite 7 types that conflict with Vite 8 and break `svelte-check`.

There are **three** suites, and they prove different things:

| Suite | Command | What it covers |
| --- | --- | --- |
| Unit / component | `pnpm -r test` | Vitest. Web mounts components in jsdom against a mocked client. |
| API e2e | `pnpm --filter api test:e2e` | Supertest against a booted Nest app and the throwaway database. |
| Browser e2e | `pnpm e2e` | Playwright: the built SPA against a real API and a throwaway database. |

The browser suite lives in `apps/web/tests` and exists to catch what the other two cannot —
CORS, the `HttpOnly` refresh cookie crossing ports, the permission set inside the access
token, and the `@beacon/shared` shapes actually agreeing at runtime.

- **It runs the *built* SPA**, previewed by `adapter-static`, not `vite dev` — that is the
  artefact that ships. `PUBLIC_API_URL` is baked in at build time, so it is set for `build`
  as well as `preview`.
- **Both e2e suites share those services.** `pnpm --filter api test:e2e` chains the same
  `services.mjs` and pins `DATABASE_URL` in `vitest.config.e2e.ts`. It used to run against
  the dev database, where its teardown deleted `user_roles` and `invitation_roles`
  unscoped — those pivots carry no `organization_id`, so it wiped every account's roles,
  signing the developer out of their own organization. Teardown is scoped by subquery now,
  and the suite cannot reach dev data at all. **Never point a suite that registers and
  tears down tenants at a database with real accounts in it.**
- **Its backing services are throwaway.** `infra/docker-compose.e2e.yml` is a separate
  compose project on separate ports (Postgres 55432, MinIO 59000) with tmpfs volumes, so a
  running dev stack is never touched. `apps/web/tests/services.mjs` starts them, builds the
  API and migrates before Playwright launches either server; the ports and the API's
  environment live in `apps/web/tests/environment.mjs`.
- **Every spec creates its own organization**, through `POST /auth/register`. Beacon is
  multi-tenant and signup is open, so a fresh tenant per test is both the cheapest and the
  most faithful fixture there is — and nothing needs cleaning up.
- **Rate limits are raised, not disabled.** A dozen parallel browsers sign in faster than any
  human; `THROTTLE_LIMIT` and `AUTH_THROTTLE_LIMIT` (see
  `apps/api/src/common/auth/throttle.ts`) are read from the real process environment, because
  `@Throttle(...)` is evaluated before `ConfigModule` runs and cannot see `.env`.
- **Playwright needs its browser**: `pnpm --filter web exec playwright install chromium`.

## Commits

Always use [Conventional Commits](https://www.conventionalcommits.org/): `type(scope): subject`.

Types: `feat`, `fix`, `docs`, `refactor`, `test`, `build`, `chore`, `ci`, `perf`, `style`, `revert`.

Scope is the workspace package or area being changed — `web`, `api`, `shared`, `config`, `infra`,
`deps` — or omitted when a change is genuinely repo-wide.

```
feat(api): add holiday approval endpoint
fix(web): scope the attendance query by organization
refactor(shared): split permission list out of DEFAULT_ROLES
chore(deps): bump vitest to 4.1.11
docs: document the MikroORM CLI entry point
```

Rules:

- Subject in the imperative, lower case, no trailing period, ideally under 72 characters.
- A change that spans both apps is usually two commits, one per scope. Split it unless the halves
  genuinely do not work apart.
- Breaking changes get a `!` before the colon (`feat(api)!: ...`) and a `BREAKING CHANGE:` footer
  explaining the migration.
- Use the body to say *why*, not to restate the diff.

## Open questions

- Mobile and desktop frameworks are unspecified.
- The search engine is explicitly undecided in `README.md` (Meilisearch is the leading
  self-hosted candidate). Nothing is wired up for it yet.
