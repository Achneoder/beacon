import { Migration } from '@mikro-orm/migrations';

export class Migration20260904102902 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "projects" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "organization_id" uuid not null, "name" varchar(200) not null, "client_name" varchar(200) null, "description" varchar(1000) null, "hourly_rate" numeric(10,2) null, "active" boolean not null default true, constraint "projects_pkey" primary key ("id"));`);
    this.addSql(`create index "projects_organization_id_index" on "projects" ("organization_id");`);

    this.addSql(`create table "tasks" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "organization_id" uuid not null, "project_id" uuid not null, "name" varchar(200) not null, "hourly_rate" numeric(10,2) null, "active" boolean not null default true, constraint "tasks_pkey" primary key ("id"));`);
    this.addSql(`create index "tasks_organization_id_index" on "tasks" ("organization_id");`);
    this.addSql(`create index "tasks_organization_id_project_id_index" on "tasks" ("organization_id", "project_id");`);

    this.addSql(`create table "time_entries" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "organization_id" uuid not null, "user_id" uuid not null, "project_id" uuid not null, "task_id" uuid null, "local_date" date not null, "started_at" timestamptz null, "ended_at" timestamptz null, "duration_minutes" int null, "billable" boolean not null default true, "rate_at_entry" numeric(10,2) null, "amount" numeric(12,2) null, "source" text check ("source" in ('timer', 'manual')) not null default 'manual', "note" varchar(500) null, constraint "time_entries_pkey" primary key ("id"));`);
    this.addSql(`create index "time_entries_organization_id_index" on "time_entries" ("organization_id");`);
    this.addSql(`create unique index "time_entries_one_running_per_user" on "time_entries" ("user_id") where "started_at" is not null and "ended_at" is null;`);
    this.addSql(`create index "time_entries_organization_id_project_id_index" on "time_entries" ("organization_id", "project_id");`);
    this.addSql(`create index "time_entries_user_id_local_date_index" on "time_entries" ("user_id", "local_date");`);

    this.addSql(`alter table "projects" add constraint "projects_organization_id_foreign" foreign key ("organization_id") references "organizations" ("id") on update cascade;`);

    this.addSql(`alter table "tasks" add constraint "tasks_organization_id_foreign" foreign key ("organization_id") references "organizations" ("id") on update cascade;`);
    this.addSql(`alter table "tasks" add constraint "tasks_project_id_foreign" foreign key ("project_id") references "projects" ("id") on update cascade;`);

    this.addSql(`alter table "time_entries" add constraint "time_entries_organization_id_foreign" foreign key ("organization_id") references "organizations" ("id") on update cascade;`);
    this.addSql(`alter table "time_entries" add constraint "time_entries_user_id_foreign" foreign key ("user_id") references "users" ("id") on update cascade;`);
    this.addSql(`alter table "time_entries" add constraint "time_entries_project_id_foreign" foreign key ("project_id") references "projects" ("id") on update cascade;`);
    this.addSql(`alter table "time_entries" add constraint "time_entries_task_id_foreign" foreign key ("task_id") references "tasks" ("id") on update cascade on delete set null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "tasks" drop constraint "tasks_project_id_foreign";`);

    this.addSql(`alter table "time_entries" drop constraint "time_entries_project_id_foreign";`);

    this.addSql(`alter table "time_entries" drop constraint "time_entries_task_id_foreign";`);

    this.addSql(`drop table if exists "projects" cascade;`);

    this.addSql(`drop table if exists "tasks" cascade;`);

    this.addSql(`drop table if exists "time_entries" cascade;`);
  }

}
