import { MigrationInterface, QueryRunner } from 'typeorm';

export class AllowNullLecturerAndAddSemesterClassCrud1761800000000 implements MigrationInterface {
  name = 'AllowNullLecturerAndAddSemesterClassCrud1761800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "Class"
      ALTER COLUMN "lecturer_id" DROP NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "Class"
      SET "lecturer_id" = (
        SELECT u."id"
        FROM "User" u
        WHERE u."role" = 'LECTURER'
        ORDER BY u."created_at" ASC NULLS LAST, u."id" ASC
        LIMIT 1
      )
      WHERE "lecturer_id" IS NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "Class"
      ALTER COLUMN "lecturer_id" SET NOT NULL
    `);
  }
}
