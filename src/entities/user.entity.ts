import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { AuthProvider, Role } from '../common/enums';
import { ClassMembership } from './class-membership.entity';
import { Class } from './class.entity';
import { DocumentSubmission } from './document-submission.entity';
import { ExaminerAssignment } from './examiner-assignment.entity';
import { GroupMembership } from './group-membership.entity';
import { Group } from './group.entity';
import { IntegrationToken } from './integration-token.entity';
import { Notification } from './notification.entity';
import { TeachingAssignment } from './teaching-assignment.entity';

@Entity('User')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100, unique: true, nullable: true })
  student_id: string | null;

  @Column({ type: 'varchar', length: 255, unique: true })
  email: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  password_hash: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  full_name: string | null;

  @Column({ type: 'enum', enum: AuthProvider, default: AuthProvider.EMAIL })
  primary_provider: AuthProvider;

  @Column({ type: 'enum', enum: Role, default: Role.STUDENT })
  role: Role;

  @Column({ type: 'boolean', default: false })
  is_email_verified: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  last_login: Date | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  avatar_url: string | null;

  @OneToMany(() => IntegrationToken, (token) => token.user)
  integrationTokens: IntegrationToken[];

  @OneToMany(() => Group, (group) => group.creator)
  createdGroups: Group[];

  @OneToMany(() => GroupMembership, (membership) => membership.user)
  memberships: GroupMembership[];

  @OneToMany(() => Class, (cls) => cls.lecturer)
  lectured_classes: Class[];

  @OneToMany(() => ClassMembership, (membership) => membership.user)
  class_memberships: ClassMembership[];

  @OneToMany(() => Notification, (notification) => notification.user)
  notifications: Notification[];

  @OneToMany(() => DocumentSubmission, (submission) => submission.submittedBy)
  submissions: DocumentSubmission[];

  @OneToMany(
    () => TeachingAssignment,
    (assignment) => assignment.lecturer,
  )
  teaching_assignments: TeachingAssignment[];

  @OneToMany(
    () => ExaminerAssignment,
    (assignment) => assignment.lecturer,
  )
  examiner_assignments: ExaminerAssignment[];
}
