# Beacon

A web application for organizations and employees — or users in general — to track attendance and
time, manage breaks, plan holidays, maintain basic employee data, and store contracts and other
documents.

> **Status: early.** The monorepo is green (build, lint, typecheck, unit and e2e tests) and the
> first vertical slice ships: an organization can be created, its owner signs in, and every API
> request is authenticated and permission-checked. Attendance, holidays, employee data and
> documents are still to come — everything under [Features](#features) describes the intended
> product, not what ships today.

## Quick start

Requires **Node 22+**, **pnpm 10+**, and **Docker**.

```bash
pnpm install

# Postgres, MinIO, Mailpit and the observability stack
pnpm infra:up

# Environment defaults (both files are gitignored)
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env

# Create the database schema
pnpm --filter api mikro-orm migration:up

# Run both apps (separate terminals)
pnpm --filter api start:dev   # http://localhost:3000/api
pnpm --filter web dev         # http://localhost:5173
```

`curl http://localhost:3000/api/health` should return `{"status":"ok","database":"up"}`. Open
http://localhost:5173, create an organization, and you are signed in as its owner.

### Local services

| Service | URL | Credentials |
| --- | --- | --- |
| API | http://localhost:3000/api | — |
| Web | http://localhost:5173 | — |
| Postgres | `localhost:5432` | `beacon` / `beacon` |
| MinIO console | http://localhost:9001 | `beacon` / `beacon-secret` |
| Meilisearch | http://localhost:7700 | key `beacon-search-key` |
| Mailpit | http://localhost:8025 | — |
| Grafana | http://localhost:3001 | `admin` / `admin` |
| Prometheus | http://localhost:9090 | — |

These are development defaults and are not safe for anything else.

## Commands

```bash
pnpm -r build          # or lint / typecheck / test, across the whole workspace

pnpm --filter web dev
pnpm --filter api start:dev
pnpm --filter desktop dev                       # builds, then launches the Electron shell
pnpm --filter desktop dist                      # installers, built per OS on that OS

# All three apps use Vitest
pnpm --filter web test -- src/lib/api/client.test.ts
pnpm --filter api test -- -t "requires every declared permission"
pnpm --filter desktop test -- tracker.test.ts
pnpm --filter api test:e2e                      # needs infra up

pnpm e2e                                        # browser e2e: the built SPA against a
pnpm e2e:down                                   # real API and a throwaway database

pnpm --filter api mikro-orm migration:create
pnpm --filter api mikro-orm migration:up

pnpm infra:up
pnpm infra:down
```

Linting is intentionally asymmetric: the frontend uses ESLint, the backend and the desktop shell
use oxlint — each follows what its generator ships.

## Project structure

```
apps/web         SvelteKit + Svelte 5 + TailwindCSS — client-only SPA
apps/api         NestJS + MikroORM + PostgreSQL
apps/desktop     Electron — the desktop client, tracking time from the app lifecycle
packages/shared  @beacon/shared — permissions and tenant types shared by both apps
packages/config  @beacon/config — shared TypeScript base config
infra            docker-compose: Postgres, MinIO, Meilisearch, Mailpit, Prometheus, Loki, Alloy, Grafana
```

`apps/mobile` is planned; its framework is not yet chosen.

Contributor-facing conventions and the reasoning behind them live in [CLAUDE.md](CLAUDE.md).

## Features

### User and organization management

Central user management with roles and permissions, giving different levels of access to the
application. Basic roles are provided out of the box and can be customized to fit the needs of the
organization. Companies can manage their employees, departments, and teams, and assign them to
different projects or tasks.

### Time tracking and planning

A dashboard for users to view their attendance and time tracking data, plus a calendar view for
planning holidays and breaks. Employers can manage their employees' attendance and time tracking
data, and approve or reject holiday requests and breaks. Once a week is closed, changing a day is
a correction request that the person's manager decides — or, where the organization prefers to
trust its people, one that applies straight away and is simply recorded against the name of
whoever made it (Settings → Organization → Time tracking). Reporting and analytics let
organizations track attendance trends and identify areas for improvement.

### Documents

Documents are stored securely with support for versioning and access control, so employers can keep
contracts and other important files in one place. A search feature lets users find documents by
keyword or metadata.

### Clients

Alongside the web application, mobile and desktop clients provide access from anywhere, at any
time. The desktop client is built; the mobile one is planned:

- **Mobile** — push notifications for important events such as upcoming holidays or breaks, and
  clock in/out from a phone.
- **Desktop** — automatic time tracking, so users do not have to clock in and out manually.
  Opening the app starts the clock; closing it, sending the computer to sleep or hibernate, or
  leaving the screen locked stops it. A short lock does not count as leaving. Everything the app
  shows is the web application itself, so there is one interface to learn and one to maintain.

  Because a computer can go to sleep faster than a request can be sent, the desktop client records
  a clock-out before it tries to send one, and delivers it when the machine wakes — stamped with
  the moment it actually stopped, not the moment it woke up. An evening's sleep is never banked as
  work, and a machine that loses power closes its entry at the last minute it was known to be
  awake. Automatic tracking can be switched off at any time, and clocking in and out by hand
  still works from the app or from the tray.

  Beacon ships **one generic build** of the desktop client for every customer — nobody compiles
  or hosts their own copy — so the server address is resolved entirely at runtime, and never
  trusted until it proves itself. A person types it once, as little as `beacon.example.com`; the
  app tries the likely candidates and only saves one that answers `GET /api/instance` as Beacon
  (see [Backend](#backend) below). An administrator can skip that screen for their whole
  organization by dropping `apps/desktop/desktop.example.json` (renamed `desktop.json`) into a
  per-OS system path, or setting `BEACON_SERVER_URL`; adding `"locked": true` enforces it, hiding
  the tray's "Change server…" entirely. A `beacon://connect?url=…` link pre-fills the same screen
  for a one-off invite — never adopted without an explicit click, since a link is not something
  the app can trust on its own.

### Across the application

Multiple languages, with users switching based on their preference, and a notification system for
important events such as upcoming holidays or breaks.

## Technical overview

Beacon is built to be scalable and modular, easy to customize and to integrate with other systems.
The backend exposes a RESTful API for integration with other applications and services, and is
designed to deploy to cloud platforms such as AWS or Azure as well as to custom servers.

### Frontend

Svelte 5, SvelteKit, TailwindCSS, TypeScript, Vite, Vitest, svelte-i18n. The desktop client adds
Electron around the same frontend.

The frontend **runs client-only and contains no backend code** — it ships as a static SPA and gets
all of its data from the REST API. Code is organized into modules, one per feature, on top of a set
of reusable components such as buttons, forms, and tables. The whole frontend is barrier-free and
accessible, following the Web Content Accessibility Guidelines (WCAG) 2.1.

### Backend

NestJS, TypeScript, PostgreSQL, MikroORM, Passport.js, JWT.

Data is stored in PostgreSQL; schema changes ship as migrations. Records are scoped by organization,
and authorization is checked against permissions rather than role names, so organizations can define
their own roles.

Authentication supports multiple methods — email/password, passkeys, social login, and single sign-on
(SSO) via OAuth2 or SAML — with two-factor authentication (2FA) for added security. *(Email/password
and SSO over OIDC are implemented; passkeys, social login, SAML and 2FA are planned.
`User.passwordHash` is nullable so an account can authenticate another way.)* SSO never creates an
account by itself — the IdP proves who is signing in, and a first login either resolves an existing
account or accepts a pending invitation, never a self-service signup. Beacon holds one provider per
installation, and an admin can enforce it while staying exempt themselves, so a broken IdP cannot
lock every administrator out of an on-premise install whose only other door is a database edit.

Signing in returns a short-lived JWT access token, which the SPA keeps in memory only, plus a
long-lived refresh token in an `HttpOnly` cookie. Refreshing rotates the token: the presented one is
spent, and replaying it revokes every session the user has, on the assumption it leaked.

Beacon is installed for a single organization, on the company's own infrastructure — it is not a
multi-tenant service. `POST /api/auth/register` is therefore a first-run installer: it creates the
organization, seeds its four built-in roles and makes the caller its owner, in one transaction, and
then refuses every later attempt with `409`. Everyone after the owner arrives by invitation.
`GET /api/auth/setup` reports whether the instance still needs installing, so the login and register
screens can stop offering a form that can only fail. `GET /api/instance` answers the same question
for the desktop (and future mobile) client, alongside a product marker and a contract version — the
identity check a client runs against a candidate address before ever saving it, and deliberately the
only thing an unauthenticated caller learns: never the organization's name.

### Additional services

Beacon provides optional services that enhance the application. Where an organization already runs
its own, Beacon integrates with that instead of the built-in one — each sits behind an interface in
the API so the implementation can be swapped without touching feature code.

- **Object storage** — integrate with an external object storage service such as Amazon S3 or
  Google Cloud Storage to reuse existing storage infrastructure and gain scalability and
  reliability. Out of the box, Beacon provides **MinIO** as a self-hosted alternative.
- **Email** — point `MAIL_HOST` at the organization's own SMTP relay to send invitations and,
  later, every other notification from an address its people already trust. Out of the box, Beacon
  provides **Mailpit** for development, which catches every message instead of delivering it.
  Configure no host at all and mail is logged rather than sent — invitation links can still be
  passed on by hand.
- **Monitoring** — integrate with external monitoring services such as Prometheus or Grafana to
  identify and address issues before they impact users. Out of the box, Beacon provides a
  **Prometheus, Loki, Alloy and Grafana** setup.
- **Search engine** — integrate with an external search engine such as Elasticsearch or Algolia for
  advanced search over documents and other data. Out of the box, Beacon provides **Meilisearch** as
  a self-hosted alternative. Leave `SEARCH_HOST` empty and Beacon runs with no search at all rather
  than a broken one: indexing becomes a no-op and the web app hides its search field. The index
  holds no permission data — who may see a result is decided against the database on every query —
  so it is derived state that can be rebuilt at any time from **Settings → Organization**.

## License

[MIT](LICENSE)
