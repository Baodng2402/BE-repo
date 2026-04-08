import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGroupRoomConversationSupport1765600000000 implements MigrationInterface {
  name = 'AddGroupRoomConversationSupport1765600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "Conversation"
      ADD COLUMN IF NOT EXISTS "group_id" uuid
    `);
    await queryRunner.query(`
      ALTER TABLE "Conversation"
      ALTER COLUMN "student_id" DROP NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "Conversation"
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_conversation_group'
        ) THEN
          ALTER TABLE "Conversation"
          ADD CONSTRAINT "FK_conversation_group" FOREIGN KEY ("group_id") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
        END IF;
      END
      $$;
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_conversation_group_updated_at" ON "Conversation" ("group_id", "updated_at" DESC)
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'UQ_conversation_group_context'
        ) THEN
          ALTER TABLE "Conversation"
          ADD CONSTRAINT "UQ_conversation_group_context" UNIQUE ("semester_id", "class_id", "group_id", "lecturer_id");
        END IF;
      END
      $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'UQ_conversation_group_context'
        ) THEN
          ALTER TABLE "Conversation" DROP CONSTRAINT "UQ_conversation_group_context";
        END IF;
      END
      $$;
    `);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_conversation_group_updated_at"`,
    );
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_conversation_group'
        ) THEN
          ALTER TABLE "Conversation" DROP CONSTRAINT "FK_conversation_group";
        END IF;
      END
      $$;
    `);
    await queryRunner.query(`
      ALTER TABLE "Conversation"
      ALTER COLUMN "student_id" SET NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "Conversation"
      DROP COLUMN "group_id"
    `);
  }
}
