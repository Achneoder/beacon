# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Beacon is an attendance / time-tracking, holiday-planning, employee-data and document-storage
application for organizations. `README.md` holds the product spec; this file holds the working
rules.

The monorepo is green (build, lint, typecheck, unit tests, e2e). Authentication, organization
setup, people, attendance, holidays, documents and search are implemented.

## Layout

pnpm workspaces. `apps/*` and `packages/*` are the workspace globs.

```
apps/web         SvelteKit + Svelte 5 + Tailwind 4 — client-only SPA
apps/api         NestJS 12 (ESM) + MikroORM 6 + PostgreSQL
packages/shared  @beacon/shared — permissions, tenant types shared by both apps
packages/config  @beacon/config — shared tsconfig base
infra            docker-compose: postgres, MinIO, Meilisearch, Mailpit, Prometheus/Loki/Alloy/Grafana
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

pnpm infra:up                                  # postgres, minio, mailpit, observability
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
- **One organization per installation.** Beacon is deployed on-premise for a single company.
  `POST /auth/register` installs the instance — organization, built-in roles, owner — and 409s
  ever after; `OrganizationService.createWithOwner` enforces that under an advisory lock, and
  `GET /auth/setup` tells the auth screens whether there is anything left to install. Everyone
  else joins by invitation.
- **Still scoped by organization.** `Organization` remains the root: entities extend
  `OrganizationScopedEntity` (`apps/api/src/common/entities/`) and every query is scoped by
  organization. There is exactly one today, but nothing may read across it — that scoping is
  what keeps the door open to multi-tenant hosting and what stops a client-supplied id ever
  being trusted.
- **Check permissions, never role names.** Roles are customizable per organization.
  Handlers declare `@RequirePermissions(...)` from `apps/api/src/common/auth/`; the permission
  union and `DEFAULT_ROLES` live in `packages/shared/src/permissions.ts`.
- **Requests are authenticated by default.** `JwtAuthGuard` and `PermissionsGuard` are registered
  as `APP_GUARD`s in `app.module.ts`, in that order — 401 then 403. A new controller is protected
  unless it opts out with `@Public()` (`apps/api/src/modules/auth/public.decorator.ts`). Read the
  caller with `@CurrentUser()`, and resolve the tenant from `user.organizationId` — **never** take
  an organization id from the client. `/api/organizations/current` is the shape to copy.
- **Optional services sit behind interfaces.** Documents go through the abstract `StorageService`
  (`apps/api/src/common/storage/`), implemented by `MinioStorageService`, and outbound email
  through `MailService` (`apps/api/src/common/mail/`), implemented by `SmtpMailService` — or by
  `LogMailService` when no `MAIL_HOST` is set. Inject the abstract class; never import the `minio`
  or `nodemailer` SDK — or any other vendor SDK — from feature code. Search is the third:
  `SearchService` (`apps/api/src/common/search/`), implemented by `MeilisearchSearchService` when
  `SEARCH_HOST` is set and by `NoopSearchService` when it is not, so an installation with no search
  container is a supported deployment rather than a broken one. The same rule will apply to
  monitoring. Objects are encrypted at rest only when `STORAGE_ENCRYPTION=sse-s3` —
  the bundled dev MinIO runs no KMS, so the default is `none` and `MinioStorageService` refuses to
  finish booting if it asked for `sse-s3` and the bucket does not confirm it.
- **i18n and a11y are not optional.** All copy goes through `svelte-i18n`
  (`apps/web/src/lib/i18n/`, locales `en` + `de`). No hardcoded strings. Target WCAG 2.1.

## Auth

Email/password and SSO over OIDC today; passkeys, social login and 2FA are planned, which is why
`User.passwordHash` is nullable and hashing sits behind `PasswordService` rather than calling
`@node-rs/argon2` directly.

- **Two tokens.** A 15-minute JWT access token (the SPA holds it in memory, never in
  `localStorage`) and a 30-day opaque refresh token in an `HttpOnly` cookie. Only the SHA-256 hash
  of the refresh token is stored. Refreshing rotates; replaying a spent token revokes the user's
  whole token family.
- **The access token carries the permission set**, so authorizing costs no query — the trade-off is
  that a permission change only takes effect when the token expires. `/auth/me` re-reads from the
  database, so the UI is not stale.
- **Users are scoped to one organization**, and email is unique *per organization*. Since an
  installation holds exactly one organization, an address identifies at most one account and
  `AuthService.login` is a single lookup.
- **Web guards are UX only.** The redirects in `src/routes/(app)/+layout.svelte` are convenience;
  the API re-checks every request. `session.can()` decides what to *offer*, never what to allow.

## SSO

OIDC, one provider per installation — Beacon runs one organization per deployment, so there is no
per-organization routing decision to make, and `SsoProvider` is `@Unique` on `organization` to make
that a database fact rather than a convention. `apps/api/src/modules/sso/`.

- **`openid-client` is the only thing that verifies an ID token.** `OidcClient`
  (`modules/sso/oidc-client.ts`) is the one seam onto it — feature code never imports the SDK
  directly, the same containment `StorageService` and `MailService` give their own vendor SDKs.
  Hand-rolling issuer, audience, expiry or `nonce` checks is the one place in this feature a subtle
  mistake would be silent.
- **The client secret is encrypted, not hashed.** Unlike `passwordHash`, Beacon has to present it
  back to the IdP on every token exchange, so it must be recoverable. `SecretCipher`
  (`common/crypto/`), AES-256-GCM under `SSO_ENCRYPTION_KEY`, is optional the same way `MAIL_HOST`
  and `SEARCH_HOST` are: unset, `isConfigured()` is false and the settings routes refuse to save
  rather than the app refusing to boot. No endpoint ever returns the secret —
  `SsoSettings.hasClientSecret` is all a reader sees.
- **SSO never creates an account.** The IdP proves *who* is signing in, not *that they belong
  here*. The callback resolves an existing `active` user, or accepts a pending invitation for the
  address — `InvitationsService.acceptForFederatedEmail` — because the IdP has already proved the
  address more strongly than an emailed token does. An address the installation does not know is
  refused.
- **`enforced` exempts `organization:manage`**, checked against the caller's own permission union
  in `AuthService.login`, never a role name. A broken IdP must not be able to lock every admin out
  of an on-premise install whose only other door is a database edit; `/login?password=1` is the
  escape hatch the web app offers them.
- **`state` is stored as its SHA-256 hash**, like `RefreshToken.tokenHash` and the invitation
  token; the PKCE verifier is stored as-is, because the token exchange has to send it and it is
  worthless without the matching authorization code and a live, unconsumed `SsoLoginAttempt` row.
- **The issuer must be https, except on a loopback host** — `IsIssuerUrl`
  (`modules/sso/dto/issuer-url.validator.ts`), the same exemption RFC 8252 makes for a native-app
  redirect URI. Without it neither a developer's own local IdP nor the API e2e suite's fake one
  (`test/fake-idp.ts`, which signs real ID tokens against a real JWKS) could ever be configured.

## Email

Invitations are emailed; every other notification will follow the same path.

- **`MailService` is the seam** (`apps/api/src/common/mail/`). `SmtpMailService` is chosen at boot
  when `MAIL_HOST` is set, `LogMailService` otherwise — so a deployment without a relay still
  works, and a bad host fails at startup rather than silently per message.
- **`send` never throws.** It returns whether the message reached a transport. An invitation is
  committed before the email goes out and stays valid regardless; `CreatedInvitation.emailSent`
  is how the web app decides between "sent" and "pass the link on yourself". The accept link is
  shown either way — the token is stored only as a hash and cannot be re-read.
- **Copy lives in `invitation-email.ts`**, a pure function over `en`/`de`, mirroring the web
  locales. No template engine, and no runtime string escapes the escaping helper.
- **Mailpit catches everything in development** — SMTP on 1025, the inbox at
  http://localhost:8025 — and again in both e2e suites on 51025/58025, where
  `apps/api/test/mailpit.ts` reads messages back over its REST API. That is deliberate: mocking
  `MailService` would prove the call, not the SMTP conversation.

## MikroORM specifics

Non-obvious constraints, each of which caused a real failure during setup:

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
- **`em.upsert` hydrates without running the constructor**, so field initializers never fire:
  `BaseEntity`'s `id = randomUUID()` and its timestamp defaults must be passed as data, or the
  not-null constraints bite. And naming the conflict fields matters — with a client-generated id
  in the data the driver conflicts on the primary key unless `onConflictFields` says otherwise
  (`ensureBalance` in `absences.service.ts` is the worked example).

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
  compose project on separate ports (Postgres 55432, MinIO 59000, Meilisearch 57700,
  Mailpit 51025/58025) with
  tmpfs volumes, so a running dev stack is never touched. `apps/web/tests/services.mjs`
  starts them, builds the API and migrates before Playwright launches either server; the
  ports and the API's environment live in `apps/web/tests/environment.mjs`.
- **One organization for the whole run, one person per test.** Registration installs the
  instance and then 409s, so a tenant per spec is not available. Playwright's `setup`
  project (`apps/web/tests/instance.setup.ts`) installs it; each test then invites its own
  account through `POST /invitations`, which is what keeps one spec's clock-ins and absences
  out of another's. The API e2e specs instead reset the database in `beforeAll`
  (`apps/api/test/instance.ts`, guarded to databases named `*_e2e`) and run one file at a
  time — `fileParallelism` is off in `vitest.config.e2e.ts`. The object store gets the same
  treatment: `apps/api/test/storage.ts` refuses to touch a bucket not named `*-e2e`, for the
  same reason the database guard exists — a documents spec writes and deletes real objects.
  `apps/api/test/search.ts` is the third rail of the same shape, refusing any index not
  named `*-e2e`.
- **`sso.spec.ts` runs alone, after every other browser spec.** It is the only file that flips the
  shared organization's SSO settings, and `fullyParallel` would otherwise race a password sign-in
  in another spec against this one hiding the password form under enforcement. It gets its own
  Playwright project in `playwright.config.ts`, `dependencies: ['chromium']`, rather than living
  inside the `chromium` project like every other spec.
- **Search is asserted by polling, not by waiting.** `SearchSubscriber` never blocks a write
  on the search backend, so a spec that uploads and then searches is racing a write it
  deliberately did not wait for. `until()` in `apps/api/test/search.ts` is the honest way to
  assert on that; a fixed sleep would be either flaky or slow.
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

## Search

Meilisearch, decided in phase 5 and recorded in `README.md`. One index per installation, holding
documents and people.

- **The index holds no permission data.** Not an owner, not a grant, not a department —
  `SearchRecord` carries only organization, type and text. The engine answers *what matched*;
  `DocumentsService.findVisibleByIds` answers *which of those you may see*, through the same
  private `accessContext()` every other read path uses. An index is derived state that can go
  stale, and a stale grant must never be able to widen what someone can find.
- **Indexing never fails or slows a write.** `SearchSubscriber` hooks `afterFlush` and fires
  without awaiting; `SearchIndexer` swallows and logs. Search is therefore eventually consistent,
  which is deliberate and is why the e2e suite polls.
- **Nothing backfills the index at boot.** A fresh container or a restored volume leaves search
  empty until `POST /search/reindex` (Settings → Organization) rebuilds it from Postgres. A full
  reindex on every start would be wrong for a large installation.
- **No entity, no migration.** Every record can be rebuilt from the database, so the index owns
  nothing.

## Open questions

- Mobile and desktop frameworks are unspecified.
- The search UI is not in the design canvas. The sidebar field is specified by the roadmap alone
  and still owes a canvas pass.
