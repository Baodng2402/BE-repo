import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { TaskJiraSyncStatus, TaskPriority, TaskStatus } from '../common/enums';
import { Group } from './group.entity';
import { User } from './user.entity';

@Entity('Task')
@Index('IDX_TASK_GROUP_ID', ['group_id'])
@Index('IDX_TASK_STATUS', ['status'])
@Index('IDX_TASK_ASSIGNEE_ID', ['assignee_id'])
@Index('IDX_TASK_GROUP_STATUS', ['group_id', 'status'])
export class Task {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  group_id: string;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({
    type: 'enum',
    enum: TaskStatus,
    default: TaskStatus.TODO,
  })
  status: TaskStatus;

  @Column({
    type: 'enum',
    enum: TaskPriority,
    default: TaskPriority.MEDIUM,
  })
  priority: TaskPriority;

  @Column({ type: 'uuid', nullable: true })
  assignee_id: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  jira_issue_key: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  jira_issue_id: string | null;

  @Column({
    type: 'enum',
    enum: TaskJiraSyncStatus,
    default: TaskJiraSyncStatus.SKIPPED,
  })
  jira_sync_status: TaskJiraSyncStatus;

  @Column({ type: 'varchar', length: 100, nullable: true })
  jira_sync_reason: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  due_at: Date | null;

  @Column({ type: 'uuid' })
  created_by_id: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;

  @ManyToOne(() => Group, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'group_id' })
  group: Group;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'assignee_id' })
  assignee: User | null;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'created_by_id' })
  creator: User;
}
