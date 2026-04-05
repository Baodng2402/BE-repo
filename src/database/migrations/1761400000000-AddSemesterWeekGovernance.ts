import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSemesterWeekGovernance1761400000000 implements MigrationInterface {
  name = 'AddSemesterWeekGovernance1761400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "Semester"
      ADD COLUMN "current_week" integer NOT NULL DEFAULT 1
    `);

    await queryRunner.query(`
      ALTER TABLE "Semester"
      ADD CONSTRAINT "CHK_SEMESTER_CURRENT_WEEK_RANGE"
      CHECK ("current_week" >= 1 AND "current_week" <= 10)
    `);

    await queryRunner.query(`
      CREATE TABLE "SemesterWeekAuditLog" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "semester_id" uuid NOT NULL,
        "actor_user_id" uuid NOT NULL,
        "previous_week" integer NOT NULL,
        "new_week" integer NOT NULL,
        "trigger_source" character varying(100) NOT NULL DEFAULT 'DEMO_OVERRIDE',
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_SemesterWeekAuditLog_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_SEMESTER_WEEK_AUDIT_SEMESTER_ID"
      ON "SemesterWeekAuditLog" ("semester_id")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_SEMESTER_WEEK_AUDIT_ACTOR_USER_ID"
      ON "SemesterWeekAuditLog" ("actor_user_id")
    `);

    await queryRunner.query(`
      ALTER TABLE "SemesterWeekAuditLog"
      ADD CONSTRAINT "FK_SemesterWeekAuditLog_semester_id"
      FOREIGN KEY ("semester_id") REFERENCES "Semester"("id")
      ON DELETE CASCADE
    `);

    await queryRunner.query(`
      ALTER TABLE "SemesterWeekAuditLog"
      ADD CONSTRAINT "FK_SemesterWeekAuditLog_actor_user_id"
      FOREIGN KEY ("actor_user_id") REFERENCES "User"("id")
      ON DELETE CASCADE
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "SemesterWeekAuditLog"
      DROP CONSTRAINT "FK_SemesterWeekAuditLog_actor_user_id"
    `);

    await queryRunner.query(`
      ALTER TABLE "SemesterWeekAuditLog"
      DROP CONSTRAINT "FK_SemesterWeekAuditLog_semester_id"
    `);

    await queryRunner.query(`
      DROP INDEX "public"."IDX_SEMESTER_WEEK_AUDIT_ACTOR_USER_ID"
    `);

    await queryRunner.query(`
      DROP INDEX "public"."IDX_SEMESTER_WEEK_AUDIT_SEMESTER_ID"
    `);

    await queryRunner.query(`
      DROP TABLE "SemesterWeekAuditLog"
    `);

    await queryRunner.query(`
      ALTER TABLE "Semester"
      DROP CONSTRAINT "CHK_SEMESTER_CURRENT_WEEK_RANGE"
    `);

    await queryRunner.query(`
      ALTER TABLE "Semester"
      DROP COLUMN "current_week"
    `);
  }
}
