# Security & data-privacy review — 2026-08-30

Whole-repo review of the API, web app, desktop client and shared package, for security
and data-protection issues only. Every finding was traced end to end against source and
carries `file:line` citations.

Follows `docs/review-2026-08-29.md`, whose highs and mediums are fixed; its open lows are
not repeated here except where this pass sharpens the severity. **2 high · 4 medium ·
6 low.**

**All findings fixed 2026-08-30.** Each fix is recorded under its finding. One half of
finding 6 is deliberately left open and says so — it needs a product decision rather than
a patch.

## High

### 1. `employee:manage` can grant any role, including `owner` — vertical privilege escalation

`POST /users/:id/roles` is gated on `employee:manage`
(`apps/api/src/modules/users/users.controller.ts:76-83`). `UsersService.setRoles`
(`apps/api/src/modules/users/users.service.ts:163-170`) resolves the requested role ids
against the organization and assigns them. It checks **nothing else** — not which
permissions those roles carry, not whether the caller holds them, and not whether the
target is the caller themselves.

The built-in `admin` role holds `employee:manage` and `organization:read` but **not**
`organization:manage` (`packages/shared/src/permissions.ts:25-37`). `owner` holds
everything, and `organization.service.ts:26` states the boundary outright: *"The role
every founder gets — it is the only one holding organization:manage."*

The whole chain is reachable with an `admin` token:

1. `GET /api/organizations/current/roles` — `organization:read`, which `admin` has —
   returns the `owner` role's id (`organization.controller.ts:31-35`).
2. `POST /api/users/<own id>/roles` with `{ roleIds: ["<owner id>"] }` — `employee:manage`,
   which `admin` has.
3. Refresh; the next access token carries `organization:manage`.

`organization:manage` is not a cosmetic step up. It gates SSO provider settings
(`sso-settings.controller.ts:14-37`), absence types, public holidays, document categories
and `POST /search/reindex`. It is also the permission `AuthService.refuseIfSsoEnforced`
(`auth.service.ts:108-114`) exempts from SSO enforcement, so reaching it also reopens the
password door an administrator deliberately closed.

Two more paths reach the same place without touching an existing account: `POST /users`
(`users.controller.ts:48-55`) and `POST /invitations`
(`invitations.controller.ts:47-48`) both take a caller-supplied `roleIds` and both run at
`employee:manage`, so an admin can invite an `owner`-role account at an address they
control (`users.service.ts:236-259`, `invitations.service.ts:255-270` — the same
unchecked `resolveRoles`).

*Fix:* refuse to assign a role whose permission set is not a subset of the caller's own —
one check, shared by `setRoles`, `create` and the invitation path (which is also where
`docs/review-2026-08-29.md`'s open "extract `common/roles.ts`" item lands). Refusing a
caller to change their own roles is worth having too, but it is the weaker half: the
subset rule is what actually closes the escalation, since granting `owner` to a colleague
is the same breach one step removed.

*Test gap:* no suite asserted this. `documents.e2e-spec.ts:321,334-336` exercises
`POST /users/:id/roles`, but only as the owner, only to set up a fixture.

*Fix (done 2026-08-30):* `assertGrantable` (`common/auth/role-grant.ts`) refuses a grant
carrying a permission the granter does not hold, and all three paths run through it —
`UsersService.resolveRoles` (used by `create` and `setRoles`) and
`InvitationsService.resolveRoles`, each now taking the caller's own permission union from
`@CurrentUser()`. The default `employee` role is checked on the same path as a named one.

A plain subset rule would have been wrong: `admin` deliberately holds neither
`attendance:write` nor `holiday:request`, both of which `employee` carries, so a strict
subset would have stopped an admin inviting an employee — the commonest administrative
act there is. `SELF_SERVICE_PERMISSIONS` (`packages/shared/src/permissions.ts`) exempts
the three permissions whose every code path is scoped to the holder's own record. Widening
that list widens what a non-owner may grant, which is why each entry carries the code
reference that makes it self-scoped.

Self-assignment needs no separate rule: under this one a caller can only hand out
authority they already hold, so granting to themselves gains them nothing.

Tests: `common/auth/role-grant.spec.ts` covers the rule, and a `role escalation` block in
`test/people.e2e-spec.ts` drives the full chain — admin refused the owner role for
themselves, for a colleague, by invitation and at user creation, while the default
employee grant and a manager grant still succeed and the owner may still grant owner.

### 2. Invitation tokens are written to the application log in plaintext

`LogMailService.send` logs the full message body
(`apps/api/src/common/mail/log-mail.service.ts:14-16`):

```ts
`no MAIL_HOST configured — dropping "${message.subject}" to ${message.to}\n${message.text}`
```

`message.text` is the invitation email, and line 5 of that body is the accept URL with the
raw token in it (`invitation-email.ts:54-60`, `invitation-token.ts:31-33`). The token is a
live credential: `POST /invitations/accept` is `@Public()`, and presenting it creates an
`Active` account carrying whatever roles the invitation was given
(`invitations.service.ts:139-160, 196-225`).

This contradicts the property the code otherwise takes care to hold. `invitations.service.ts:52-55`
says the token *"is returned exactly once — only its digest is stored, so nobody, including
an administrator reading the table, can recover it later."* The log has it in full.

Two things make it worse than a developer-convenience log line:

- `LogMailService` is the configured default whenever `MAIL_HOST` is unset
  (`mail.module.ts`), and `apps/api/.env.example:44-45` and `CLAUDE.md` both describe
  running without a relay as a supported deployment, not a dev-only mode.
- `infra/` ships Loki + Alloy + Grafana. Logs are shipped to a store whose read
  population is normally wider than the database's, and retained longer than the
  14-day token TTL.

Chained with finding 1, an admin can mint an `owner` invitation and anyone with log
access can consume it.

*Fix (done 2026-08-30):* `LogMailService` logs the subject and recipient only, matching
what `SmtpMailService` already did (`smtp-mail.service.ts:39`). `MAIL_LOG_BODY=true` opts
back in for local debugging and is off by default. Tests in
`common/mail/log-mail.service.spec.ts` assert the token never reaches the log unless the
flag is set, and that any value but `"true"` reads as off.

## Medium

### 3. Nothing stops a production deploy from booting on the example `JWT_SECRET`

`apps/api/.env.example:6` ships `JWT_SECRET=change-me-in-production` as a working value,
and both readers only check that it is *present* (`auth.module.ts:26`,
`jwt.strategy.ts:26` — `getOrThrow`). A deployment that copies the example and edits the
database URL boots successfully and signs access tokens with a key published in this
repository. Anyone who knows the project can forge a token for any user id with any
permission set — `JwtStrategy.validate` (`jwt.strategy.ts:32-39`) trusts the claims
wholesale, and `PermissionsGuard` reads `permissions` straight off it.

`docs/review-2026-08-29.md:216` files this as a low. It is the more serious of the two
outcomes on that line: blanking the value is right, but the real gap is that the API has a
production guard idiom and does not apply it here. `corsOrigins()` (`main.ts:31-45`)
already throws at boot in `NODE_ENV=production` for exactly this class of mistake.

*Fix (done 2026-08-30):* `JWT_SECRET` is blank in `.env.example`, so `getOrThrow` refuses
a boot without one in every environment. `assertProductionConfig()` in `main.ts` adds the
production-only half, in the same shape as `corsOrigins()`: it refuses to start when
`JWT_SECRET` is shorter than 32 characters or is one of the published example values, when
`AUTH_COOKIE_SECURE` is not `"true"`, when `SameSite=none` is set without it, or when
`STORAGE_ACCESS_KEY`/`STORAGE_SECRET_KEY`/`SEARCH_API_KEY` are still on their example
values. Placeholders are matched exactly rather than by substring, so a real secret that
happens to contain "beacon" is not refused. Inert outside `NODE_ENV=production`, so both
e2e suites (which run as `test` with fixed throwaway values) are untouched.

### 4. The SSO callback URL is built from the `Host` header

`SsoAuthController.callback` reconstructs the URL it hands to the token exchange from
request headers (`sso-auth.controller.ts:52-54`):

```ts
new URL(`${request.protocol}://${request.get('host')}${request.originalUrl}`)
```

`Host` is attacker-controlled. That URL is passed to
`OidcClient.exchange` → `client.authorizationCodeGrant`
(`oidc-client.ts:96-104`), which derives the `redirect_uri` it presents at the token
endpoint from it.

The practical impact is bounded — the IdP compares `redirect_uri` against the value bound
to the authorization code and rejects a mismatch, so a spoofed host breaks the exchange
rather than redirecting anything anywhere. It is a failure mode, not a takeover. But the
service already computes the canonical value from configuration
(`SsoService.redirectUri()`, `sso.service.ts:346-350`, from `API_PUBLIC_URL`), which is
the one the IdP was configured with, and the authorization request was built with
(`sso.service.ts:192-196`). Using request headers instead makes a request-controlled
input load-bearing in the one flow `CLAUDE.md` singles out as *"the one place in this
feature a subtle mistake would be silent."*

*Fix (done 2026-08-30):* `SsoService.finish` now takes the callback's `URLSearchParams`
rather than a URL, and rebuilds the URL itself from `redirectUri()` — the same
`API_PUBLIC_URL`-derived value the authorization request was built with and the IdP was
registered with. No request header reaches the token exchange. `finish` also reads the
`error` param an IdP returns on a refusal and reports `exchange_failed`, which has copy
already, rather than letting a declined consent fall through as `invalid_token`. Covered
in `sso.service.spec.ts`.

### 5. Rate limits key on `req.ip`, which is the reverse proxy in every real deployment

`ThrottlerGuard` is registered globally (`app.module.ts:65`) and `PASSWORD_THROTTLE`
caps password endpoints at 10/minute (`common/auth/throttle.ts:29-31`). The default
tracker keys on `req.ip`, and `configureApp` (`main.ts:14-21`) never sets Express's
`trust proxy`. Beacon is deployed on-premise behind a reverse proxy, so `req.ip` is the
proxy's address for every client:

- Every user in the organization shares one 10-attempts-per-minute budget on
  `/auth/login`, `/auth/register`, `/auth/refresh`, `/auth/sso/start` and
  `/invitations/accept`. One person fat-fingering their password locks out everyone —
  including `/auth/refresh`, so active sessions start dropping.
- And the naive remedy is worse: `app.set('trust proxy', true)` unconditionally makes
  `X-Forwarded-For` client-controlled, giving an attacker an unlimited number of buckets
  and removing the limit entirely.

`test/throttle.e2e-spec.ts` cannot see this — it calls the API directly, so `req.ip` is a
real per-connection address.

*Fix (done 2026-08-30):* `trustProxy()` in `main.ts` reads `TRUST_PROXY` — a hop count, or
a comma-separated list of addresses/CIDRs — and applies it to the Express instance. It
defaults to unset (no proxy trusted), because the safe failure is a shared bucket, not a
forgeable one: `trust proxy: true` would make `X-Forwarded-For` client-controlled and
remove the limit outright. Documented in `.env.example` beside `CORS_ORIGIN`, with the
warning not to set it above the number of proxies actually controlled.

Still open, deliberately: keying the auth throttle on the submitted email as well as the
IP. With `TRUST_PROXY` set correctly each client has its own bucket, which closes the
finding; email keying is defence in depth against a distributed attempt and wants a custom
`ThrottlerGuard`.

### 6. Absence reasons — potentially health data — go to every approver organization-wide

`AbsenceRequestSummary` carries the requester's free-text `note`, the approver's
`decisionNote`, and the title of any attached document (`absences.service.ts:840-870`) —
in an application whose own docs describe attaching sick notes. That full summary is
returned by:

- `GET /absences` with no filter, which for any `holiday:approve` holder is scoped to the
  whole organization rather than to their reports (`absences.service.ts:284-296`: the
  `where.user = caller.id` narrowing applies only when `mine` is set or the caller
  *cannot* approve); and
- `GET /absences/calendar?scope=organization`, which embeds the same summaries in every
  day cell (`absences.service.ts:405-416`, subjects from `calendarSubjects`
  `:755-768`).

`holiday:approve` belongs to `manager` as well as `admin` and `owner`
(`packages/shared/src/permissions.ts:25-46`). So every manager in the organization can read every employee's
stated reason for every absence, and the title of the medical document attached to it —
not only their own reports'.

The narrow default is right and clearly deliberate — `calendarSubjects`' own comment says a
calendar is *"the easiest place to leak who is off sick"* — which is what makes the two
widened paths look unintended rather than considered. This is a data-minimisation question
under GDPR Art. 5(1)(c) and Art. 9 (special-category data), not a broken access check, so
it needs a product decision rather than a patch.

*Fix (done 2026-08-30):* `withoutReason()` in `absences.service.ts` strips `note`,
`decisionNote`, `documentId` and `documentTitle`, and `calendar()` applies it to every
subject but the caller themselves — at any scope, including the organization-wide one. A
month grid is rendered from dates, a name and a type; it never needed the free text, so
this costs nothing and closes the widest and most casually browsed surface, the one
`calendarSubjects` already calls "the easiest place to leak who is off sick".

**`GET /absences` deliberately keeps the detail, and that half is a product decision left
open.** It is the approvals queue: an approver cannot decide a request whose reason has
been taken away from them, and because Beacon does not route a request to a *particular*
approver, narrowing it to direct reports would strand every request in an organization
that does not set managers. Narrowing it is worth doing if that is how the installation
actually works — the options are to scope the unfiltered list to the caller's reports
(keeping the organization-wide view for `employee:manage`), or to redact for subjects the
caller neither approves for nor manages.

## Low

- [x] **Query-string ids are not validated.** `userId`/`categoryId` reach MikroORM as raw
  strings — `documents.controller.ts:52-60`, `attendance.controller.ts:57-85`,
  `absences.controller.ts:43-56, 98-108, 135-141` — while every path param uses
  `ParseUUIDPipe`. A malformed value surfaces as a Postgres `invalid input syntax for
  type uuid` 500 rather than a 400.
  *Fix:* `OptionalUuidPipe` (`common/http/`) on every id query param. Absent, empty and
  blank all still read as "not filtering", which is what they already meant — every
  service tests `if (filter.userId)`, so `?userId=` was ignored rather than refused, and
  a 400 there would break a caller that works today. That tolerance is why it is its own
  pipe rather than `ParseUUIDPipe({ optional: true })`, which exempts only null and
  undefined.
- [x] **No `Cache-Control: no-store` on PII responses.** Nothing in `configureApp`
  (`main.ts:14-21`) sets it, so payslip lists, people records and absence reasons are
  heuristically cacheable by intermediaries and by the browser's disk cache — an
  on-premise app on shared workstations is exactly where that matters.
  *Fix:* folded into the `securityHeaders` middleware below. Every response is either
  personal data or a redirect, so there is no case that wants an exception.
- [x] **`webBaseUrl()` falls back to `CORS_ORIGIN`, which is a list.**
  `invitations.service.ts:231-234` and `sso-auth.controller.ts:72-78` both do
  `WEB_BASE_URL ?? CORS_ORIGIN`, but `main.ts:32-36` splits `CORS_ORIGIN` on commas. A
  deployment with two allowed origins and no `WEB_BASE_URL` emails a malformed accept
  link and 302s SSO to a malformed target.
  *Fix:* `common/config/web-origins.ts` owns both the split and the fallback, and all
  three callers use it, so they cannot drift again. The fallback takes the first origin —
  a convenience for the single-origin case, not a second way to configure two: an
  installation serving the SPA from several origins has to name the one an emailed link
  should use, and `WEB_BASE_URL` is how.
- [x] **JWT algorithms not pinned** (`jwt.strategy.ts:22-27`) — still open from
  `docs/review-2026-08-29.md:189`. Not exploitable today (`jsonwebtoken` restricts a
  string secret to HMAC, so `alg: none` is rejected), but `algorithms: ['HS256']` is one
  line of drift defence.
  *Fix:* pinned on both sides — `algorithms: ['HS256']` on the verifier and
  `algorithm: 'HS256'` in `auth.module.ts`'s sign options, so signer and verifier are
  never free to disagree.
- [x] **Refresh cookie `Secure` off by default, `SameSite=none` accepted without it**
  (`refresh-cookie.ts:20-30`) — still open from `docs/review-2026-08-29.md:187`.
  *Fix:* two locks. `assertProductionConfig` (finding 3) refuses the boot when
  `AUTH_COOKIE_SECURE` is not `"true"` or `SameSite=none` is set without it, so an
  operator who meant it insecurely is told rather than quietly overridden; and
  `baseOptions` now defaults `secure` on under `NODE_ENV=production` and cannot be turned
  off there by configuration, for any path that reaches the cookie without passing the
  boot check.
- [x] **No security headers on API responses** (`main.ts:14-21`) — still open from
  `docs/review-2026-08-29.md:190`. Low for a JSON-only API, but `X-Content-Type-Options`
  and `Referrer-Policy` are free.
  *Fix:* `securityHeaders` (`common/http/`) sets `no-store`, `nosniff`, `DENY`,
  `no-referrer`, a `default-src 'none'` CSP, and HSTS only over TLS. Written out rather
  than pulling in Helmet: Helmet's defaults are tuned for an app that serves HTML, and
  several of them either do nothing here or get in the way of a browser SPA on another
  origin calling this API. `Referrer-Policy` earns its place — the SSO callback carries
  `state` and `code` in its URL, which a `Referer` would otherwise pass onward.

## Verified clean

Checked and found correct — recorded so a later pass does not re-derive it:

- **Tenant scoping and IDOR.** Every controller takes the organization from
  `@CurrentUser()`; no route accepts a client-supplied organization id. Cross-subject
  reads all funnel through `resolveSubject` (`attendance.service.ts:663-673`,
  `absences.service.ts:731-748`) or `accessContext` (`documents.service.ts:99-125`), and
  a document the caller cannot see 404s rather than 403s, so existence stays secret
  (`documents.service.ts:129-147`).
- **Search cannot widen visibility.** `SearchRecord` carries no owner, grant or
  department (`common/search/search.service.ts:15-27`); hits are re-resolved through the
  same `accessContext` every other read path uses
  (`search-query.service.ts:108-131`), so a stale index cannot leak. Soft-deleted
  documents are removed from the index on the update that deletes them
  (`search.subscriber.ts:70-76`).
- **CSV formula injection is handled.** `csvCell` (`packages/shared/src/report.ts:133-140`)
  disarms leading `= + - @ \t \r` while exempting genuine numbers, which is the hard half.
- **Upload handling.** Content type is sniffed from magic bytes, never trusted from the
  client; the stored key is built from ids only, so no filename can traverse a path or
  cross a tenant (`document-file.pipe.ts:28-77`, `documents.service.ts:57-60`).
- **Crypto and token handling.** AES-256-GCM with a fresh IV and a boot-time key-length
  check (`secret-cipher.ts`); argon2id with dummy-hash timing equalisation
  (`password.service.ts:23-42`); refresh tokens, invitation tokens and SSO `state` all
  256-bit random stored only as SHA-256. Access tokens live in memory in the SPA, never
  `localStorage` (`apps/web/src/lib/api/client.ts:16-21`).
- **No XSS surface in the web app.** No `{@html}`, no `innerHTML`, no `eval` anywhere in
  `apps/web/src` or `apps/desktop/src`. The one page the desktop app draws itself uses a
  restrictive CSP and `textContent` only (`apps/desktop/assets/connect.html`).
- **Electron hardening.** `contextIsolation: true`, `nodeIntegration: false`,
  `sandbox: true` on the app window, no preload on the served app, `will-navigate`
  restricted to http/https, `setWindowOpenHandler` denying popups, and no
  `certificate-error` handler (`apps/desktop/src/window.ts`). A `beacon://` link only
  pre-fills the connect screen and is re-probed before adoption
  (`main.ts:247-257`, `discovery.ts:47-88`).
- **`GET /api/instance` leaks nothing about the tenant** — product, contract version and
  `setupRequired` only (`instance.controller.ts:20-31`), and the contract version is
  deliberately not the release version (`packages/shared/src/instance.ts:18-26`).

## Suggested order

1. Finding 1 — the subset check on role assignment. Smallest fix, largest gap.
2. Finding 2 — stop logging mail bodies.
3. Finding 3 — the production boot guard, extended to the other placeholder secrets.
4. Finding 6 — needs a product decision, so start the conversation early.
5. Findings 4 and 5, then the lows.
