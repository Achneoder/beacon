import { Migration } from '@mikro-orm/migrations';

/**
 * The organization-level switch that lets people correct their own timesheet without
 * a manager deciding it.
 *
 * `false` for every existing row, and as the column default: approval is the
 * arrangement `AttendanceService.requestCorrection` was built around, and an
 * installation upgrading into this column must not have the safeguard dropped by an
 * upgrade it did not ask for. Turning it on is an administrator's decision, made in
 * Settings → Organization.
 */
export class Migration20260901120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(
      `alter table "organizations" add column "self_approve_corrections" boolean not null default false;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "organizations" drop column "self_approve_corrections";`);
  }

}
