import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import {
  ReviewMilestoneCode,
  ReviewProblemStatus,
  ReviewSessionStatus,
} from '../common/enums';
import { Class } from './class.entity';
import { Group } from './group.entity';
import { ReviewSessionAuditLog } from './review-session-audit-log.entity';
import { Semester } from './semester.entity';
import { User } from './user.entity';

export interface ReviewSessionProblem {
  id: string;
  title: string;
  status: ReviewProblemStatus;
  note: string | null;
}

export interface ReviewSessionAttendanceRecord {
  user_id: string;
  user_name: string | null;
  present: boolean;
}

@Entity('ReviewSession')
@Index('IDX_review_session_semester', ['semester_id'])
@Index('IDX_review_session_class', ['class_id'])
@Index('IDX_review_session_group', ['group_id'])
@Index('IDX_review_session_milestone', ['milestone_code'])
@Index('IDX_review_session_review_date', ['review_date'])
export class ReviewSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  semester_id: string;

  @Column({ type: 'uuid' })
  class_id: string;

  @Column({ type: 'uuid' })
  group_id: string;

  @Column({ type: 'date' })
  review_day: string;

  @Column({ type: 'enum', enum: ReviewMilestoneCode })
  milestone_code: ReviewMilestoneCode;

  @Column({ type: 'timestamptz' })
  review_date: Date;

  @Column({ type: 'varchar', length: 160 })
  title: string;

  @Column({
    type: 'enum',
    enum: ReviewSessionStatus,
    default: ReviewSessionStatus.SCHEDULED,
  })
  status: ReviewSessionStatus;

  @Column({ type: 'text', nullable: true })
  lecturer_note: string | null;

  @Column({ type: 'text', nullable: true })
  what_done_since_last_review: string | null;

  @Column({ type: 'text', nullable: true })
  next_plan_until_next_review: string | null;

  @Column({ type: 'text', nullable: true })
  previous_problem_followup: string | null;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  current_problems: ReviewSessionProblem[];

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  attendance_records: ReviewSessionAttendanceRecord[];

  @Column({ type: 'numeric', precision: 5, scale: 2, nullable: true })
  attendance_ratio: number | null;

  @Column({ type: 'uuid', nullable: true })
  previous_session_id: string | null;

  @Column({ type: 'uuid', nullable: true })
  created_by_id: string | null;

  @Column({ type: 'uuid', nullable: true })
  updated_by_id: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;

  @ManyToOne(() => Semester, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'semester_id' })
  semester: Semester;

  @ManyToOne(() => Class, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'class_id' })
  class: Class;

  @ManyToOne(() => Group, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'group_id' })
  group: Group;

  @ManyToOne(() => ReviewSession, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'previous_session_id' })
  previous_session: ReviewSession | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by_id' })
  created_by: User | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'updated_by_id' })
  updated_by: User | null;

  @OneToMany(() => ReviewSessionAuditLog, (audit) => audit.review_session)
  audit_logs: ReviewSessionAuditLog[];
}
