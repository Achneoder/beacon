# Beacon Roadmap

The path from what ships today — authentication, organizations, roles — to the product
[`README.md`](README.md) describes. Each phase is a vertical slice: entities and migration, API
module, shared types, web module, tests. A phase is done when `pnpm -r build | lint | typecheck |
test`, `pnpm --filter api test:e2e` and `pnpm e2e` are green, the copy exists in `en` **and**
`de`, and the feature is reachable from the app shell.

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
| Attendance (clock, timesheet, corrections) | shipped |
| Absence (calendar, quota, approvals, public holidays) | shipped |
| Documents (categories, versions, access grants) | shipped |
| Search (sidebar field over documents and people) | shipped |
| Employee data | shipped as part of People — the employment fields and the Profile screen |
| Storage (`StorageService` → MinIO) | shipped — `DocumentsService` is its first caller |
| Search (`SearchService` → Meilisearch) | shipped — `NoopSearchService` when `SEARCH_HOST` is unset |
| SSO (OIDC), 2FA, passkeys | not started — phase 7 specifies SSO |
| Notifications, monitoring | not started |
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

## Phase 2 — Attendance and time tracking — **done**

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

Four things settled while building, worth knowing before phase 3:

- **The overtime balance accrues past its cap.** `OvertimeSummary` reports
  `capMinutes`, `overCap` and `overCapMinutes` rather than clamping. Minutes that were
  genuinely worked are never dropped from the record — the cap is a signal for a
  manager to act on, not a shredder.
- **The balance is maintained through a day ledger.** `AttendanceDay` holds what one
  finished day last contributed, so an amended day moves the running total by the
  *difference* it made. An incremental `+= worked` would double-count the moment a
  correction landed on a day already counted.
- **Every entry stores its own local calendar date**, resolved from the user's zone
  when the clock started. A week query would otherwise convert every row in SQL, and an
  entry begun at 23:30 must not migrate to another day if the user later changes zone.
- **The week lock is zone-aware.** `weekLocksAt(monday, offsetMinutes)` — "unlocked
  until Monday 09:00" has to mean nine in the morning where the person works. Phase 3's
  approval deadlines should take the same offset rather than assuming UTC.

`TimesheetDay.absenceTag` and `credited` are filled by phase 3: attendance asks
`AbsencesService.coverageOf` for them, so the tag on a timesheet row and the tint on a
calendar cell are one decision made in one place.

## Phase 3 — Absence and the holiday calendar — **done**

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
| `GET /absences`, `GET /absences/types` | `attendance:read` |
| `POST /absences`, `DELETE /absences/:id` (withdraw own, pending only) | `holiday:request` |
| `POST /absences/:id/approve` \| `/reject` | `holiday:approve` |
| `GET /absences/calendar?from&to` | `attendance:read` |
| `GET /absences/balances/me`, `GET /absences/balances?userId` | `attendance:read` / `employee:read` |
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

Five things settled while building, worth knowing before phase 4:

- **A request's cost is frozen when it is raised.** `AbsenceRequest.costDays` is
  computed against the public holidays in force that day and then stored. Recomputing
  it on every read would let a holiday declared in November silently rewrite an August
  absence that has already been taken and paid.
- **A year boundary spends two quotas.** `absenceCostByYear` in `packages/shared`
  splits a request across the years it touches, and approval commits to each year's
  `LeaveBalance` separately. Charging the whole thing to the year it started in is the
  bug that helper exists to prevent.
- **`taken` is settled lazily, on read.** An approved absence becomes `taken` the
  first time someone looks at it after its last day. A nightly job that had not run
  yet would show a finished holiday as still upcoming.
- **`takenDays` counts approved *and* taken.** An approved week in December is spent
  the moment it is granted, not the moment it arrives; pending days are counted from
  the requests themselves, so a withdrawal needs no compensating write.
- **Absence types are seeded on first read, not at registration.** The unique key on
  `(organization, key)` makes a concurrent double-seed a conflict rather than a
  duplicate list, and organizations created before this phase fill themselves in.
- **Reading absence is gated by `attendance:read`, not `holiday:request`** — a
  deliberate deviation from the table above, which shipped broken. Requesting and
  approving are different populations: the default `manager` and `admin` roles hold
  `holiday:approve` and no `holiday:request` at all, so the original gate locked the
  approvers out of the queue built for them, and out of the calendar and the Today
  tiles besides. The same correction applies to the sidebar, where `/approvals` was
  gated on `attendance:write`. Writing still needs `holiday:request` and deciding
  still needs `holiday:approve`.

  The web tests could not have caught this — they mock the API, so every call
  resolves whatever the caller holds. `absences.e2e-spec.ts` now signs in as a real
  `manager` and walks the screens, which is the only layer where a permission
  mismatch is visible.
- **Business-rule refusals are named, not swallowed.** `errorKey` maps every 400 onto
  "Something went wrong", which is useless advice when the fix is "those days are
  already booked". `$lib/absence/errors.ts` maps the API's known refusals onto real
  copy in both locales. It matches on message *text*, which is the weak part, and it
  is weak because the API has no machine-readable error code to match on instead —
  **adding one is the durable fix** and the reason that map lives in a single file
  with a test pinning every string it depends on.

Two rules the phase left in place rather than inventing around: the calendar's default
scope is *your own days* — widening to reports and then the organization needs
`holiday:approve`, because a calendar is the easiest place to leak who is off sick —
and every day cell is a real `<button>`, since the canvas's two-click range selection
is hover-only and would otherwise be unreachable by keyboard.

## Phase 4 — Documents — **done**

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
| `GET /document-categories` | `document:read` — see below |
| `POST /document-categories`, `DELETE /document-categories/:id` | `organization:manage` |

Downloads hand back a short-lived `signedUrl()` rather than proxying bytes. The upload contract —
**pdf · docx · jpg, max 20 MB** — is enforced by content sniffing, not the client's declared type;
**encrypted at rest** is opt-in (`STORAGE_ENCRYPTION=sse-s3`, default `none`) because the bundled dev
MinIO runs no KMS, so the dropzone only claims encryption when the backend has actually confirmed
it. Virus scanning is a later hook on the same seam.

**Sick notes tie back to phase 3.** `AbsenceRequest.documentId` is now a real relation to
`Document` — the FK the column was always meant for, added without touching the column. Attaching
one goes through the same visibility check as every other read: an invisible document 404s, and one
that belongs to someone other than the absence's subject is refused outright.

**Web** — `/documents`: the category filter chip row (`All` selected by default), a table of
`icon · name + category · date · size · Open`, and the dashed dropzone below. A row click expands
an inline detail panel — version history, and an access panel behind `document:manage` — rather
than a separate route; the canvas has no detail screen and the design system has no dialog
primitive.

Six things settled while building, worth knowing before the next phase that touches permissions,
storage or this module:

- **Visibility is resolved in exactly one place.** `DocumentsService`'s private
  `accessContext()`/`findVisible()` is the only code that decides what a caller may see — own
  documents, organization-wide ones (`owner === null`, not a second `visibility` column), and
  anything granted via `DocumentAccess` to their user, department or role (read fresh from the
  database on every call, never from the token, so a department move takes effect immediately).
  A document the caller cannot see 404s; one they can see but may not write to 403s — existence
  itself is the secret for a payslip or a sick note, and the two statuses are how the API stays
  able to say so without confirming a guess.
- **`document:write` reached `employee` and `admin` through a boot-time reconciler**, not a
  migration. `OrganizationService` now re-syncs every `isSystem` role's permissions from
  `DEFAULT_ROLES` on every start — safe because no route lets an organization edit a system role
  yet, and durable for whatever permission the next phase adds. Revisit this the day a role editor
  ships.
- **`GET /document-categories` is gated on `document:read`, not `organization:manage`** — the same
  correction phase 3 made for `attendance:read`. The category chip row is an employee screen;
  gating its read behind an admin permission would have shipped it broken for everyone it exists
  for. Writing a category is still an organization setting.
- **The object always exists before the row that points at it.** Both ids are generated
  client-side before any SQL, so the storage key is known before the upload happens; a storage
  failure touches no row, and a database failure after a successful upload gets a best-effort
  compensating delete. A stray object with nothing pointing at it is harmless; the reverse is not.
  `versionNumber` is allocated under a pessimistic lock on the parent document, never `count() + 1`.
- **The e2e suite needed a storage guard the same shape as its database one.** `apps/api/test/storage.ts`
  mirrors `assertThrowawayDatabase()` — the suite refuses to run against any bucket not named
  `*-e2e` — because the API-side vitest config had been pinning `DATABASE_URL` and `MAIL_*` to the
  throwaway compose project but leaving `STORAGE_*` to point at `apps/api/.env`, the dev bucket.
- **Delete is soft.** `deletedAt`/`deletedBy` are set and the bytes stay; a `retentionUntil` in the
  future refuses the delete outright, so an employee's tidy-up cannot silently strip the evidence
  behind an approved sick leave. No retention sweep exists yet — storage grows until one does.

## Phase 5 — Search — **done**

Resolved the open question in `README.md`. `SearchService` lives in
`apps/api/src/common/search/` — same shape as `StorageService`: `index()`, `remove()`,
`replaceAll()`, `query()`, scoped by organization on every call — with `NoopSearchService` so the
API runs without a search container, and `MeilisearchSearchService` behind `SEARCH_HOST`. The
container is in both compose files (7700 dev, 57700 e2e).

Documents (title, category, filename) and employees (name, job title, email, employee number) are
indexed; extracted text is still later. Re-indexing runs through `SearchSubscriber` on
`afterFlush`, not through calls scattered across the services.

**Both decisions the phase was blocked on were made.** Meilisearch is confirmed as the bundled
default and `README.md` no longer says otherwise. The UI is a **search field in the sidebar**
between the brand and the nav — the one structural gap the canvas's sidebar leaves — opening a
popover grouped Documents / People. It is still undesigned; see the open questions below.

Six things settled while building, worth knowing before the next phase that touches permissions,
search or the shell:

- **The index holds no permission data, and that is the whole design.** `SearchRecord` carries
  organization, type and text — no owner, no grant, no department. The engine answers *what
  matched*; `DocumentsService.findVisibleByIds` answers *which of those you may see*, through the
  same private `accessContext()` phase 4 established as the one place visibility is decided. The
  alternative — indexing grant subjects and filtering in the engine — makes an index that can go
  stale into a second authority on who may read a payslip. Concretely: over-fetch four times the
  page from the engine, narrow in Postgres, then re-apply the engine's ordering, because
  `id IN (...)` comes back in whatever order Postgres likes and ranking is what a search backend
  is for.
- **Indexing never fails or slows a write.** The subscriber fires without awaiting and
  `SearchIndexer` swallows and logs — the same contract `MailService.send` keeps, where an
  invitation is committed and stays valid whether or not the email left the building. A degraded
  Meilisearch must not degrade a document upload. The accepted cost is that search is **eventually
  consistent**, which is why `search.e2e-spec.ts` polls through `until()` rather than asserting
  once, and why the browser spec retypes inside a `toPass`.
- **A soft delete arrives as an update, and a disabled user is not a delete.** `DocumentsService.remove`
  sets `deletedAt` and flushes; read as an ordinary change that would re-index a document meant to
  be gone and leave it findable forever. `UserStatus.Disabled` is the opposite case — it is the
  soft delete for people, but `UsersService.list` still returns them and an admin has to be able to
  find the account they just disabled, so status is never a reason to drop a record. Both rules
  have a unit test.
- **No entity and no migration.** The index is derived state; every record in it can be rebuilt
  from Postgres. That is also why nothing backfills it at boot: a full reindex on every start is
  wrong for a large installation, so a fresh container or a restored volume leaves search
  **silently empty** until `POST /search/reindex` is pressed on `/settings/organization`. That
  gap is real and is the phase's known limitation.
- **`GET /search` declares no permission**, deliberately, and the service narrows instead — the
  third time this correction has been needed, after `attendance:read` in phase 3 and
  `document:read` in phase 4. The endpoint spans two features: someone with `employee:read` and no
  `document:read` gets colleagues and no documents, rather than a 403 for the half they were never
  asking about. `POST /search/reindex` is still `organization:manage`. No permission was added.
- **The seam and the feature are two modules.** `common/search` is global and knows nothing about
  `Document` or `User`; `modules/search` imports `DocumentsModule` and `UsersModule` and injects
  the seam. Collapsing them would make `DocumentsModule` and the search module import each other.

The field is a real ARIA combobox — `aria-activedescendant` over a `listbox`, ↑/↓ wrapping, Enter,
Escape, `/` to focus, a polite live region for the count — because the canvas's hover-only
affordances would otherwise leave the whole feature unreachable by keyboard, the same trap phase 3's
calendar cells had.

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

## Phase 7 — SSO (OIDC)

*As an admin, I want to enable SSO for my organization.* The first slice of the "auth expansion"
line below, and the only one an admin configures from inside the app.

Beacon is installed for one organization, so the roadmap's "per-organization configuration and
domain-based routing" collapses: there is **one provider per installation**, and no routing
decision to make — the login screen either offers the button or it does not. That is the single
biggest simplification available here, and the reason this phase is small enough to ship whole.

**Scope, decided before building:**

- **OIDC only.** Authorization code + PKCE against a discovery document. SAML stays on demand;
  `SsoProvider.protocol` exists so adding it is a new value, not a new table.
- **Invitation only — SSO never creates an account.** The IdP proves *who is signing in*, not
  *that they belong here*; membership stays a deliberate act, with the roles, manager, department
  and employee number that phase 1 attaches to it. An address the installation does not know is
  refused at the callback.
- **The admin can enforce SSO, and `organization:manage` is exempt.** A broken IdP must not be able
  to lock everyone out of an on-premise install whose only other door is a database edit.

### Entities

- `SsoProvider` — `OrganizationScopedEntity`, unique on `organization`: one row, created the first
  time the settings screen is saved. `protocol` (`oidc`), `displayName` (the button label — "Sign
  in with Okta"), `issuerUrl`, `clientId`, `clientSecretCiphertext` + `clientSecretIv`, `scopes`
  (default `openid email profile`), `emailClaim` (default `email`), `allowedDomains` (optional
  allow-list, empty means any), `enabled`, `enforced`, `lastTestedAt`, `lastTestError`.
- `SsoLoginAttempt` — one row per authorization request: `stateHash`, `nonce`, `codeVerifier`,
  `expiresAt` (10 minutes), `consumedAt`, `userAgent`. Single-use; a consumed or expired row is a
  hard refusal, and a sweep deletes anything past its expiry.

Two things about how those are stored, both of them the reason the fields look the way they do:

- **The client secret is encrypted at rest**, AES-256-GCM under a new `SSO_ENCRYPTION_KEY` (32
  bytes, base64) in `apps/api/.env.example`, wrapped in `apps/api/src/common/crypto/`. It is a
  bearer credential for the organization's IdP, unlike `passwordHash`, which is a verifier and can
  stay one-way. **It is never returned by any endpoint** — the settings DTO carries
  `hasClientSecret: boolean`, and an update that omits the field leaves the stored one alone.
- **`state` is stored as its SHA-256 hash**, like `RefreshToken.tokenHash` and the invitation
  token; the PKCE verifier is stored as-is, because the exchange has to send it and it is worthless
  without the matching authorization code and a live row.

One migration, both tables. Both entities go into `apps/api/src/entities.ts`.

### The flow

The IdP redirects the *browser*, and the browser lands on the API's origin, not the SPA's — so the
callback is an API route that finishes by redirecting back to the web app.

| Route | Permission |
| --- | --- |
| `GET /auth/sso` | `@Public()` — `{ enabled, displayName, enforced }` for the login screen |
| `POST /auth/sso/start` | `@Public()`, `PASSWORD_THROTTLE` — creates the attempt, returns `{ authorizationUrl }` |
| `GET /auth/sso/callback` | `@Public()` — exchanges the code, issues the session, 302s to the SPA |
| `GET /sso/settings`, `PUT /sso/settings`, `DELETE /sso/settings` | `organization:manage` |
| `POST /sso/settings/test` | `organization:manage` — fetches discovery, reports issuer and endpoints or the error |

`POST /auth/sso/start` returns a URL rather than a 302 because the caller is `fetch` inside the
SPA, which cannot follow a cross-origin redirect usefully and needs to show a failure inline; the
SPA assigns `window.location` itself.

The callback: validate `state` against an unconsumed row, exchange the code with the verifier,
verify the ID token (issuer, audience, expiry, `nonce`), read the email claim, check the domain
allow-list, then look the address up **in the one organization**. Not found, `invited` (see below)
or `disabled` → no session. Found and `active` → `AuthService.startSessionFor(user)` — the same
seam invitation acceptance already uses — which sets the refresh cookie on the API origin and
302s to `WEB_APP_URL`.

**No token ever travels in a URL.** The redirect back to the SPA carries nothing; the browser
arrives with the `HttpOnly` refresh cookie already set, and `session.bootstrap()` trades it for an
access token through the `POST /auth/refresh` it already calls on start-up. A failure redirects to
`/login?error=<code>` with a small closed set of codes the web app maps to real copy. The cookie
survives the hop because the callback is a top-level GET on the API origin and the cookie is
`SameSite=Lax` on path `/api/auth`.

Two new environment variables, both in `.env.example`: `API_PUBLIC_URL` (the origin the IdP
redirects to — the settings screen shows `<API_PUBLIC_URL>/api/auth/sso/callback` for pasting into
the IdP) and `WEB_APP_URL` (where the callback sends the browser, defaulting to `CORS_ORIGIN`).

### Enforcement

`enforced` is a property of the provider, not of `Organization`. `AuthService.login` refuses a
password login when it is set — **unless the account holds `organization:manage`**, checked against
the user's own permission union rather than a role name. The refusal is a named 403, not a generic
one, so the login screen can say *"Your organization signs in through {provider}"* rather than
"something went wrong". `PUT /sso/settings` refuses `enforced` without `enabled` and a stored
secret, and refuses `enabled` unless a discovery fetch has succeeded.

### Shared

`packages/shared/src/sso.ts`, exported from `index.ts`: `SsoProtocol`, `SsoPublicState`,
`SsoSettings`, `UpdateSsoSettingsRequest`, `SsoTestResult`, `SsoErrorCode`. No new permission —
`organization:manage` already covers this, per the rule above the phase list.

### Web

- **`/settings/sso`**, gated on `organization:manage` and linked from `/settings/organization`:
  display name, issuer URL, client id, client secret (write-only, placeholder "unchanged" once
  stored), scopes, allowed domains, the read-only redirect URI with a copy button, a *Test
  connection* button that surfaces the discovered issuer and endpoints, and the two switches —
  *Enabled*, then *Require SSO* behind explicit copy about the admin exemption. Undesigned; take
  it to the canvas with the rest of the admin surface.
- **`/login`** asks `GET /auth/sso` alongside the `GET /auth/setup` it already asks, renders
  *Sign in with {displayName}*, and hides the password form when `enforced` — with a quiet
  *sign in with a password* escape link (`/login?password=1`) for the exempt admins, and a mapping
  from `?error=` onto localized copy.
- Copy in `en` **and** `de`; the button is a real `<button>` in the form's tab order, and the
  error alert is announced.

### Tests

- **Unit** — the crypto helper round-trips and rejects a tampered ciphertext; an attempt is
  single-use and expires; `login` refuses under enforcement and still admits `organization:manage`;
  the settings mapper never emits the secret; DTO validation rejects a non-HTTPS issuer.
- **API e2e** — `sso.e2e-spec.ts` with a **fake IdP**: a throwaway HTTP server in the spec serving
  a discovery document, a JWKS and a token endpoint, signing ID tokens with a locally generated key
  (`jose`, dev dependency). It covers the happy path end to end, an unknown address, a replayed
  `state`, a wrong `nonce`, a domain outside the allow-list, and the settings routes' permissions.
  This is the only layer where the whole redirect chain is visible.
- **Browser e2e** — the button appears when SSO is enabled and the password form disappears under
  enforcement. No real IdP; the redirect itself is the API suite's job.

### Dependencies

`openid-client@^6` in `apps/api` — ESM-only, which suits an ESM Nest app, and it owns discovery,
PKCE, the exchange and ID-token validation. Hand-rolling ID-token verification is the one part of
this phase where a subtle mistake is silent.

### Open questions

1. **An `invited` user who signs in through the IdP.** The IdP proves the address far better than
   an emailed token does, so the attractive answer is that a first SSO login *accepts* the pending
   invitation — applying its roles and flipping `invited` → `active`. The conservative answer is to
   refuse and make them use their invitation link. Worth settling before building, and it touches
   the invitation work that is in flight.
2. Group-to-role mapping from IdP claims — deferred deliberately: roles stay a decision someone
   makes in Beacon, which is what "invitation only" means.
3. IdP-initiated sign-in and back-channel logout (`end_session_endpoint`) are not supported; a
   Beacon logout ends the Beacon session only.
4. `SSO_ENCRYPTION_KEY` rotation has no story yet — re-entering the client secret is the answer
   until one exists.
5. Multiple providers in one installation. One row today; the unique key is on `organization`, so
   lifting it is a migration and a picker on the login screen.
---

## Cross-cutting, once the verticals exist

**Notifications** — `NotificationService` behind an interface, an in-app `Notification` entity with
`GET /notifications` + `POST /notifications/:id/read`, email via a `MailService` (also an interface
— templates in `de`/`en`), and events for: invitation, absence decided, absence awaiting you,
correction rejected. The sidebar has no bell in the canvas; adding one is a design change, not just
a component. This is the prerequisite for mobile push.

**Auth expansion** — in ascending cost: TOTP 2FA (`User.totpSecret`, a verification step in
`AuthService.login`), passkeys (WebAuthn; `Credential` entity — `passwordHash` is already nullable
for this), social login (OAuth2 per provider). **SSO is specified in full as phase 7** — OIDC first,
one provider per installation, SAML only on demand. Password reset over emailed one-use
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
same four checks plus both e2e suites. The browser suite (`pnpm e2e`) already brings its own
throwaway database up; CI needs Docker and `playwright install --with-deps chromium`.

---

## Suggested order

```
0  Shell ── 1  People ─┬─ 2  Attendance ─┬─ 6  Reporting ── Clients
                       └─ 3  Absence ────┘   (0–5 done)
                       └─ 4  Documents ── 5  Search
Cross-cutting: notifications + audit log after 3; auth expansion any time; hardening before launch.
```

Phases 2/3 and 4 share only phase 1, so two people can run them in parallel. Phase 4 had a small
dependency back on 3 (sick-note attachment), landed once both entities existed. Nothing in phases
0–4 changes the auth or tenancy model; if a phase seems to require that, stop and write it down as
a question instead.

## Open design questions

Take these back to the canvas before the phase that needs them:

1. The manager/admin surface in full — approval queue, people directory, org and role settings,
   team reports, the document version history and access panels. Phases 1, 2, 3, 4 and 6 all have
   an undesigned half.
2. What the sidebar looks like for a user with `attendance:approve` or `employee:manage` — the
   canvas only ever draws the five employee entries.
3. Search. Phase 5 shipped an entry point the canvas does not have — a field in the sidebar
   between the brand and the nav, opening a popover grouped Documents / People. It is built to the
   existing tokens and is keyboard-complete, but it was specified by this roadmap alone and still
   owes a canvas pass: the popover's density, whether hits should show a type icon, and what a
   full results page would look like if the popover ever proves too small.
4. Notifications: no bell, no inbox, no toast pattern.
5. Empty, loading and error states — every screen in the canvas is drawn full of data.
6. Mobile layout. The canvas is a fixed 258px sidebar beside a `1180px` column; the breakpoint
   behaviour is unspecified, and the web SPA needs it before the mobile client is even discussed.
