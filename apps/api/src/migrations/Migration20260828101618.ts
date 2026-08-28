import { Migration } from '@mikro-orm/migrations';

export class Migration20260828101618 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "roles" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "organization_id" uuid not null, "key" varchar(64) not null, "name" varchar(100) not null, "permissions" jsonb not null, "is_system" boolean not null default false, constraint "roles_pkey" primary key ("id"));`);
    this.addSql(`create index "roles_organization_id_index" on "roles" ("organization_id");`);
    this.addSql(`alter table "roles" add constraint "roles_organization_id_key_unique" unique ("organization_id", "key");`);

    this.addSql(`create table "users" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "organization_id" uuid not null, "email" varchar(320) not null, "password_hash" varchar(255) null, "first_name" varchar(100) not null, "last_name" varchar(100) not null, "status" text check ("status" in ('invited', 'active', 'disabled')) not null default 'active', "locale" varchar(10) not null default 'en', "last_login_at" timestamptz null, constraint "users_pkey" primary key ("id"));`);
    this.addSql(`create index "users_organization_id_index" on "users" ("organization_id");`);
    this.addSql(`alter table "users" add constraint "users_organization_id_email_unique" unique ("organization_id", "email");`);

    this.addSql(`create table "refresh_tokens" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "organization_id" uuid not null, "user_id" uuid not null, "token_hash" varchar(64) not null, "expires_at" timestamptz not null, "revoked_at" timestamptz null, "replaced_by_hash" varchar(64) null, "user_agent" varchar(255) null, constraint "refresh_tokens_pkey" primary key ("id"));`);
    this.addSql(`create index "refresh_tokens_organization_id_index" on "refresh_tokens" ("organization_id");`);
    this.addSql(`create index "refresh_tokens_user_id_index" on "refresh_tokens" ("user_id");`);
    this.addSql(`alter table "refresh_tokens" add constraint "refresh_tokens_token_hash_unique" unique ("token_hash");`);

    this.addSql(`create table "user_roles" ("user_id" uuid not null, "role_id" uuid not null, constraint "user_roles_pkey" primary key ("user_id", "role_id"));`);

    this.addSql(`alter table "roles" add constraint "roles_organization_id_foreign" foreign key ("organization_id") references "organizations" ("id") on update cascade;`);

    this.addSql(`alter table "users" add constraint "users_organization_id_foreign" foreign key ("organization_id") references "organizations" ("id") on update cascade;`);

    this.addSql(`alter table "refresh_tokens" add constraint "refresh_tokens_organization_id_foreign" foreign key ("organization_id") references "organizations" ("id") on update cascade;`);
    this.addSql(`alter table "refresh_tokens" add constraint "refresh_tokens_user_id_foreign" foreign key ("user_id") references "users" ("id") on update cascade;`);

    this.addSql(`alter table "user_roles" add constraint "user_roles_user_id_foreign" foreign key ("user_id") references "users" ("id") on update cascade on delete cascade;`);
    this.addSql(`alter table "user_roles" add constraint "user_roles_role_id_foreign" foreign key ("role_id") references "roles" ("id") on update cascade on delete cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "user_roles" drop constraint "user_roles_role_id_foreign";`);

    this.addSql(`alter table "refresh_tokens" drop constraint "refresh_tokens_user_id_foreign";`);

    this.addSql(`alter table "user_roles" drop constraint "user_roles_user_id_foreign";`);

    this.addSql(`drop table if exists "roles" cascade;`);

    this.addSql(`drop table if exists "users" cascade;`);

    this.addSql(`drop table if exists "refresh_tokens" cascade;`);

    this.addSql(`drop table if exists "user_roles" cascade;`);
  }

}
