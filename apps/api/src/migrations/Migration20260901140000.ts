import { Migration } from '@mikro-orm/migrations';

/**
 * Time off in lieu: a day off paid for out of the overtime bank rather than out of
 * the leave quota.
 *
 * `absence_types.deducts_from_overtime` is the fourth independent flag, beside
 * `deducts_from_quota`, `paid` and `counts_as_work` — a day off is bought from one
 * purse, the other, both or neither, and folding it into the quota flag would make a
 * compensated day silently eat someone's holiday.
 *
 * `absence_requests.cost_minutes` freezes what the request cost that bank, for the
 * same reason `cost_days` freezes what it cost the quota: schedules are
 * effective-dated, so recomputing on read would let a contract signed in November
 * rewrite what an August day off was worth when it was granted. Minutes rather than
 * days because the bank is kept in minutes and a part-time Friday is not the same
 * length as a part-time Monday.
 *
 * The `overtime-comp` type is inserted for every organization that already has its
 * types seeded. Seeding is lazy — `AbsencesService.listTypes` only fills the table
 * when it is *empty* — so without this backfill the new type would be invisible on
 * every existing installation, which is all of them.
 */
export class Migration20260901140000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(
      `alter table "absence_types" add column "deducts_from_overtime" boolean not null default false;`,
    );
    this.addSql(
      `alter table "absence_requests" add column "cost_minutes" int not null default 0;`,
    );

    this.addSql(`
      insert into "absence_types" (
        "id", "created_at", "updated_at", "organization_id", "key", "name",
        "deducts_from_quota", "paid", "counts_as_work", "deducts_from_overtime",
        "color_role", "active", "position"
      )
      select
        gen_random_uuid(), now(), now(), o."id", 'overtime-comp', 'Overtime compensation',
        false, true, false, true, 'success', true, 8
      from "organizations" o
      where exists (select 1 from "absence_types" t where t."organization_id" = o."id")
        and not exists (
          select 1 from "absence_types" t
          where t."organization_id" = o."id" and t."key" = 'overtime-comp'
        );
    `);
  }

  override async down(): Promise<void> {
    // Only the untouched seed goes: a type someone has actually booked against is
    // holding history, and its requests name it.
    this.addSql(`
      delete from "absence_types" t
      where t."key" = 'overtime-comp'
        and not exists (
          select 1 from "absence_requests" r where r."type_id" = t."id"
        );
    `);
    this.addSql(`alter table "absence_requests" drop column "cost_minutes";`);
    this.addSql(`alter table "absence_types" drop column "deducts_from_overtime";`);
  }

}
