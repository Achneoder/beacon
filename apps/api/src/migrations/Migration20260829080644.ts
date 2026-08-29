import { Migration } from '@mikro-orm/migrations';

export class Migration20260829080644 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "sso_login_attempts" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "organization_id" uuid not null, "state_hash" varchar(64) not null, "nonce" varchar(255) not null, "code_verifier" varchar(255) not null, "expires_at" timestamptz not null, "consumed_at" timestamptz null, "user_agent" varchar(255) null, constraint "sso_login_attempts_pkey" primary key ("id"));`);
    this.addSql(`create index "sso_login_attempts_organization_id_index" on "sso_login_attempts" ("organization_id");`);
    this.addSql(`alter table "sso_login_attempts" add constraint "sso_login_attempts_state_hash_unique" unique ("state_hash");`);

    this.addSql(`create table "sso_providers" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "organization_id" uuid not null, "protocol" varchar(16) not null default 'oidc', "display_name" varchar(100) not null, "issuer_url" varchar(2048) not null, "client_id" varchar(255) not null, "client_secret_ciphertext" text not null, "client_secret_iv" varchar(64) not null, "scopes" varchar(255) not null default 'openid email profile', "email_claim" varchar(100) not null default 'email', "allowed_domains" jsonb not null, "enabled" boolean not null default false, "enforced" boolean not null default false, "last_tested_at" timestamptz null, "last_test_error" text null, constraint "sso_providers_pkey" primary key ("id"));`);
    this.addSql(`create index "sso_providers_organization_id_index" on "sso_providers" ("organization_id");`);
    this.addSql(`alter table "sso_providers" add constraint "sso_providers_organization_id_unique" unique ("organization_id");`);

    this.addSql(`alter table "sso_login_attempts" add constraint "sso_login_attempts_organization_id_foreign" foreign key ("organization_id") references "organizations" ("id") on update cascade;`);

    this.addSql(`alter table "sso_providers" add constraint "sso_providers_organization_id_foreign" foreign key ("organization_id") references "organizations" ("id") on update cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "sso_login_attempts" cascade;`);

    this.addSql(`drop table if exists "sso_providers" cascade;`);
  }

}
