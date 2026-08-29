/**
 * SSO (OIDC). Beacon is installed for one organization, so there is exactly one
 * provider per installation — no per-organization routing, no picker on the login
 * screen. SAML stays on demand; `SsoProtocol` exists so adding it is a new value, not
 * a new shape.
 *
 * SSO never creates an account by itself: the IdP proves *who* is signing in, not
 * *that they belong here*. A first sign-in either resolves an existing active user or
 * accepts a pending invitation for that address — see `AuthService`/`InvitationsService`
 * on the API side. An address the installation does not know is refused.
 */

export const SSO_PROTOCOLS = ['oidc'] as const;

export type SsoProtocol = (typeof SSO_PROTOCOLS)[number];

/** What the login screen needs before anyone has signed in. */
export interface SsoPublicState {
  enabled: boolean;
  /** The button label — "Sign in with Okta". Null until a provider is configured. */
  displayName: string | null;
  /** When true, the password form is hidden for everyone except `organization:manage`. */
  enforced: boolean;
}

/**
 * The provider as the settings screen reads and writes it. The client secret itself is
 * never returned by any endpoint — `hasClientSecret` is all a reader ever sees, and an
 * update that omits `clientSecret` leaves the stored one alone.
 */
export interface SsoSettings {
  protocol: SsoProtocol;
  displayName: string;
  issuerUrl: string;
  clientId: string;
  hasClientSecret: boolean;
  /** Space-separated, as OIDC scopes travel on the wire. Default `openid email profile`. */
  scopes: string;
  /** Which ID-token claim carries the email address. Default `email`. */
  emailClaim: string;
  /** Empty means any domain may sign in through this provider. */
  allowedDomains: string[];
  enabled: boolean;
  enforced: boolean;
  lastTestedAt: string | null;
  lastTestError: string | null;
  /** `<API_PUBLIC_URL>/api/auth/sso/callback` — read-only, for pasting into the IdP. */
  redirectUri: string;
}

export interface UpdateSsoSettingsRequest {
  displayName: string;
  issuerUrl: string;
  clientId: string;
  /** Omit to leave the stored secret alone; required the first time a provider is created. */
  clientSecret?: string;
  scopes?: string;
  emailClaim?: string;
  allowedDomains?: string[];
  enabled: boolean;
  enforced: boolean;
}

export interface SsoTestResult {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
}

/**
 * The closed set of failure reasons a callback (or an enforced password login) can end
 * in. Carried in `/login?error=<code>` and as the message of the 403 `login` throws
 * under enforcement, so the web app can show real copy instead of "something went wrong".
 */
export const SSO_ERROR_CODES = [
  'sso_disabled',
  'invalid_state',
  'exchange_failed',
  'invalid_token',
  'no_email',
  'domain_not_allowed',
  'no_account',
  'account_disabled',
  'sso_required',
] as const;

export type SsoErrorCode = (typeof SSO_ERROR_CODES)[number];

export function isSsoErrorCode(value: string): value is SsoErrorCode {
  return (SSO_ERROR_CODES as readonly string[]).includes(value);
}
