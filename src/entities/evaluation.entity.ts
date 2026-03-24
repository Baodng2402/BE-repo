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
import { Group } from './group.entity';
import { User } from './user.entity';
import { EvaluationContribution } from './evaluation-contribution.entity';

@Entity('Evaluation')
export class Evaluation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  group_id: string;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  description: string | null;

  @Column({ type: 'uuid' })
  created_by_id: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @ManyToOne(() => Group, (group) => group.evaluations)
  @JoinColumn({ name: 'group_id' })
  group: Group;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'created_by_id' })
  createdBy: User;

  @OneToMany(
    () => EvaluationContribution,
    (contribution) => contribution.evaluation,
    { cascade: true },
  )
  contributions: EvaluationContribution[];
}
