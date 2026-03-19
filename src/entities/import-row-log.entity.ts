import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ImportBatch } from './import-batch.entity';

@Entity('ImportRowLog')
export class ImportRowLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  batch_id: string;

  @Column({ type: 'int' })
  row_number: number;

  @Column({ type: 'varchar', length: 30, nullable: true })
  role: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  email: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  class_code: string | null;

  @Column({ type: 'varchar', length: 30 })
  status: 'SUCCESS' | 'FAILED' | 'SKIPPED';

  @Column({ type: 'text' })
  message: string;

  @Column({ type: 'jsonb', nullable: true })
  payload: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @ManyToOne(() => ImportBatch, (batch) => batch.rows, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'batch_id' })
  batch: ImportBatch;
}

