import type { Permission } from './permissions.js';
import type { AuthenticatedUser } from './organization.js';

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
  /** Seeds both `Organization.defaultLocale` and the owner's own locale. */
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
  locale: string;
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
  key: string;
  name: string;
  permissions: Permission[];
  isSystem: boolean;
}

export interface UpdateOrganizationRequest {
  name?: string;
  defaultLocale?: string;
  timezone?: string;
}

export interface OrganizationSummary {
  id: string;
  name: string;
  slug: string;
  defaultLocale: string;
  timezone: string;
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
