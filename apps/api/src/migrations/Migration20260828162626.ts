import { Migration } from '@mikro-orm/migrations';

export class Migration20260828162626 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "absence_requests" add constraint "absence_requests_document_id_foreign" foreign key ("document_id") references "documents" ("id") on update cascade on delete set null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "absence_requests" drop constraint "absence_requests_document_id_foreign";`);
  }

}
