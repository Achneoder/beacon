import { Migration } from '@mikro-orm/migrations';

/**
 * Makes `Organization.defaultLocale` mean what its name and its label ("Default
 * language") promise.
 *
 * `users.locale` and `invitations.locale` were `not null default 'en'`, so the
 * organization's default was read exactly once — for the owner, at registration —
 * and never again. Everyone invited afterwards was pinned to `en` in the database,
 * and changing the organization's language moved nobody. Both columns become
 * nullable, with null meaning "follow the organization", which is already how the
 * `timezone` column beside each of them works.
 *
 * Existing rows are set to null rather than kept. Nothing in Beacon has ever offered
 * a person a way to choose their own language — there is no picker in the web app and
 * the invitation form sends no locale — so every stored `'en'` is the column default
 * asserting itself, not a preference anybody expressed. Keeping them would leave the
 * whole installation pinned to English, which is the bug. The owner's row is the one
 * arguable case, and it was seeded from `organizations.default_locale` at
 * registration, so following it now lands on the same language it was given.
 *
 * `down` restores the constraint by writing the organization's default into every
 * row it is about to make not-null, so reversing this loses the indirection but not
 * the language anyone is actually seeing.
 */
export class Migration20260901090000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "users" alter column "locale" drop default;`);
    this.addSql(`alter table "users" alter column "locale" drop not null;`);
    this.addSql(`update "users" set "locale" = null;`);

    this.addSql(`alter table "invitations" alter column "locale" drop default;`);
    this.addSql(`alter table "invitations" alter column "locale" drop not null;`);
    this.addSql(`update "invitations" set "locale" = null where "accepted_at" is null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`
      update "users" "u"
      set "locale" = "o"."default_locale"
      from "organizations" "o"
      where "o"."id" = "u"."organization_id" and "u"."locale" is null;
    `);
    this.addSql(`alter table "users" alter column "locale" set default 'en';`);
    this.addSql(`alter table "users" alter column "locale" set not null;`);

    this.addSql(`
      update "invitations" "i"
      set "locale" = "o"."default_locale"
      from "organizations" "o"
      where "o"."id" = "i"."organization_id" and "i"."locale" is null;
    `);
    this.addSql(`alter table "invitations" alter column "locale" set default 'en';`);
    this.addSql(`alter table "invitations" alter column "locale" set not null;`);
  }

}
