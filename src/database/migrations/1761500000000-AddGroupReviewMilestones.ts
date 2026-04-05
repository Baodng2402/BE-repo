import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableForeignKey,
  TableIndex,
  TableUnique,
} from 'typeorm';

export class AddGroupReviewMilestones1761500000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'groupreview_milestone_code_enum') THEN
          CREATE TYPE "groupreview_milestone_code_enum" AS ENUM (
            'REVIEW_1',
            'PROGRESS_TRACKING',
            'REVIEW_2',
            'REVIEW_3'
          );
        END IF;
      END
      $$;
    `);

    await queryRunner.createTable(
      new Table({
        name: 'GroupReview',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'semester_id',
            type: 'uuid',
          },
          {
            name: 'group_id',
            type: 'uuid',
          },
          {
            name: 'milestone_code',
            type: 'groupreview_milestone_code_enum',
          },
          {
            name: 'week_start',
            type: 'int',
          },
          {
            name: 'week_end',
            type: 'int',
          },
          {
            name: 'task_progress_score',
            type: 'numeric',
            precision: 5,
            scale: 2,
            isNullable: true,
          },
          {
            name: 'commit_contribution_score',
            type: 'numeric',
            precision: 5,
            scale: 2,
            isNullable: true,
          },
          {
            name: 'review_milestone_score',
            type: 'numeric',
            precision: 5,
            scale: 2,
            isNullable: true,
          },
          {
            name: 'lecturer_note',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'snapshot_task_total',
            type: 'int',
            default: 0,
          },
          {
            name: 'snapshot_task_done',
            type: 'int',
            default: 0,
          },
          {
            name: 'snapshot_commit_total',
            type: 'int',
            isNullable: true,
          },
          {
            name: 'snapshot_commit_contributors',
            type: 'int',
            isNullable: true,
          },
          {
            name: 'snapshot_repository',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'snapshot_captured_at',
            type: 'timestamptz',
            isNullable: true,
          },
          {
            name: 'updated_by_id',
            type: 'uuid',
            isNullable: true,
          },
          {
            name: 'created_at',
            type: 'timestamptz',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'updated_at',
            type: 'timestamptz',
            default: 'CURRENT_TIMESTAMP',
          },
        ],
      }),
    );

    await queryRunner.createUniqueConstraint(
      'GroupReview',
      new TableUnique({
        name: 'UQ_GROUP_REVIEW_SEMESTER_GROUP_MILESTONE',
        columnNames: ['semester_id', 'group_id', 'milestone_code'],
      }),
    );

    await queryRunner.createForeignKeys('GroupReview', [
      new TableForeignKey({
        columnNames: ['semester_id'],
        referencedTableName: 'Semester',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
      new TableForeignKey({
        columnNames: ['group_id'],
        referencedTableName: 'Group',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
      new TableForeignKey({
        columnNames: ['updated_by_id'],
        referencedTableName: 'User',
        referencedColumnNames: ['id'],
        onDelete: 'SET NULL',
      }),
    ]);

    await queryRunner.createIndices('GroupReview', [
      new TableIndex({
        name: 'IDX_GROUP_REVIEW_SEMESTER',
        columnNames: ['semester_id'],
      }),
      new TableIndex({
        name: 'IDX_GROUP_REVIEW_GROUP',
        columnNames: ['group_id'],
      }),
      new TableIndex({
        name: 'IDX_GROUP_REVIEW_MILESTONE',
        columnNames: ['milestone_code'],
      }),
    ]);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('GroupReview', true);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'groupreview_milestone_code_enum') THEN
          DROP TYPE "groupreview_milestone_code_enum";
        END IF;
      END
      $$;
    `);
  }
}
