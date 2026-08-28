# Beacon

A web application for organizations and employees — or users in general — to track attendance and
time, manage breaks, plan holidays, maintain basic employee data, and store contracts and other
documents.

> **Status: scaffold.** The monorepo is set up and green (build, lint, typecheck, unit and e2e
> tests), and the API runs against Postgres and MinIO. No feature code exists yet — `Organization`
> is the only entity and `/api/health` the only endpoint. Everything under
> [Features](#features) describes the intended product, not what ships today.

## Quick start

Requires **Node 22+**, **pnpm 10+**, and **Docker**.

```bash
pnpm install

# Postgres, MinIO and the observability stack
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

`curl http://localhost:3000/api/health` should return `{"status":"ok","database":"up"}`.

### Local services

| Service | URL | Credentials |
| --- | --- | --- |
| API | http://localhost:3000/api | — |
| Web | http://localhost:5173 | — |
| Postgres | `localhost:5432` | `beacon` / `beacon` |
| MinIO console | http://localhost:9001 | `beacon` / `beacon-secret` |
| Grafana | http://localhost:3001 | `admin` / `admin` |
| Prometheus | http://localhost:9090 | — |

These are development defaults and are not safe for anything else.

## Commands

```bash
pnpm -r build          # or lint / typecheck / test, across the whole workspace

pnpm --filter web dev
pnpm --filter api start:dev

# Both apps use Vitest
pnpm --filter web test -- src/lib/api/client.test.ts
pnpm --filter api test -- -t "requires every declared permission"
pnpm --filter api test:e2e                      # needs infra up

pnpm --filter api mikro-orm migration:create
pnpm --filter api mikro-orm migration:up

pnpm infra:up
pnpm infra:down
```

Linting is intentionally asymmetric: the frontend uses ESLint, the backend uses oxlint — each
follows what its generator ships.

## Project structure

```
apps/web         SvelteKit + Svelte 5 + TailwindCSS — client-only SPA
apps/api         NestJS + MikroORM + PostgreSQL
packages/shared  @beacon/shared — permissions and tenant types shared by both apps
packages/config  @beacon/config — shared TypeScript base config
infra            docker-compose: Postgres, MinIO, Prometheus, Loki, Alloy, Grafana
```

`apps/mobile` and `apps/desktop` are planned; their frameworks are not yet chosen.

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
data, and approve or reject holiday requests and breaks. Reporting and analytics let organizations
track attendance trends and identify areas for improvement.

### Documents

Documents are stored securely with support for versioning and access control, so employers can keep
contracts and other important files in one place. A search feature lets users find documents by
keyword or metadata.

### Clients

Alongside the web application, mobile and desktop clients will provide access from anywhere, at any
time:

- **Mobile** — push notifications for important events such as upcoming holidays or breaks, and
  clock in/out from a phone.
- **Desktop** — automatic time tracking, so users do not have to clock in and out manually.

### Across the application

Multiple languages, with users switching based on their preference, and a notification system for
important events such as upcoming holidays or breaks.

## Technical overview

Beacon is built to be scalable and modular, easy to customize and to integrate with other systems.
The backend exposes a RESTful API for integration with other applications and services, and is
designed to deploy to cloud platforms such as AWS or Azure as well as to custom servers.

### Frontend

Svelte 5, SvelteKit, TailwindCSS, TypeScript, Vite, Vitest, svelte-i18n.

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
(SSO) via OAuth2 or SAML — with two-factor authentication (2FA) for added security. *(Dependencies
are in place; no strategies are implemented yet.)*

### Additional services

Beacon provides optional services that enhance the application. Where an organization already runs
its own, Beacon integrates with that instead of the built-in one — each sits behind an interface in
the API so the implementation can be swapped without touching feature code.

- **Object storage** — integrate with an external object storage service such as Amazon S3 or
  Google Cloud Storage to reuse existing storage infrastructure and gain scalability and
  reliability. Out of the box, Beacon provides **MinIO** as a self-hosted alternative.
- **Monitoring** — integrate with external monitoring services such as Prometheus or Grafana to
  identify and address issues before they impact users. Out of the box, Beacon provides a
  **Prometheus, Loki, Alloy and Grafana** setup.
- **Search engine** — integrate with an external search engine such as Elasticsearch or Algolia for
  advanced search over documents and other data. Out of the box, Beacon would provide
  **Meilisearch** as a self-hosted alternative. **This is still to be decided**, and nothing is
  wired up for it yet.

## License

[MIT](LICENSE)
