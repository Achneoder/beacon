import { Migration } from '@mikro-orm/migrations';

export class Migration20260828113329 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "departments" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "organization_id" uuid not null, "name" varchar(120) not null, constraint "departments_pkey" primary key ("id"));`);
    this.addSql(`create index "departments_organization_id_index" on "departments" ("organization_id");`);
    this.addSql(`alter table "departments" add constraint "departments_organization_id_name_unique" unique ("organization_id", "name");`);

    this.addSql(`create table "teams" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "organization_id" uuid not null, "name" varchar(120) not null, "department_id" uuid null, constraint "teams_pkey" primary key ("id"));`);
    this.addSql(`create index "teams_organization_id_index" on "teams" ("organization_id");`);
    this.addSql(`alter table "teams" add constraint "teams_organization_id_name_unique" unique ("organization_id", "name");`);

    this.addSql(`create table "invitations" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "organization_id" uuid not null, "email" varchar(320) not null, "first_name" varchar(100) not null, "last_name" varchar(100) not null, "token_hash" varchar(64) not null, "expires_at" timestamptz not null, "accepted_at" timestamptz null, "invited_by_id" uuid null, "job_title" varchar(120) null, "department_id" uuid null, "team_id" uuid null, "manager_id" uuid null, "contract_type" text check ("contract_type" in ('permanent-full-time', 'permanent-part-time', 'fixed-term-full-time', 'fixed-term-part-time')) null, "office" varchar(120) null, "work_location" text check ("work_location" in ('on-site', 'hybrid', 'remote')) null, "timezone" varchar(64) null, "locale" varchar(10) not null default 'en', "starts_on" date null, constraint "invitations_pkey" primary key ("id"));`);
    this.addSql(`create index "invitations_organization_id_index" on "invitations" ("organization_id");`);
    this.addSql(`alter table "invitations" add constraint "invitations_token_hash_unique" unique ("token_hash");`);

    this.addSql(`create table "invitation_roles" ("invitation_id" uuid not null, "role_id" uuid not null, constraint "invitation_roles_pkey" primary key ("invitation_id", "role_id"));`);

    this.addSql(`alter table "departments" add constraint "departments_organization_id_foreign" foreign key ("organization_id") references "organizations" ("id") on update cascade;`);

    this.addSql(`alter table "teams" add constraint "teams_organization_id_foreign" foreign key ("organization_id") references "organizations" ("id") on update cascade;`);
    this.addSql(`alter table "teams" add constraint "teams_department_id_foreign" foreign key ("department_id") references "departments" ("id") on update cascade on delete set null;`);

    this.addSql(`alter table "invitations" add constraint "invitations_organization_id_foreign" foreign key ("organization_id") references "organizations" ("id") on update cascade;`);
    this.addSql(`alter table "invitations" add constraint "invitations_invited_by_id_foreign" foreign key ("invited_by_id") references "users" ("id") on update cascade on delete set null;`);
    this.addSql(`alter table "invitations" add constraint "invitations_department_id_foreign" foreign key ("department_id") references "departments" ("id") on update cascade on delete set null;`);
    this.addSql(`alter table "invitations" add constraint "invitations_team_id_foreign" foreign key ("team_id") references "teams" ("id") on update cascade on delete set null;`);
    this.addSql(`alter table "invitations" add constraint "invitations_manager_id_foreign" foreign key ("manager_id") references "users" ("id") on update cascade on delete set null;`);

    this.addSql(`alter table "invitation_roles" add constraint "invitation_roles_invitation_id_foreign" foreign key ("invitation_id") references "invitations" ("id") on update cascade on delete cascade;`);
    this.addSql(`alter table "invitation_roles" add constraint "invitation_roles_role_id_foreign" foreign key ("role_id") references "roles" ("id") on update cascade on delete cascade;`);

    this.addSql(`alter table "users" add column "timezone" varchar(64) null, add column "employee_number" varchar(32) null, add column "job_title" varchar(120) null, add column "department_id" uuid null, add column "team_id" uuid null, add column "manager_id" uuid null, add column "contract_type" text check ("contract_type" in ('permanent-full-time', 'permanent-part-time', 'fixed-term-full-time', 'fixed-term-part-time')) null, add column "office" varchar(120) null, add column "work_location" text check ("work_location" in ('on-site', 'hybrid', 'remote')) null, add column "phone" varchar(40) null, add column "starts_on" date null, add column "ends_on" date null;`);
    this.addSql(`alter table "users" add constraint "users_department_id_foreign" foreign key ("department_id") references "departments" ("id") on update cascade on delete set null;`);
    this.addSql(`alter table "users" add constraint "users_team_id_foreign" foreign key ("team_id") references "teams" ("id") on update cascade on delete set null;`);
    this.addSql(`alter table "users" add constraint "users_manager_id_foreign" foreign key ("manager_id") references "users" ("id") on update cascade on delete set null;`);
    this.addSql(`alter table "users" add constraint "users_organization_id_employee_number_unique" unique ("organization_id", "employee_number");`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "teams" drop constraint "teams_department_id_foreign";`);

    this.addSql(`alter table "users" drop constraint "users_department_id_foreign";`);

    this.addSql(`alter table "invitations" drop constraint "invitations_department_id_foreign";`);

    this.addSql(`alter table "users" drop constraint "users_team_id_foreign";`);

    this.addSql(`alter table "invitations" drop constraint "invitations_team_id_foreign";`);

    this.addSql(`alter table "invitation_roles" drop constraint "invitation_roles_invitation_id_foreign";`);

    this.addSql(`drop table if exists "departments" cascade;`);

    this.addSql(`drop table if exists "teams" cascade;`);

    this.addSql(`drop table if exists "invitations" cascade;`);

    this.addSql(`drop table if exists "invitation_roles" cascade;`);

    this.addSql(`alter table "users" drop constraint "users_manager_id_foreign";`);

    this.addSql(`alter table "users" drop constraint "users_organization_id_employee_number_unique";`);
    this.addSql(`alter table "users" drop column "timezone", drop column "employee_number", drop column "job_title", drop column "department_id", drop column "team_id", drop column "manager_id", drop column "contract_type", drop column "office", drop column "work_location", drop column "phone", drop column "starts_on", drop column "ends_on";`);
  }

}
