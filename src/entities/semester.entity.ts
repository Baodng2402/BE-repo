import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { SemesterStatus } from '../common/enums/semester-status.enum';
import { ExaminerAssignment } from './examiner-assignment.entity';
import { GroupReview } from './group-review.entity';
import { ImportBatch } from './import-batch.entity';
import { SemesterWeekAuditLog } from './semester-week-audit-log.entity';
import { TeachingAssignment } from './teaching-assignment.entity';

@Entity('Semester')
export class Semester {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 50, unique: true })
  code: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'date' })
  start_date: string;

  @Column({ type: 'date' })
  end_date: string;

  @Column({
    type: 'enum',
    enum: SemesterStatus,
    default: SemesterStatus.UPCOMING,
  })
  status: SemesterStatus;

  @Column({ type: 'int', default: 1 })
  current_week: number;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @OneToMany(() => ImportBatch, (batch) => batch.semester)
  import_batches: ImportBatch[];

  @OneToMany(() => SemesterWeekAuditLog, (audit) => audit.semester)
  week_change_audits: SemesterWeekAuditLog[];

  @OneToMany(() => GroupReview, (review) => review.semester)
  group_reviews: GroupReview[];

  @OneToMany(
    () => TeachingAssignment,
    (assignment) => assignment.semester,
  )
  teaching_assignments: TeachingAssignment[];

  @OneToMany(
    () => ExaminerAssignment,
    (assignment) => assignment.semester,
  )
  examiner_assignments: ExaminerAssignment[];
}
