import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { GroupStatus } from '../common/enums';
import { Class } from './class.entity';
import { DocumentSubmission } from './document-submission.entity';
import { Evaluation } from './evaluation.entity';
import { GroupMembership } from './group-membership.entity';
import { GroupReview } from './group-review.entity';
import { Topic } from './topic.entity';
import { User } from './user.entity';

@Entity('Group')
export class Group {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'uuid' })
  class_id: string;

  @Column({ type: 'uuid', nullable: true })
  topic_id: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  project_name: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  description: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  semester: string | null;

  @Column({ type: 'uuid' })
  created_by_id: string;

  @Column({ type: 'enum', enum: GroupStatus, default: GroupStatus.ACTIVE })
  status: GroupStatus;

  @Column({ type: 'varchar', length: 255, nullable: true })
  github_repo_url: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  jira_project_key: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @ManyToOne(() => User, (user) => user.createdGroups)
  @JoinColumn({ name: 'created_by_id' })
  creator: User;

  @OneToMany(() => GroupMembership, (membership) => membership.group)
  members: GroupMembership[];

  @ManyToOne(() => Class, (cls) => cls.groups)
  @JoinColumn({ name: 'class_id' })
  class: Class | null;

  @ManyToOne(() => Topic, (topic) => topic.groups, { nullable: true })
  @JoinColumn({ name: 'topic_id' })
  topic: Topic;

  @OneToMany(() => DocumentSubmission, (sub) => sub.group)
  submissions: DocumentSubmission[];

  @OneToMany(() => Evaluation, (evaluation) => evaluation.group)
  evaluations: Evaluation[];

  @OneToMany(() => GroupReview, (review) => review.group)
  reviews: GroupReview[];
}
