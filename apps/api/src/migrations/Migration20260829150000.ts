import { Migration } from '@mikro-orm/migrations';

/**
 * Restates balances the attendance module banked before it consulted the holiday
 * calendar. A week containing a public holiday used to print a full target and book
 * the day as a shortfall nobody could have worked off; `AttendanceService` now treats
 * a holiday the way the attendance report always has — target zero, and any hours
 * worked on it counted as pure overtime — but every `AttendanceDay` row already
 * written under the old rule, and the `OvertimeBalance` it fed, is still wrong.
 *
 * The `overtime_balances` move is computed first, from the *un-restated* attendance
 * days — the difference between what the day should have contributed and what it
 * already did — and only then are the affected `attendance_days` rows themselves
 * restated. Reversing the order would compute every diff as zero.
 *
 * Both statements guard on `target_minutes <> 0`, which is what makes this safe to
 * run more than once: a row this migration has already restated reads
 * `target_minutes = 0` and no longer matches.
 *
 * `down` is intentionally a no-op. The value a holiday's target used to carry before
 * this ran (the schedule's per-weekday target, at whatever revision was effective
 * that day) is not preserved anywhere, so there is nothing to restore it from —
 * restating history is one-directional here in the same way the fix it ships is: a
 * migration, not a stored fact this schema is willing to carry forward.
 */
export class Migration20260829150000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`
      with affected as (
        select "ad"."user_id" as "user_id", ("ad"."worked_minutes" - "ad"."balance_minutes") as "diff"
        from "attendance_days" "ad"
        join "holidays" "h"
          on "h"."organization_id" = "ad"."organization_id"
         and "h"."date" = "ad"."local_date"
        where "ad"."target_minutes" <> 0
      ),
      per_user as (
        select "user_id", sum("diff") as "total_diff"
        from affected
        group by "user_id"
      )
      update "overtime_balances" "ob"
      set "balance_minutes" = "ob"."balance_minutes" + "per_user"."total_diff",
          "updated_at" = now()
      from per_user
      where "per_user"."user_id" = "ob"."user_id"
        and "per_user"."total_diff" <> 0;
    `);

    this.addSql(`
      update "attendance_days" "ad"
      set "target_minutes" = 0,
          "balance_minutes" = "ad"."worked_minutes",
          "updated_at" = now()
      from "holidays" "h"
      where "h"."organization_id" = "ad"."organization_id"
        and "h"."date" = "ad"."local_date"
        and "ad"."target_minutes" <> 0;
    `);
  }

  override async down(): Promise<void> {
    // See the class doc: the pre-restatement target is not preserved anywhere, so
    // there is nothing to reverse this into.
  }

}
