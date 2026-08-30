/**
 * How a client — desktop today, mobile eventually — finds and recognizes the one
 * Beacon instance it should talk to.
 *
 * Beacon is installed on-premise, one instance per company, as a single generic build:
 * a customer never compiles or hosts their own copy of the client, so the backend
 * address is resolved entirely at runtime, typed once by a user or provisioned by an
 * administrator. Before a client commits to an address it has to prove that address is
 * actually a Beacon API and not a typo, an unrelated intranet host, or a captive
 * portal — that is what `GET /api/instance` and this file exist for.
 *
 * Pure types and pure functions only, like the rest of this package: no fetch, no
 * Electron, no framework. The HTTP call itself belongs to each client.
 */

export const BEACON_PRODUCT = 'beacon';

/**
 * The client/server contract version, not the API's release number. A release version
 * would tell an anonymous caller which CVEs to try and tell a client nothing it can act
 * on; this tells a client whether the shapes it knows still apply. Bump it only when a
 * change to a client-facing contract needs a client to know which side of it the server
 * is on.
 */
export const INSTANCE_API_VERSION = 1;

/** What an unauthenticated caller may learn before signing in. */
export interface InstanceInfo {
  product: typeof BEACON_PRODUCT;
  apiVersion: number;
  /** True only while no organization exists yet — see `SetupState`. */
  setupRequired: boolean;
}

export function isInstanceInfo(value: unknown): value is InstanceInfo {
  if (typeof value !== 'object' || value === null) return false;

  const candidate = value as Record<string, unknown>;

  return (
    candidate.product === BEACON_PRODUCT &&
    typeof candidate.apiVersion === 'number' &&
    typeof candidate.setupRequired === 'boolean'
  );
}

/**
 * Whether a string is a server address a client is willing to load or send a request
 * to. `http` is allowed because an on-premise install on a private network is a
 * supported deployment and this is the address of the user's own employer — but only
 * `http`/`https`, so a stored `file:` or `javascript:` can never become something a
 * window navigates to or a client requests.
 */
export function isServerUrl(value: string): boolean {
  try {
    const url = new URL(value);

    return (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname.length > 0;
  } catch {
    return false;
  }
}

/** What a candidate resolves to: the address to load, and the API base to call. */
export interface ServerCandidate {
  serverUrl: string;
  apiUrl: string;
}

/** A scheme with an authority, e.g. `https://` or `file://`. */
const SCHEME_WITH_AUTHORITY = /^[a-z][a-z0-9+.-]*:\/\//i;
/**
 * A scheme with no authority — `javascript:alert(1)`, `mailto:x@y.com`. Excludes a bare
 * `host:port` such as `localhost:3000`, which has the same shape but a numeric port
 * where an opaque scheme has its payload.
 */
const OPAQUE_SCHEME = /^[a-z][a-z0-9+.-]*:(?!\d)/i;

/**
 * Turns whatever a user typed or an administrator provisioned into an ordered list of
 * addresses worth probing. Nothing here decides which one is real — `discoverInstance`
 * (desktop) or its mobile equivalent tries each in order and keeps the first that
 * answers as Beacon.
 *
 * A bare host (`beacon.example.com`) gets `https://` first, so a public-looking name is
 * never silently sent in cleartext. `http://` is only added as a second candidate for a
 * host that looks private — loopback, an RFC1918 range, link-local, `.local`/`.internal`/
 * `.home.arpa`, or a single label with no dot at all (an intranet name) — the same
 * private-network allowance `isServerUrl` has always made, just not defaulted-to for a
 * public address.
 *
 * The scheme check is a regex, not `new URL()`: `new URL('localhost:3000')` parses with
 * protocol `localhost:`, which would otherwise mangle the single most likely thing a
 * developer types into a blank scheme.
 */
export function serverCandidates(raw: string): ServerCandidate[] {
  const trimmed = raw.trim().replace(/\/+$/, '');

  if (trimmed.length === 0) return [];
  if (SCHEME_WITH_AUTHORITY.test(trimmed) && !/^https?:\/\//i.test(trimmed)) return [];
  if (!SCHEME_WITH_AUTHORITY.test(trimmed) && OPAQUE_SCHEME.test(trimmed)) return [];

  const origins = SCHEME_WITH_AUTHORITY.test(trimmed)
    ? [trimmed]
    : isPrivateHost(trimmed)
      ? [`https://${trimmed}`, `http://${trimmed}`]
      : [`https://${trimmed}`];

  const candidates: ServerCandidate[] = [];

  for (const origin of origins) {
    if (!isServerUrl(origin)) continue;

    if (/\/api$/i.test(origin)) {
      candidates.push({ serverUrl: origin.replace(/\/api$/i, ''), apiUrl: origin });
      continue;
    }

    candidates.push({ serverUrl: origin, apiUrl: `${origin}/api` });
    candidates.push({ serverUrl: origin, apiUrl: origin });
  }

  return dedupe(candidates);
}

function isPrivateHost(originOrHost: string): boolean {
  const host = originOrHost.replace(SCHEME_WITH_AUTHORITY, '').split(/[/:]/)[0]?.toLowerCase() ?? '';

  if (host.length === 0) return false;
  if (host === 'localhost' || host === '::1') return true;
  if (/\.(local|internal|home\.arpa)$/.test(host)) return true;
  if (!host.includes('.') && !/^\d+$/.test(host)) return true; // a bare intranet name

  const octets = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!octets) return false;

  const [a, b] = octets.slice(1).map(Number);
  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  );
}

function dedupe(candidates: ServerCandidate[]): ServerCandidate[] {
  const seen = new Set<string>();
  const result: ServerCandidate[] = [];

  for (const candidate of candidates) {
    const key = candidate.apiUrl;
    if (seen.has(key)) continue;

    seen.add(key);
    result.push(candidate);
  }

  return result;
}

/**
 * The scheme a `beacon://connect?url=…` link uses. An administrator can hand this to an
 * employee to skip the connect screen — but a link is never trusted outright: see the
 * confirmation rule in `apps/desktop/src/main.ts`. The mobile client will register the
 * same scheme, which is why the parser lives here rather than in `apps/desktop`.
 */
export const CONNECT_LINK_SCHEME = 'beacon';

/**
 * Reads the address out of a `beacon://connect?url=<encoded>` link. Returns `null` for
 * anything that is not that exact shape, including a `url` that is not itself a usable
 * server address — a link is only ever a suggestion, and an unparseable one is simply
 * ignored rather than surfaced as an error nobody asked for.
 */
export function parseConnectLink(raw: string): string | null {
  let url: URL;

  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  if (url.protocol !== `${CONNECT_LINK_SCHEME}:`) return null;
  // Electron hands a custom-scheme URL back with the first path segment as the "host".
  if (url.hostname !== 'connect' && url.pathname.replace(/^\/+/, '') !== 'connect') return null;

  const value = url.searchParams.get('url');

  return value && serverCandidates(value).length > 0 ? value : null;
}
