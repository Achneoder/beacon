# Beacon Roadmap

The path from what ships today — authentication, organizations, roles — to the product
[`README.md`](README.md) describes. Each phase is a vertical slice: entities and migration, API
module, shared types, web module, tests. A phase is done when `pnpm -r build | lint | typecheck |
test` and `pnpm --filter api test:e2e` are green, the copy exists in `en` **and** `de`, and the
feature is reachable from the app shell.

Phases 1–6 are ordered by dependency; everything after phase 6 is genuinely parallelizable.

## The design

The employee-facing UI is specified by the **Beacon employee tracking platform** design canvas
(`claude.ai/design`, project `9d740e9a-49b9-4037-96a5-ed3d0fbdbcda`, artboard
`Beacon Prototype.dc.html`). It is the source of truth for layout, copy and interaction on the five
screens it covers. `apps/web/src/lib/styles/tokens.css` is already extracted from it — palette,
Figtree/IBM Plex Mono, the 15px type scale, the 11/14/18/20px radius ladder and the status-pulse
keyframe all match, so no re-theming is needed.

Two things the design settles that the README left open, and one it does not answer:

- **The shell is a 258px left sidebar**, not the top bar in `src/routes/(app)/+layout.svelte`.
  Sidebar order: brand, nav, then pinned to the bottom — a live **status card** (state dot,
  label, running `HH:MM:SS`), the appearance toggle, and the user card (initials, name, job title).
- **Nav labels are Today / Timesheet / Calendar / Documents / Profile** — not Dashboard /
  Attendance / Holidays / Documents. `nav.*` in both locale files changes with the phase that
  introduces each screen, and `nav.dashboard` → `nav.today` in phase 0.
- **The manager and admin half is undesigned.** Every screen in the canvas is the employee's own
  view; there is no approval queue, people directory, role editor or report. Those screens are
  specified by this roadmap alone and should be taken back to the canvas before they are built.

Numeric values — clocks, durations, balances, file sizes — are always mono
(`font-mono`), and durations are `H:MM` while the live day clock is `HH:MM:SS`. One shared
formatter in `packages/shared`, so the API, the web app and the future clients agree.

## Where we are

| Area | State |
| --- | --- |
| Auth (email/password, JWT + rotating refresh) | shipped |
| Organization, roles, permission guard | shipped |
| Design tokens, theme switching, base UI components | shipped |
| Shared time formatters (`H:MM`, `HH:MM:SS`) | shipped |
| App shell (sidebar, status card, appearance, user card) | shipped |
| People (users, invitations, departments, teams) | shipped |
| Attendance, absence, employee data, documents | not started |
| Storage (`StorageService` → MinIO) | interface + implementation, no callers |
| Search, notifications, monitoring | not started |
| Mobile, desktop | not created; frameworks undecided |

The permission union in `packages/shared/src/permissions.ts` already names every feature below
(`attendance:*`, `holiday:*`, `document:*`, `employee:*`, `report:read`). Phases claim those
permissions rather than inventing new ones — extend the union only where a phase says so.

---

## Phase 0 — The shell — **done**

Small, and everything else lands inside it.

Rebuild `src/routes/(app)/+layout.svelte` as the sidebar from the canvas: nav items with the
active dot and weight change, the status card, the appearance toggle wired to the existing
`theme.svelte.ts` (which already persists to `beacon-theme`), and the user card. Nav entries are
filtered by `session.can(...)`, so the sidebar is short until later phases fill it.

The header per screen is a kicker (uppercase, tracked) plus an `h1`, with the date and the user's
timezone on the right — `Friday, 28 August 2026 / Berlin · CEST` in the canvas. That means **the
user's own timezone and office are displayed from day one**, so phase 1 must carry them.

Extract from the canvas while doing this: `StatusDot` (already exists) driven by a three-state
`in | break | out`, a `Clock` component for mono time, and the pill button variants (full-radius,
`filter:brightness` on hover). Keyboard reachability and a focus ring on every nav item and pill —
the canvas uses hover-only affordances and must not be copied literally there.

## Phase 1 — People: users, invitations, departments, teams — **done**

Everything else scopes to a person, so this comes first.

**Entities** — `Department`, `Team` (both `OrganizationScopedEntity`), `Invitation`
(email, role ids, SHA-256 token hash, `expiresAt`, `acceptedAt`). Extend `User` with the fields the
Profile screen displays: `employeeNumber` (`BCN-0148`), `jobTitle`, `departmentId`, `teamId`,
`managerId` (self-reference), `contractType` (permanent/fixed-term × full/part-time), `location`
(office plus on-site/hybrid/remote), `phone`, `timezone`, `startsOn`, `endsOn`. Register each in
`apps/api/src/entities.ts` and ship one migration.

`managerId` is load-bearing, not decoration — the canvas routes every request to a named approver
("awaiting Marc Bauer", "sent to Marc Bauer") and shows a *Reports to* card. Build
`subordinateIdsOf(userId)` here; phases 2 and 3 both need "the people I approve for".

**API** — `apps/api/src/modules/users`, `.../departments`, `.../teams`.

| Route | Permission |
| --- | --- |
| `GET /users/me`, `PATCH /users/me` (phone, locale, timezone only) | authenticated |
| `GET/POST /users`, `GET/PATCH/DELETE /users/:id` | `employee:read` / `employee:manage` |
| `POST /users/:id/roles` | `employee:manage` |
| `POST /invitations`, `GET /invitations`, `DELETE /invitations/:id` | `employee:manage` |
| `POST /invitations/accept` | `@Public()` — the token *is* the credential |
| `GET/POST /departments`, `GET/POST /teams`, `:id` variants | `employee:read` / `employee:manage` |

Copy `organization.controller.ts`: `@CurrentUser()` supplies the tenant, no route reads an
organization id from the body. Invitation acceptance mirrors `AuthService.register` — hash the
token, single transaction, flip `UserStatus.Invited` → `Active`.

**Shared** — `packages/shared/src/employee.ts`: `UserSummary`, `UserDetail`, `CreateUserRequest`,
`InvitationSummary`, `AcceptInvitationRequest`, `DepartmentSummary`, `TeamSummary`.

**Web** — `/profile`, exactly as the canvas draws it: identity header, an eight-field grid
(employee ID, email, department, team, start date, contract, location, phone), the *Work model*
card (phase 2 fills its numbers), *Reports to*, and *Access* — the user's role names as chips,
**display only**, with `session.can()` still deciding what the UI offers.

Undesigned but required: `/people` (list, department filter, invite dialog), `/people/:id`,
`/settings/organization` (name, locale, timezone, roles), and `/invite/:token` under `(auth)`.

**Decided here, once** — deleting a user with attendance history: soft-delete via
`UserStatus.Disabled`, never a hard delete. `DELETE /users/:id` disables and returns the user;
disabling your own account is refused.

Two things settled while building, worth knowing before phase 2:

- **`SessionUser` now carries `timezone` and `jobTitle`.** The page header converts at the edge
  from the user's own zone, falling back to the browser's; the sidebar's user card prefers the job
  title and falls back to the primary role.
- **Invitation acceptance signs the invitee in.** `POST /invitations/accept` is `@Public()`,
  throttled like `/auth/*`, and returns the same `AuthResponse` + refresh cookie as registration.
  The token is shown exactly once at creation — only its SHA-256 hash is stored — and
  `CreatedInvitation.acceptUrl` is the link to paste into an email until notifications exist.

## Phase 2 — Attendance and time tracking

The canvas's Today and Timesheet screens, and the biggest expansion over the original plan.

**Entities**

- `AttendanceEntry` — user, `startedAt`, `endedAt` nullable, `source`
  (`manual | web | mobile | desktop | badge` — the canvas labels a segment "Office · badge"),
  `note`, `approvalStatus`.
- `BreakEntry` — belongs to an entry. Break is a **first-class clock state**, not a derived gap:
  the canvas's control has three states with state-dependent labels
  (`in` → *Clock out* / *Start break*; `break` → *Resume work* / *Clock out*; `out` → *Clock in* /
  *Add manual entry*), and the status dot pulses in `in` and `break` but not `out`.
- `WorkSchedule` — per user, effective-dated: `model`
  (`flextime | fixed | trust | shift`), `weeklyMinutes` (the canvas allows 10–40 h in 2.5 h steps,
  so part-time is normal, not an edge case), per-weekday expected minutes, and model-specific
  detail — core hours for flextime (10:00–15:00), start/end for fixed, nothing for trust,
  a roster reference for shift. Daily target is `weekly / 5` only as a default; store it.
- `OvertimeBalance` — a running per-user balance with a **cap** (`+14:20 · Cap 40:00`). New
  concept; decide what happens at the cap (stop accruing, or accrue and flag) before building.

Store every instant as `timestamptz` in UTC and convert at the edge using the user's timezone,
falling back to `Organization.timezone`.

**API** — `apps/api/src/modules/attendance`.

| Route | Permission |
| --- | --- |
| `POST /attendance/clock-in`, `POST /attendance/clock-out` | `attendance:write` |
| `POST /attendance/breaks/start` \| `/stop` | `attendance:write` |
| `GET /attendance/me/today` — status, `since`, segments, worked and break totals | `attendance:read` |
| `GET /attendance/me/week?offset` — rows, totals, balance, lock state | `attendance:read` |
| `GET /attendance?userId&from&to` | `attendance:read` (own + subordinates; all with `attendance:approve`) |
| `POST /attendance/corrections`, `GET /attendance/corrections` | `attendance:write` |
| `POST /attendance/corrections/:id/approve` \| `/reject` | `attendance:approve` |

**Rules worth a unit test each** — no two open entries per user; `endedAt > startedAt`; breaks fall
inside their entry; an absence day counts toward the week target as *credited*, never as worked
time (the canvas prints `credited` in the balance column and still includes the day in the total);
a working day may carry an absence-type tag and real hours at the same time (Wed 26 Aug is *Home
office*, 5:35 worked); the week locks — "Week is unlocked until Monday 09:00" — after which a
change requires a correction request rather than an edit.

**Web** — `/` (Today): the status/clock panel with the live `HH:MM:SS` counter, day-progress bar
against target, the two-button control, and beside it *Week balance*, *Overtime bank*, *Holiday
left* and a *Next absence* card; below, today's segments as `time-range · type · note · duration`
rows with an "Open timesheet" link. `/timesheet`: week paging, a six-column table
(day+date+tag / start / end / break / worked / balance) with today's row highlighted, a total row,
and a *Request correction* button next to the lock notice.

The live counter ticks client-side from a server-supplied `startedAt` — never a client-accumulated
count, or a sleeping laptop silently under-reports. Re-read `/attendance/me/today` on focus.

Undesigned but required: `/approvals` for correction requests.

## Phase 3 — Absence and the holiday calendar

**Entities**

- `AbsenceType` — seeded per organization. The canvas ships eight: Vacation, Sick leave, Home
  office, Unpaid leave, Parental leave, Training, Business trip, Special leave. They need **three
  independent flags**, not one: `deductsFromQuota` (only Vacation), `paid`, and `countsAsWork` —
  because Home office, Training and Business trip are still working days that appear on the
  calendar and as a timesheet tag. Each type also carries its display colour role
  (accent / warning / success / info / muted), so the calendar, the legend and the timesheet tags
  stay consistent.
- `AbsenceRequest` — user, type, `startsOn`, `endsOn`, `halfDayStart/End`, `status`, `approverId`
  (defaults to the manager), `decidedAt`, `note` ("Optional — visible to your manager"),
  `documentId` nullable. Status is **four-valued**: `pending | approved | rejected | taken` —
  the canvas distinguishes an approved future absence from one already counted against the year.
- `LeaveBalance` — user, year, `entitlementDays` (per employee, 20–40 in the canvas),
  `carryOverDays`, `takenDays`.
- `Holiday` — public holidays: date, name, region.

**API** — `apps/api/src/modules/absences`.

| Route | Permission |
| --- | --- |
| `GET/POST /absences`, `DELETE /absences/:id` (withdraw own, pending only) | `holiday:request` |
| `POST /absences/:id/approve` \| `/reject` | `holiday:approve` |
| `GET /absences/calendar?from&to` | `attendance:read` |
| `GET /absences/balances/me`, `GET /absences/balances?userId` | `holiday:request` / `employee:read` |
| `GET/POST /absence-types`, `GET/POST /public-holidays` | `organization:manage` |

Working-day arithmetic — days between two dates minus weekends and public holidays, honouring half
days and `deductsFromQuota` — is pure and belongs in `packages/shared`, because the canvas prints
the cost of a selection (`5 days · Vacation`) before the request is sent. Test year boundaries and
carry-over expiry.

**Web** — `/calendar`: a month grid (Mon-first, six rows, weekend cells tinted, today ringed in
accent, each absence cell tinted by its type with a short tag) plus a right column. Selecting a
range is two clicks — first day, then last, with the hint line changing across all three states —
and reveals the *New request* card inline (type select, optional note, Send / Cancel). Below it,
the request list with `Pending` / `Approved` / `Taken` pills. A legend sits under the grid.

Undesigned but required: `/approvals` (shared with phase 2), and the absence-type editor under
`/settings`. Reuse `organization:manage` for both rather than adding an `absence:manage`
permission, unless a customer asks.

## Phase 4 — Documents

The first consumer of `StorageService`. Feature code injects the abstract class; the `minio` SDK
stays behind `MinioStorageService`.

**Entities** — `DocumentCategory` (seeded per organization — the canvas names Employment contract,
Payslips, Certificates / trainings, ID & permits, Signed policies, Sick notes; a free-text field
would make the filter row meaningless), `Document` (owner user or organization-wide, `title`,
`categoryId`, `currentVersionId`, `retentionUntil`), `DocumentVersion` (`storageKey`, `size`,
`contentType`, `checksum`, `uploadedById`, `versionNumber`), `DocumentAccess` (grant to a user,
department or role).

**Storage keys** must start with the organization id —
`org/<orgId>/documents/<docId>/<versionId>` — so a bucket listing can never cross tenants even if a
query slips.

**API** — `apps/api/src/modules/documents`.

| Route | Permission |
| --- | --- |
| `GET /documents?categoryId&userId` | `document:read` (own + granted) |
| `POST /documents` (multipart), `POST /documents/:id/versions` | `document:write` |
| `GET /documents/:id`, `GET /documents/:id/versions` | `document:read` |
| `GET /documents/:id/download` → signed URL | `document:read` |
| `PATCH /documents/:id`, `DELETE /documents/:id`, `POST /documents/:id/access` | `document:manage` |
| `GET/POST /document-categories` | `organization:manage` |

Downloads hand back a short-lived `signedUrl()` rather than proxying bytes. The canvas states the
upload contract in the dropzone — **pdf · docx · jpg, max 20 MB, encrypted at rest** — so enforce
the allowlist and cap in the controller and turn on server-side encryption on the bucket. Virus
scanning is a later hook on the same seam.

**Sick notes tie back to phase 3.** The canvas lists "Sick note 12 Aug 2026.pdf" as a category and
the same date is a Sick leave day, so `AbsenceRequest.documentId` should let a request carry its
evidence. Build it here, once documents exist.

**Web** — `/documents`: the category filter chip row (with `All` selected by default), a table of
`icon · name + category · date · size · Open`, and the dashed dropzone below. Version history and
the per-document access panel for `document:manage` are undesigned — take them to the canvas.

## Phase 5 — Search

Resolves the open question in `README.md`. Introduce `SearchService` in
`apps/api/src/common/search/` — same shape as `StorageService`: `index()`, `remove()`, `query()`,
scoped by organization on every call — plus a `NoopSearchService` so the API runs without a search
container. Then implement `MeilisearchSearchService` and add the container to
`infra/docker-compose.yml`.

Index documents first (name and category, extracted text later), then employees. Re-index on write
through a subscriber, not scattered service calls. **Decide before building:** Meilisearch as the
bundled default, per the README's leaning — confirm it, record it in `README.md`, and delete the
"still to be decided" note. There is no search UI in the canvas; design one before shipping this,
or the feature has nowhere to live.

## Phase 6 — Reporting and dashboard

`report:read` finally gets a consumer. `apps/api/src/modules/reports`:

- `GET /reports/attendance/summary?from&to&groupBy=user|department` — worked vs. expected, overtime
- `GET /reports/absences/summary?year` — taken, remaining, pending per user
- `GET /reports/attendance/export?format=csv` — streamed, never buffered

The employee's own dashboard is already specified (phase 2's Today screen). What is missing is the
manager's: pending approvals, who is out this week, team overtime. Entirely undesigned — it is the
largest gap in the canvas and should be drawn before it is built. Charts go through one shared
component so theme and locale formatting stay consistent.

---

## Cross-cutting, once the verticals exist

**Notifications** — `NotificationService` behind an interface, an in-app `Notification` entity with
`GET /notifications` + `POST /notifications/:id/read`, email via a `MailService` (also an interface
— templates in `de`/`en`), and events for: invitation, absence decided, absence awaiting you,
correction rejected. The sidebar has no bell in the canvas; adding one is a design change, not just
a component. This is the prerequisite for mobile push.

**Auth expansion** — in ascending cost: TOTP 2FA (`User.totpSecret`, a verification step in
`AuthService.login`), passkeys (WebAuthn; `Credential` entity — `passwordHash` is already nullable
for this), social login (OAuth2 per provider), SSO (OIDC first, SAML only on demand, with
per-organization configuration and domain-based routing). Password reset over emailed one-use
tokens is a phase-1-shaped prerequisite and should land with notifications.

**Audit log** — an append-only `AuditEvent` (actor, action, subject, `before`/`after`, ip) written
by an interceptor for every mutating request. Cheap now, painful to retrofit once corrections,
approvals and documents carry legal weight.

**Hardening** — rate-limiting on `/auth/*` (`@nestjs/throttler`), account lockout, OpenAPI
generation, structured logging into the existing Loki stack, `/metrics` for the existing
Prometheus, and a first pass at data export/erasure for GDPR.

**Accessibility and i18n** — a WCAG 2.1 audit per phase, not once at the end: keyboard paths
through the calendar's range selection and every dialog, focus management on route change, an axe
pass in the component tests, and visible focus on the canvas's hover-only controls. Every string
the canvas introduces needs a German counterpart — absence type names, work model names and their
notes, status pills, and the lock notice. Add locales beyond `en`/`de` only after the copy settles.

## Clients

Neither client starts before the notification and reporting seams exist — both depend on them.

**Mobile** — clock in/out, absence requests, push notifications. Framework undecided; the decision
is between React Native and a Svelte-family wrapper, and hinges on whether the team wants to share
`@beacon/shared` types only (either works) or components (neither does well). Requires a device
registration endpoint and a push provider behind an interface.

**Desktop** — automatic time tracking from activity, syncing `AttendanceEntry` with
`source: 'desktop'`. Needs an offline queue and idempotent clock-in, so give the attendance API a
client-supplied idempotency key when this phase starts.

## Deployment

Not tied to a feature phase, but needed before a real user exists: production `Dockerfile`s for API
and web, a compose or Helm target, migrations as a release step, secret management for
`JWT_SECRET` and the database URL, backups for Postgres and the object store, and CI running the
same four checks plus e2e against a throwaway database.

---

## Suggested order

```
0  Shell ── 1  People ─┬─ 2  Attendance ─┬─ 6  Reporting ── Clients
                       └─ 3  Absence ────┘
                       └─ 4  Documents ── 5  Search
Cross-cutting: notifications + audit log after 3; auth expansion any time; hardening before launch.
```

Phases 2/3 and 4 share only phase 1, so two people can run them in parallel. Phase 4 has a small
dependency back on 3 (sick-note attachment) — build the entity link, ship the UI whenever 3 lands.
Nothing in phases 0–4 changes the auth or tenancy model; if a phase seems to require that, stop and
write it down as a question instead.

## Open design questions

Take these back to the canvas before the phase that needs them:

1. The manager/admin surface in full — approval queue, people directory, org and role settings,
   team reports. Phases 1, 2, 3 and 6 all have an undesigned half.
2. What the sidebar looks like for a user with `attendance:approve` or `employee:manage` — the
   canvas only ever draws the five employee entries.
3. Search: no entry point exists anywhere in the design.
4. Notifications: no bell, no inbox, no toast pattern.
5. Empty, loading and error states — every screen in the canvas is drawn full of data.
6. Mobile layout. The canvas is a fixed 258px sidebar beside a `1180px` column; the breakpoint
   behaviour is unspecified, and the web SPA needs it before the mobile client is even discussed.
