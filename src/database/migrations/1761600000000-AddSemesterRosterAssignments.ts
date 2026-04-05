import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSemesterRosterAssignments1761600000000 implements MigrationInterface {
  name = 'AddSemesterRosterAssignments1761600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "TeachingAssignment" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "semester_id" uuid NOT NULL,
        "class_id" uuid NOT NULL,
        "lecturer_id" uuid NOT NULL,
        "assigned_by_id" uuid,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_teaching_assignment_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_teaching_assignment_class" UNIQUE ("class_id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_teaching_assignment_semester" ON "TeachingAssignment" ("semester_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_teaching_assignment_lecturer" ON "TeachingAssignment" ("lecturer_id")`,
    );
    await queryRunner.query(`
      ALTER TABLE "TeachingAssignment"
      ADD CONSTRAINT "FK_teaching_assignment_semester" FOREIGN KEY ("semester_id") REFERENCES "Semester"("id") ON DELETE CASCADE ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE "TeachingAssignment"
      ADD CONSTRAINT "FK_teaching_assignment_class" FOREIGN KEY ("class_id") REFERENCES "Class"("id") ON DELETE CASCADE ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE "TeachingAssignment"
      ADD CONSTRAINT "FK_teaching_assignment_lecturer" FOREIGN KEY ("lecturer_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE "TeachingAssignment"
      ADD CONSTRAINT "FK_teaching_assignment_actor" FOREIGN KEY ("assigned_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      CREATE TABLE "ExaminerAssignment" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "semester_id" uuid NOT NULL,
        "class_id" uuid NOT NULL,
        "lecturer_id" uuid NOT NULL,
        "assigned_by_id" uuid NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_examiner_assignment_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_examiner_assignment" UNIQUE ("semester_id", "class_id", "lecturer_id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_examiner_assignment_semester" ON "ExaminerAssignment" ("semester_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_examiner_assignment_class" ON "ExaminerAssignment" ("class_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_examiner_assignment_lecturer" ON "ExaminerAssignment" ("lecturer_id")`,
    );
    await queryRunner.query(`
      ALTER TABLE "ExaminerAssignment"
      ADD CONSTRAINT "FK_examiner_assignment_semester" FOREIGN KEY ("semester_id") REFERENCES "Semester"("id") ON DELETE CASCADE ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE "ExaminerAssignment"
      ADD CONSTRAINT "FK_examiner_assignment_class" FOREIGN KEY ("class_id") REFERENCES "Class"("id") ON DELETE CASCADE ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE "ExaminerAssignment"
      ADD CONSTRAINT "FK_examiner_assignment_lecturer" FOREIGN KEY ("lecturer_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE "ExaminerAssignment"
      ADD CONSTRAINT "FK_examiner_assignment_actor" FOREIGN KEY ("assigned_by_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      INSERT INTO "TeachingAssignment" (
        "semester_id",
        "class_id",
        "lecturer_id",
        "created_at",
        "updated_at"
      )
      SELECT
        s."id",
        c."id",
        c."lecturer_id",
        NOW(),
        NOW()
      FROM "Class" c
      INNER JOIN "Semester" s ON s."code" = c."semester"
      LEFT JOIN "TeachingAssignment" ta ON ta."class_id" = c."id"
      WHERE c."semester" IS NOT NULL
        AND c."lecturer_id" IS NOT NULL
        AND ta."id" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ExaminerAssignment" DROP CONSTRAINT "FK_examiner_assignment_actor"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ExaminerAssignment" DROP CONSTRAINT "FK_examiner_assignment_lecturer"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ExaminerAssignment" DROP CONSTRAINT "FK_examiner_assignment_class"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ExaminerAssignment" DROP CONSTRAINT "FK_examiner_assignment_semester"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_examiner_assignment_lecturer"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_examiner_assignment_class"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_examiner_assignment_semester"`,
    );
    await queryRunner.query(`DROP TABLE "ExaminerAssignment"`);

    await queryRunner.query(
      `ALTER TABLE "TeachingAssignment" DROP CONSTRAINT "FK_teaching_assignment_actor"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TeachingAssignment" DROP CONSTRAINT "FK_teaching_assignment_lecturer"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TeachingAssignment" DROP CONSTRAINT "FK_teaching_assignment_class"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TeachingAssignment" DROP CONSTRAINT "FK_teaching_assignment_semester"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_teaching_assignment_lecturer"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_teaching_assignment_semester"`,
    );
    await queryRunner.query(`DROP TABLE "TeachingAssignment"`);
  }
}
