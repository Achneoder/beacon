import { ForbiddenException } from '@nestjs/common';
import { isSelfServicePermission, type Permission } from '@beacon/shared';

/** Just enough of a `Role` to judge a grant — so this stays clear of the ORM. */
export interface GrantableRole {
  name: string;
  permissions: readonly Permission[];
}

/**
 * Refuses a grant that would hand out authority the granter does not have.
 *
 * `employee:manage` is what lets a caller assign roles — to a new user, to an
 * invitation, or to an existing account. Without this check it was also, transitively,
 * a way to *acquire* any permission in the system: the built-in `admin` role holds
 * `employee:manage` but deliberately not `organization:manage`, and nothing stopped an
 * admin from reading the `owner` role's id off `GET /organizations/current/roles` and
 * assigning it to themselves. `organization:manage` is not a cosmetic step up — it
 * gates the SSO provider settings, and it is the permission `AuthService.login` exempts
 * from SSO enforcement, so reaching it also reopens the password door an administrator
 * closed.
 *
 * The rule is "you may not grant what you do not hold", with `SELF_SERVICE_PERMISSIONS`
 * exempted — see that constant for why a plain subset rule would break the ordinary
 * case of an admin inviting an employee.
 *
 * Granting to *yourself* needs no separate rule: under this one a caller can only ever
 * hand out authority they already have, so self-assignment cannot gain them anything.
 */
export function assertGrantable(granter: readonly Permission[], roles: readonly GrantableRole[]): void {
  const held = new Set(granter);

  for (const role of roles) {
    const missing = role.permissions.filter(
      (permission) => !held.has(permission) && !isSelfServicePermission(permission),
    );

    if (missing.length > 0) {
      // Names the permission rather than the role, because roles are customizable per
      // organization and "you cannot grant owner" would be meaningless for a role
      // somebody defined themselves.
      throw new ForbiddenException(
        `you may not grant "${role.name}": it holds ${missing.join(', ')}, which you do not`,
      );
    }
  }
}
