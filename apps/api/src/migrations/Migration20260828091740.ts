import { Migration } from '@mikro-orm/migrations';

export class Migration20260828091740 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "organizations" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "name" varchar(200) not null, "slug" varchar(100) not null, "default_locale" varchar(10) not null default 'en', "timezone" varchar(64) not null default 'UTC', constraint "organizations_pkey" primary key ("id"));`);
    this.addSql(`alter table "organizations" add constraint "organizations_slug_unique" unique ("slug");`);
  }

}
