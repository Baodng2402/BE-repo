import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAttendanceTrackingToReviewSessions1765500000000
  implements MigrationInterface
{
  name = 'AddAttendanceTrackingToReviewSessions1765500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "ReviewSession"
      ADD COLUMN IF NOT EXISTS "attendance_records" jsonb NOT NULL DEFAULT '[]'::jsonb
    `);

    await queryRunner.query(`
      ALTER TABLE "ReviewSession"
      ADD COLUMN IF NOT EXISTS "previous_session_id" uuid NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "ReviewSession"
      ALTER COLUMN "status" SET DEFAULT 'SCHEDULED'
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'FK_review_session_previous_session'
        ) THEN
          ALTER TABLE "ReviewSession"
          ADD CONSTRAINT "FK_review_session_previous_session"
          FOREIGN KEY ("previous_session_id") REFERENCES "ReviewSession"("id")
          ON DELETE SET NULL ON UPDATE NO ACTION;
        END IF;
      END
      $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "ReviewSession"
      DROP CONSTRAINT IF EXISTS "FK_review_session_previous_session"
    `);

    await queryRunner.query(`
      ALTER TABLE "ReviewSession"
      ALTER COLUMN "status" SET DEFAULT 'COMPLETED'
    `);

    await queryRunner.query(`
      ALTER TABLE "ReviewSession"
      DROP COLUMN IF EXISTS "previous_session_id"
    `);

    await queryRunner.query(`
      ALTER TABLE "ReviewSession"
      DROP COLUMN IF EXISTS "attendance_records"
    `);
  }
}
