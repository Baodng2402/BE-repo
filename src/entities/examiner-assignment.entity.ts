import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Class } from './class.entity';
import { Semester } from './semester.entity';
import { User } from './user.entity';

@Entity('ExaminerAssignment')
@Unique('UQ_examiner_assignment', ['semester_id', 'class_id', 'lecturer_id'])
export class ExaminerAssignment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  semester_id: string;

  @Column({ type: 'uuid' })
  class_id: string;

  @Column({ type: 'uuid' })
  lecturer_id: string;

  @Column({ type: 'uuid' })
  assigned_by_id: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @ManyToOne(() => Semester, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'semester_id' })
  semester: Semester;

  @ManyToOne(() => Class, (cls) => cls.examiner_assignments, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'class_id' })
  class: Class;

  @ManyToOne(() => User, (user) => user.examiner_assignments, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'lecturer_id' })
  lecturer: User;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'assigned_by_id' })
  assigned_by: User;
}
