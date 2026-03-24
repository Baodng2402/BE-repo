import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Evaluation } from './evaluation.entity';
import { User } from './user.entity';

@Entity('EvaluationContribution')
@Unique(['evaluation_id', 'user_id'])
export class EvaluationContribution {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  evaluation_id: string;

  @Column({ type: 'uuid' })
  user_id: string;

  @Column({ type: 'decimal', precision: 5, scale: 2 })
  contribution_percent: number;

  @Column({ type: 'varchar', length: 500, nullable: true })
  note: string | null;

  @ManyToOne(() => Evaluation, (evaluation) => evaluation.contributions, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'evaluation_id' })
  evaluation: Evaluation;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;
}
