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
