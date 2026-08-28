import { Migration } from '@mikro-orm/migrations';

export class Migration20260828122401 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "overtime_balances" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "organization_id" uuid not null, "user_id" uuid not null, "balance_minutes" int not null default 0, "cap_minutes" int not null default 2400, constraint "overtime_balances_pkey" primary key ("id"));`);
    this.addSql(`create index "overtime_balances_organization_id_index" on "overtime_balances" ("organization_id");`);
    this.addSql(`alter table "overtime_balances" add constraint "overtime_balances_user_id_unique" unique ("user_id");`);

    this.addSql(`create table "attendance_entries" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "organization_id" uuid not null, "user_id" uuid not null, "started_at" timestamptz not null, "ended_at" timestamptz null, "local_date" date not null, "source" text check ("source" in ('manual', 'web', 'mobile', 'desktop', 'badge')) not null default 'web', "note" varchar(500) null, "approval_status" text check ("approval_status" in ('approved', 'pending', 'rejected')) not null default 'approved', constraint "attendance_entries_pkey" primary key ("id"));`);
    this.addSql(`create index "attendance_entries_organization_id_index" on "attendance_entries" ("organization_id");`);
    this.addSql(`create unique index "attendance_entries_one_open_per_user" on "attendance_entries" ("user_id") where "ended_at" is null;`);
    this.addSql(`create index "attendance_entries_user_id_local_date_index" on "attendance_entries" ("user_id", "local_date");`);

    this.addSql(`create table "break_entries" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "organization_id" uuid not null, "entry_id" uuid not null, "started_at" timestamptz not null, "ended_at" timestamptz null, constraint "break_entries_pkey" primary key ("id"));`);
    this.addSql(`create index "break_entries_organization_id_index" on "break_entries" ("organization_id");`);

    this.addSql(`create table "attendance_days" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "organization_id" uuid not null, "user_id" uuid not null, "local_date" date not null, "worked_minutes" int not null default 0, "target_minutes" int not null default 0, "balance_minutes" int not null default 0, constraint "attendance_days_pkey" primary key ("id"));`);
    this.addSql(`create index "attendance_days_organization_id_index" on "attendance_days" ("organization_id");`);
    this.addSql(`create index "attendance_days_organization_id_local_date_index" on "attendance_days" ("organization_id", "local_date");`);
    this.addSql(`alter table "attendance_days" add constraint "attendance_days_user_id_local_date_unique" unique ("user_id", "local_date");`);

    this.addSql(`create table "attendance_corrections" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "organization_id" uuid not null, "user_id" uuid not null, "entry_id" uuid null, "kind" text check ("kind" in ('add', 'amend', 'remove')) not null, "local_date" date not null, "started_at" timestamptz null, "ended_at" timestamptz null, "break_minutes" int not null default 0, "reason" varchar(1000) not null, "status" text check ("status" in ('approved', 'pending', 'rejected')) not null default 'pending', "approver_id" uuid null, "decided_by_id" uuid null, "decided_at" timestamptz null, "decision_note" varchar(1000) null, constraint "attendance_corrections_pkey" primary key ("id"));`);
    this.addSql(`create index "attendance_corrections_organization_id_index" on "attendance_corrections" ("organization_id");`);
    this.addSql(`create index "attendance_corrections_organization_id_status_index" on "attendance_corrections" ("organization_id", "status");`);

    this.addSql(`create table "work_schedules" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "organization_id" uuid not null, "user_id" uuid not null, "model" text check ("model" in ('flextime', 'fixed', 'trust', 'shift')) not null default 'flextime', "weekly_minutes" int not null, "expected_minutes" jsonb not null, "core_start" varchar(5) null, "core_end" varchar(5) null, "start_time" varchar(5) null, "end_time" varchar(5) null, "roster_ref" varchar(120) null, "effective_from" date not null, constraint "work_schedules_pkey" primary key ("id"));`);
    this.addSql(`create index "work_schedules_organization_id_index" on "work_schedules" ("organization_id");`);
    this.addSql(`create index "work_schedules_user_id_effective_from_index" on "work_schedules" ("user_id", "effective_from");`);

    this.addSql(`alter table "overtime_balances" add constraint "overtime_balances_organization_id_foreign" foreign key ("organization_id") references "organizations" ("id") on update cascade;`);
    this.addSql(`alter table "overtime_balances" add constraint "overtime_balances_user_id_foreign" foreign key ("user_id") references "users" ("id") on update cascade;`);

    this.addSql(`alter table "attendance_entries" add constraint "attendance_entries_organization_id_foreign" foreign key ("organization_id") references "organizations" ("id") on update cascade;`);
    this.addSql(`alter table "attendance_entries" add constraint "attendance_entries_user_id_foreign" foreign key ("user_id") references "users" ("id") on update cascade;`);

    this.addSql(`alter table "break_entries" add constraint "break_entries_organization_id_foreign" foreign key ("organization_id") references "organizations" ("id") on update cascade;`);
    this.addSql(`alter table "break_entries" add constraint "break_entries_entry_id_foreign" foreign key ("entry_id") references "attendance_entries" ("id") on update cascade on delete cascade;`);

    this.addSql(`alter table "attendance_days" add constraint "attendance_days_organization_id_foreign" foreign key ("organization_id") references "organizations" ("id") on update cascade;`);
    this.addSql(`alter table "attendance_days" add constraint "attendance_days_user_id_foreign" foreign key ("user_id") references "users" ("id") on update cascade;`);

    this.addSql(`alter table "attendance_corrections" add constraint "attendance_corrections_organization_id_foreign" foreign key ("organization_id") references "organizations" ("id") on update cascade;`);
    this.addSql(`alter table "attendance_corrections" add constraint "attendance_corrections_user_id_foreign" foreign key ("user_id") references "users" ("id") on update cascade;`);
    this.addSql(`alter table "attendance_corrections" add constraint "attendance_corrections_entry_id_foreign" foreign key ("entry_id") references "attendance_entries" ("id") on update cascade on delete set null;`);
    this.addSql(`alter table "attendance_corrections" add constraint "attendance_corrections_approver_id_foreign" foreign key ("approver_id") references "users" ("id") on update cascade on delete set null;`);
    this.addSql(`alter table "attendance_corrections" add constraint "attendance_corrections_decided_by_id_foreign" foreign key ("decided_by_id") references "users" ("id") on update cascade on delete set null;`);

    this.addSql(`alter table "work_schedules" add constraint "work_schedules_organization_id_foreign" foreign key ("organization_id") references "organizations" ("id") on update cascade;`);
    this.addSql(`alter table "work_schedules" add constraint "work_schedules_user_id_foreign" foreign key ("user_id") references "users" ("id") on update cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "break_entries" drop constraint "break_entries_entry_id_foreign";`);

    this.addSql(`alter table "attendance_corrections" drop constraint "attendance_corrections_entry_id_foreign";`);

    this.addSql(`drop table if exists "overtime_balances" cascade;`);

    this.addSql(`drop table if exists "attendance_entries" cascade;`);

    this.addSql(`drop table if exists "break_entries" cascade;`);

    this.addSql(`drop table if exists "attendance_days" cascade;`);

    this.addSql(`drop table if exists "attendance_corrections" cascade;`);

    this.addSql(`drop table if exists "work_schedules" cascade;`);
  }

}
