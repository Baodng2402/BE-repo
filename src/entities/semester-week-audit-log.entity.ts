import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Semester } from './semester.entity';
import { User } from './user.entity';

@Entity('SemesterWeekAuditLog')
@Index('IDX_SEMESTER_WEEK_AUDIT_SEMESTER_ID', ['semester_id'])
@Index('IDX_SEMESTER_WEEK_AUDIT_ACTOR_USER_ID', ['actor_user_id'])
export class SemesterWeekAuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  semester_id: string;

  @Column({ type: 'uuid' })
  actor_user_id: string;

  @Column({ type: 'int' })
  previous_week: number;

  @Column({ type: 'int' })
  new_week: number;

  @Column({ type: 'varchar', length: 100, default: 'DEMO_OVERRIDE' })
  trigger_source: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @ManyToOne(() => Semester, (semester) => semester.week_change_audits, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'semester_id' })
  semester: Semester;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'actor_user_id' })
  actor: User;
}
