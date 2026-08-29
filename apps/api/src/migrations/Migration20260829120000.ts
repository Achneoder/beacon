import { Migration } from '@mikro-orm/migrations';

export class Migration20260829120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create index "users_manager_id_index" on "users" ("manager_id");`);
    this.addSql(`create index "users_department_id_index" on "users" ("department_id");`);
    this.addSql(`create index "users_team_id_index" on "users" ("team_id");`);
    this.addSql(`create index "attendance_corrections_user_id_local_date_index" on "attendance_corrections" ("user_id", "local_date");`);
    this.addSql(`create index "teams_department_id_index" on "teams" ("department_id");`);
    this.addSql(`create index "invitations_email_index" on "invitations" ("email");`);
    this.addSql(`create index "documents_deleted_at_index" on "documents" ("deleted_at");`);
    this.addSql(`create index "sso_login_attempts_expires_at_index" on "sso_login_attempts" ("expires_at");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "users_manager_id_index";`);
    this.addSql(`drop index if exists "users_department_id_index";`);
    this.addSql(`drop index if exists "users_team_id_index";`);
    this.addSql(`drop index if exists "attendance_corrections_user_id_local_date_index";`);
    this.addSql(`drop index if exists "teams_department_id_index";`);
    this.addSql(`drop index if exists "invitations_email_index";`);
    this.addSql(`drop index if exists "documents_deleted_at_index";`);
    this.addSql(`drop index if exists "sso_login_attempts_expires_at_index";`);
  }

}
