/**
 * People: the users an organization employs, and the department / team structure they
 * hang off. Everything else in Beacon — attendance, absence, documents — scopes to a
 * person, so these shapes come first.
 *
 * The API is the only contract: these types are imported by the web app as
 * `@beacon/shared` and never redeclared there.
 */

/** Lifecycle of an account. A user with history is disabled, never deleted. */
export const USER_STATUSES = ['invited', 'active', 'disabled'] as const;

export type UserStatusValue = (typeof USER_STATUSES)[number];

/**
 * Contract shape, as the Profile screen prints it — the two axes the canvas shows
 * ("Permanent · Full-time") collapsed into one stored value, because every real
 * combination is meaningful and a pair of booleans would allow none.
 */
export const CONTRACT_TYPES = [
  'permanent-full-time',
  'permanent-part-time',
  'fixed-term-full-time',
  'fixed-term-part-time',
] as const;

export type ContractType = (typeof CONTRACT_TYPES)[number];

/** How the person works from their office — the second half of "Berlin · Hybrid". */
export const WORK_LOCATIONS = ['on-site', 'hybrid', 'remote'] as const;

export type WorkLocation = (typeof WORK_LOCATIONS)[number];

export interface DepartmentSummary {
  id: string;
  name: string;
  /** Members, so the people list can show a count without a second query. */
  memberCount: number;
}

export interface TeamSummary {
  id: string;
  name: string;
  departmentId: string | null;
  memberCount: number;
}

export interface CreateDepartmentRequest {
  name: string;
}

export interface CreateTeamRequest {
  name: string;
  departmentId?: string | null;
}

/** The row shape for `/people` and for any "who is this" reference elsewhere. */
export interface UserSummary {
  id: string;
  employeeNumber: string | null;
  email: string;
  firstName: string;
  lastName: string;
  jobTitle: string | null;
  status: UserStatusValue;
  departmentId: string | null;
  departmentName: string | null;
  teamId: string | null;
  teamName: string | null;
}

/** Everything the Profile screen draws, plus the fields only a manager may edit. */
export interface UserDetail extends UserSummary {
  locale: string;
  timezone: string | null;
  phone: string | null;
  contractType: ContractType | null;
  /** The office, e.g. "Berlin"; `workLocation` says how the person works from it. */
  office: string | null;
  workLocation: WorkLocation | null;
  startsOn: string | null;
  endsOn: string | null;
  managerId: string | null;
  /** Denormalised so the *Reports to* card needs no second request. */
  managerName: string | null;
  managerJobTitle: string | null;
  /** Display only — `session.can()` still decides what the UI offers. */
  roles: { id: string; key: string; name: string }[];
  lastLoginAt: string | null;
}

/** The employment fields, shared by create and update so the two cannot drift. */
export interface EmploymentFields {
  employeeNumber?: string | null;
  jobTitle?: string | null;
  departmentId?: string | null;
  teamId?: string | null;
  managerId?: string | null;
  contractType?: ContractType | null;
  office?: string | null;
  workLocation?: WorkLocation | null;
  phone?: string | null;
  timezone?: string | null;
  locale?: string;
  startsOn?: string | null;
  endsOn?: string | null;
}

export interface CreateUserRequest extends EmploymentFields {
  email: string;
  firstName: string;
  lastName: string;
  /** Role ids to grant. Omitted means the organization's `employee` role. */
  roleIds?: string[];
}

export type UpdateUserRequest = Partial<Omit<CreateUserRequest, 'email' | 'roleIds'>> & {
  status?: UserStatusValue;
};

/** What a person may change about themselves — nothing that affects employment. */
export interface UpdateOwnProfileRequest {
  phone?: string | null;
  locale?: string;
  timezone?: string | null;
}

export interface SetUserRolesRequest {
  roleIds: string[];
}

export interface InvitationSummary {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  roles: { id: string; key: string; name: string }[];
  invitedByName: string | null;
  expiresAt: string;
  acceptedAt: string | null;
  /** Derived server-side: expired invitations are listed but not acceptable. */
  isExpired: boolean;
}

export interface CreateInvitationRequest extends EmploymentFields {
  email: string;
  firstName: string;
  lastName: string;
  roleIds?: string[];
}

/**
 * The token *is* the credential, so acceptance is public: it names no organization and
 * no user id, and the server resolves both from the token's hash.
 */
export interface AcceptInvitationRequest {
  token: string;
  password: string;
}

/** How a newly created invitation is handed back — the only time the token is visible. */
export interface CreatedInvitation extends InvitationSummary {
  /** Stored only as a SHA-256 hash, so this is never retrievable again. */
  token: string;
  /** Ready to paste into an email until the notification seam exists. */
  acceptUrl: string;
}

const EMPLOYEE_NUMBER_DIGITS = 4;

/**
 * `BCN-0148` — a per-organization running number, zero-padded to four digits and
 * widening past that rather than wrapping. Formatting lives here, not in the API, so
 * the web app and the future clients render an unsaved preview the same way.
 */
export function formatEmployeeNumber(sequence: number, prefix = 'BCN'): string {
  return `${prefix}-${String(Math.max(1, Math.trunc(sequence))).padStart(EMPLOYEE_NUMBER_DIGITS, '0')}`;
}

/** The sequence back out of `BCN-0148`, or null for anything hand-typed. */
export function parseEmployeeNumber(value: string, prefix = 'BCN'): number | null {
  const match = new RegExp(`^${prefix}-(\\d+)$`).exec(value.trim());
  const sequence = match ? Number(match[1]) : Number.NaN;

  return Number.isInteger(sequence) && sequence > 0 ? sequence : null;
}

/** `Ada Lovelace` — one place, so every list, card and approver line agrees. */
export function fullName(person: { firstName: string; lastName: string }): string {
  return `${person.firstName} ${person.lastName}`.trim();
}

/** `AL` for the avatar; falls back to the first letter when there is only one name. */
export function initialsOf(person: { firstName: string; lastName: string }): string {
  const first = person.firstName.trim().charAt(0);
  const last = person.lastName.trim().charAt(0);

  return `${first}${last}`.toUpperCase() || '?';
}
