import { Migration } from '@mikro-orm/migrations';

/**
 * Adds `roles.customized`, the flag that lets an organization edit a built-in role
 * without the next restart undoing it.
 *
 * `OrganizationService.reconcileSystemRoles` rewrites every system role from
 * `DEFAULT_ROLES` at boot — how a permission added by an upgrade reaches installs that
 * predate it. Until now nothing could edit those roles, so overwriting them was free.
 * The role editor changes that, and drift is not enough to tell "somebody edited this"
 * from "an upgrade added a default": both look like a role whose permissions differ
 * from the shipped list. So the edit is recorded instead of inferred, and reconcile
 * skips whatever carries the flag.
 *
 * Every existing row is false, which is correct: no release before this one offered a
 * way to edit a role, so every stored permission list is still the shipped one.
 */
export class Migration20260901120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "roles" add column "customized" boolean not null default false;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "roles" drop column "customized";`);
  }

}
