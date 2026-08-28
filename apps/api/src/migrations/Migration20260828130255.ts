import { Migration } from '@mikro-orm/migrations';

export class Migration20260828130255 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "holidays" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "organization_id" uuid not null, "date" date not null, "name" varchar(160) not null, "region" varchar(64) null, constraint "holidays_pkey" primary key ("id"));`);
    this.addSql(`create index "holidays_organization_id_index" on "holidays" ("organization_id");`);
    this.addSql(`create index "holidays_organization_id_date_index" on "holidays" ("organization_id", "date");`);
    this.addSql(`alter table "holidays" add constraint "holidays_organization_id_date_name_unique" unique ("organization_id", "date", "name");`);

    this.addSql(`create table "absence_types" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "organization_id" uuid not null, "key" varchar(64) not null, "name" varchar(120) not null, "deducts_from_quota" boolean not null default false, "paid" boolean not null default true, "counts_as_work" boolean not null default false, "color_role" text check ("color_role" in ('accent', 'warning', 'success', 'info', 'muted')) not null default 'accent', "active" boolean not null default true, "position" int not null default 0, constraint "absence_types_pkey" primary key ("id"));`);
    this.addSql(`create index "absence_types_organization_id_index" on "absence_types" ("organization_id");`);
    this.addSql(`alter table "absence_types" add constraint "absence_types_organization_id_key_unique" unique ("organization_id", "key");`);

    this.addSql(`create table "leave_balances" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "organization_id" uuid not null, "user_id" uuid not null, "year" int not null, "entitlement_days" numeric(5,2) not null default 0, "carry_over_days" numeric(5,2) not null default 0, "carry_over_expires_on" date null, "taken_days" numeric(5,2) not null default 0, constraint "leave_balances_pkey" primary key ("id"));`);
    this.addSql(`create index "leave_balances_organization_id_index" on "leave_balances" ("organization_id");`);
    this.addSql(`alter table "leave_balances" add constraint "leave_balances_user_id_year_unique" unique ("user_id", "year");`);

    this.addSql(`create table "absence_requests" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "organization_id" uuid not null, "user_id" uuid not null, "type_id" uuid not null, "starts_on" date not null, "ends_on" date not null, "half_day_start" boolean not null default false, "half_day_end" boolean not null default false, "status" text check ("status" in ('pending', 'approved', 'rejected', 'taken')) not null default 'pending', "cost_days" numeric(5,2) not null default 0, "approver_id" uuid null, "decided_by_id" uuid null, "decided_at" timestamptz null, "decision_note" varchar(1000) null, "note" varchar(1000) null, "document_id" uuid null, constraint "absence_requests_pkey" primary key ("id"));`);
    this.addSql(`create index "absence_requests_organization_id_index" on "absence_requests" ("organization_id");`);
    this.addSql(`create index "absence_requests_organization_id_status_index" on "absence_requests" ("organization_id", "status");`);
    this.addSql(`create index "absence_requests_organization_id_user_id_starts_on_index" on "absence_requests" ("organization_id", "user_id", "starts_on");`);

    this.addSql(`alter table "holidays" add constraint "holidays_organization_id_foreign" foreign key ("organization_id") references "organizations" ("id") on update cascade;`);

    this.addSql(`alter table "absence_types" add constraint "absence_types_organization_id_foreign" foreign key ("organization_id") references "organizations" ("id") on update cascade;`);

    this.addSql(`alter table "leave_balances" add constraint "leave_balances_organization_id_foreign" foreign key ("organization_id") references "organizations" ("id") on update cascade;`);
    this.addSql(`alter table "leave_balances" add constraint "leave_balances_user_id_foreign" foreign key ("user_id") references "users" ("id") on update cascade;`);

    this.addSql(`alter table "absence_requests" add constraint "absence_requests_organization_id_foreign" foreign key ("organization_id") references "organizations" ("id") on update cascade;`);
    this.addSql(`alter table "absence_requests" add constraint "absence_requests_user_id_foreign" foreign key ("user_id") references "users" ("id") on update cascade;`);
    this.addSql(`alter table "absence_requests" add constraint "absence_requests_type_id_foreign" foreign key ("type_id") references "absence_types" ("id") on update cascade;`);
    this.addSql(`alter table "absence_requests" add constraint "absence_requests_approver_id_foreign" foreign key ("approver_id") references "users" ("id") on update cascade on delete set null;`);
    this.addSql(`alter table "absence_requests" add constraint "absence_requests_decided_by_id_foreign" foreign key ("decided_by_id") references "users" ("id") on update cascade on delete set null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "absence_requests" drop constraint "absence_requests_type_id_foreign";`);

    this.addSql(`drop table if exists "holidays" cascade;`);

    this.addSql(`drop table if exists "absence_types" cascade;`);

    this.addSql(`drop table if exists "leave_balances" cascade;`);

    this.addSql(`drop table if exists "absence_requests" cascade;`);
  }

}
