import { Migration } from '@mikro-orm/migrations';

export class Migration20260828160908 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "document_categories" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "organization_id" uuid not null, "key" varchar(64) not null, "name" varchar(120) not null, "position" int not null default 0, "active" boolean not null default true, constraint "document_categories_pkey" primary key ("id"));`);
    this.addSql(`create index "document_categories_organization_id_index" on "document_categories" ("organization_id");`);
    this.addSql(`alter table "document_categories" add constraint "document_categories_organization_id_key_unique" unique ("organization_id", "key");`);

    this.addSql(`create table "documents" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "organization_id" uuid not null, "owner_id" uuid null, "title" varchar(255) not null, "category_id" uuid not null, "current_version_id" uuid null, "retention_until" date null, "deleted_at" timestamptz null, "deleted_by_id" uuid null, constraint "documents_pkey" primary key ("id"));`);
    this.addSql(`create index "documents_organization_id_index" on "documents" ("organization_id");`);
    this.addSql(`create index "documents_organization_id_category_id_index" on "documents" ("organization_id", "category_id");`);
    this.addSql(`create index "documents_organization_id_owner_id_index" on "documents" ("organization_id", "owner_id");`);

    this.addSql(`create table "document_versions" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "organization_id" uuid not null, "document_id" uuid not null, "version_number" int not null, "storage_key" varchar(512) not null, "size" int not null, "content_type" varchar(120) not null, "checksum" varchar(64) not null, "original_filename" varchar(255) not null, "uploaded_by_id" uuid null, constraint "document_versions_pkey" primary key ("id"));`);
    this.addSql(`create index "document_versions_organization_id_index" on "document_versions" ("organization_id");`);
    this.addSql(`create index "document_versions_organization_id_document_id_index" on "document_versions" ("organization_id", "document_id");`);
    this.addSql(`alter table "document_versions" add constraint "document_versions_document_id_version_number_unique" unique ("document_id", "version_number");`);

    this.addSql(`create table "document_access" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "organization_id" uuid not null, "document_id" uuid not null, "subject" text check ("subject" in ('user', 'department', 'role')) not null, "user_id" uuid null, "department_id" uuid null, "role_id" uuid null, "level" text check ("level" in ('read', 'write')) not null default 'read', "granted_by_id" uuid null, constraint "document_access_pkey" primary key ("id"));`);
    this.addSql(`create index "document_access_organization_id_index" on "document_access" ("organization_id");`);
    this.addSql(`create index "document_access_organization_id_role_id_index" on "document_access" ("organization_id", "role_id");`);
    this.addSql(`create index "document_access_organization_id_department_id_index" on "document_access" ("organization_id", "department_id");`);
    this.addSql(`create index "document_access_organization_id_user_id_index" on "document_access" ("organization_id", "user_id");`);
    this.addSql(`alter table "document_access" add constraint "document_access_document_id_role_id_unique" unique ("document_id", "role_id");`);
    this.addSql(`alter table "document_access" add constraint "document_access_document_id_department_id_unique" unique ("document_id", "department_id");`);
    this.addSql(`alter table "document_access" add constraint "document_access_document_id_user_id_unique" unique ("document_id", "user_id");`);

    this.addSql(`alter table "document_categories" add constraint "document_categories_organization_id_foreign" foreign key ("organization_id") references "organizations" ("id") on update cascade;`);

    this.addSql(`alter table "documents" add constraint "documents_organization_id_foreign" foreign key ("organization_id") references "organizations" ("id") on update cascade;`);
    this.addSql(`alter table "documents" add constraint "documents_owner_id_foreign" foreign key ("owner_id") references "users" ("id") on update cascade on delete restrict;`);
    this.addSql(`alter table "documents" add constraint "documents_category_id_foreign" foreign key ("category_id") references "document_categories" ("id") on update cascade on delete restrict;`);
    this.addSql(`alter table "documents" add constraint "documents_current_version_id_foreign" foreign key ("current_version_id") references "document_versions" ("id") on update cascade on delete set null;`);
    this.addSql(`alter table "documents" add constraint "documents_deleted_by_id_foreign" foreign key ("deleted_by_id") references "users" ("id") on update cascade on delete set null;`);

    this.addSql(`alter table "document_versions" add constraint "document_versions_organization_id_foreign" foreign key ("organization_id") references "organizations" ("id") on update cascade;`);
    this.addSql(`alter table "document_versions" add constraint "document_versions_document_id_foreign" foreign key ("document_id") references "documents" ("id") on update cascade on delete cascade;`);
    this.addSql(`alter table "document_versions" add constraint "document_versions_uploaded_by_id_foreign" foreign key ("uploaded_by_id") references "users" ("id") on update cascade on delete set null;`);

    this.addSql(`alter table "document_access" add constraint "document_access_organization_id_foreign" foreign key ("organization_id") references "organizations" ("id") on update cascade;`);
    this.addSql(`alter table "document_access" add constraint "document_access_document_id_foreign" foreign key ("document_id") references "documents" ("id") on update cascade on delete cascade;`);
    this.addSql(`alter table "document_access" add constraint "document_access_user_id_foreign" foreign key ("user_id") references "users" ("id") on update cascade on delete cascade;`);
    this.addSql(`alter table "document_access" add constraint "document_access_department_id_foreign" foreign key ("department_id") references "departments" ("id") on update cascade on delete cascade;`);
    this.addSql(`alter table "document_access" add constraint "document_access_role_id_foreign" foreign key ("role_id") references "roles" ("id") on update cascade on delete cascade;`);
    this.addSql(`alter table "document_access" add constraint "document_access_granted_by_id_foreign" foreign key ("granted_by_id") references "users" ("id") on update cascade on delete set null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "documents" drop constraint "documents_category_id_foreign";`);

    this.addSql(`alter table "document_versions" drop constraint "document_versions_document_id_foreign";`);

    this.addSql(`alter table "document_access" drop constraint "document_access_document_id_foreign";`);

    this.addSql(`alter table "documents" drop constraint "documents_current_version_id_foreign";`);

    this.addSql(`drop table if exists "document_categories" cascade;`);

    this.addSql(`drop table if exists "documents" cascade;`);

    this.addSql(`drop table if exists "document_versions" cascade;`);

    this.addSql(`drop table if exists "document_access" cascade;`);
  }

}
