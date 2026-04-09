import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDocumentSubmissionMarkdownContent1765900000000 implements MigrationInterface {
  name = 'AddDocumentSubmissionMarkdownContent1765900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "DocumentSubmission"
      ADD COLUMN IF NOT EXISTS "content_markdown" text
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "DocumentSubmission"
      DROP COLUMN IF EXISTS "content_markdown"
    `);
  }
}
