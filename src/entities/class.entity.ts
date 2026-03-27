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
import { ClassStatus } from '../common/enums';
import { ClassMembership } from './class-membership.entity';
import { ExaminerAssignment } from './examiner-assignment.entity';
import { Group } from './group.entity';
import { TeachingAssignment } from './teaching-assignment.entity';
import { User } from './user.entity';

@Entity('Class')
export class Class {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 50 })
  code: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  semester: string | null;

  @Column({ type: 'uuid' })
  lecturer_id: string;

  @Column({ type: 'varchar', length: 100 })
  enrollment_key: string;

  @Column({ type: 'int', default: 7 })
  max_groups: number;

  @Column({ type: 'int', default: 5 })
  max_students_per_group: number;

  @Column({ type: 'enum', enum: ClassStatus, default: ClassStatus.ONGOING })
  status: ClassStatus;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @ManyToOne(() => User, (user) => user.lectured_classes)
  @JoinColumn({ name: 'lecturer_id' })
  lecturer: User;

  @OneToMany(() => Group, (group) => group.class)
  groups: Group[];

  @OneToMany(() => ClassMembership, (membership) => membership.class)
  memberships: ClassMembership[];

  @OneToMany(
    () => TeachingAssignment,
    (assignment) => assignment.class,
  )
  teaching_assignments: TeachingAssignment[];

  @OneToMany(
    () => ExaminerAssignment,
    (assignment) => assignment.class,
  )
  examiner_assignments: ExaminerAssignment[];
}
