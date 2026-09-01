import type { Permission } from './permissions.js';
import type { AuthenticatedUser } from './organization.js';
import type { LocaleCode } from './locale.js';

/**
 * Signing up creates the organization and its owner in one step — there is no
 * organization to join yet, so registration carries both halves.
 */
export interface RegisterOrganizationRequest {
  organizationName: string;
  /** Derived from the organization name when omitted. */
  slug?: string;
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  /** Seeds `Organization.defaultLocale`; the owner then follows it like everyone else. */
  locale?: string;
  timezone?: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

/**
 * The signed-in user as the frontend needs it: the authorization facts from
 * `AuthenticatedUser` plus what the UI has to display.
 */
export interface SessionUser extends AuthenticatedUser {
  firstName: string;
  lastName: string;
  /**
   * The language the SPA should render in — already resolved by the API, which is
   * the only side that holds both halves: the user's own choice when they made one,
   * the organization's `defaultLocale` otherwise. `UserDetail.locale` is the raw,
   * still-nullable preference; this is the answer.
   */
  locale: LocaleCode;
  /**
   * The header states whose clock it is from the very first screen, so the session
   * carries the user's own zone. Null means "use the organization's".
   */
  timezone: string | null;
  /** Shown under the name in the sidebar's user card. */
  jobTitle: string | null;
  /** For display only — authorization always goes through `permissions`. */
  roleKeys: string[];
  organizationName: string;
  organizationSlug: string;
}

export interface AuthResponse {
  accessToken: string;
  /** Access token lifetime in seconds. */
  expiresIn: number;
  user: SessionUser;
}

export interface RoleSummary {
  id: string;
  /** Derived from the name once, at creation, and stable afterwards — the web looks
   *  up built-in copy by it (`roles.owner`), so a rename must not move it. */
  key: string;
  name: string;
  permissions: Permission[];
  /** Seeded from `DEFAULT_ROLES`. Built-in roles are never deletable. */
  isSystem: boolean;
  /**
   * A built-in role whose permissions this organization has edited. The API stops
   * re-syncing such a role from `DEFAULT_ROLES` at boot, so the flag is the difference
   * between "still the shipped definition" and "somebody's own".
   */
  customized: boolean;
  /** Active and invited people holding it — what makes a delete refusable up front. */
  memberCount: number;
}

/**
 * Defining a role is an act of *granting*: the permissions named here become
 * assignable, and — if the author assigns it to themselves — theirs. Both role
 * mutations therefore run through the same `assertGrantable` every other grant path
 * does, so a caller can never package authority they do not already hold.
 */
export interface CreateRoleRequest {
  name: string;
  permissions: Permission[];
}

/** Both fields are optional; a built-in role accepts only `permissions`. */
export interface UpdateRoleRequest {
  name?: string;
  permissions?: Permission[];
}

export interface UpdateOrganizationRequest {
  name?: string;
  /**
   * The language everyone who has not chosen one of their own sees. Must be one of
   * `SUPPORTED_LOCALES` — a language with no dictionary would change nothing.
   */
  defaultLocale?: LocaleCode;
  timezone?: string;
  /**
   * Whether a person's own timesheet correction takes effect on the spot instead of
   * waiting for their manager. Off by default: approval is the safer arrangement, so
   * dropping it has to be an administrator's explicit decision.
   */
  selfApproveCorrections?: boolean;
}

export interface OrganizationSummary {
  id: string;
  name: string;
  slug: string;
  defaultLocale: LocaleCode;
  timezone: string;
  /** See {@link UpdateOrganizationRequest.selfApproveCorrections}. */
  selfApproveCorrections: boolean;
}

/**
 * Beacon is installed for one organization, not run as a multi-tenant service: the
 * first registration creates it and closes the door behind itself. The login and
 * register screens ask for this before offering to create anything.
 */
export interface SetupState {
  /** True only while no organization exists — that is, while registration would succeed. */
  setupRequired: boolean;
}
