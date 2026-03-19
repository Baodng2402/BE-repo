import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Semester } from './semester.entity';
import { User } from './user.entity';
import { ImportRowLog } from './import-row-log.entity';

@Entity('ImportBatch')
export class ImportBatch {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  semester_id: string;

  @Column({ type: 'uuid' })
  uploaded_by_id: string;

  @Column({ type: 'varchar', length: 255 })
  file_name: string;

  @Column({ type: 'varchar', length: 30 })
  mode: 'VALIDATE' | 'IMPORT';

  @Column({ type: 'int', default: 0 })
  total_rows: number;

  @Column({ type: 'int', default: 0 })
  success_rows: number;

  @Column({ type: 'int', default: 0 })
  failed_rows: number;

  @Column({ type: 'varchar', length: 100, unique: true })
  correlation_id: string;

  @Column({ type: 'jsonb', nullable: true })
  summary: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @ManyToOne(() => Semester, (semester) => semester.import_batches, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'semester_id' })
  semester: Semester;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'uploaded_by_id' })
  uploaded_by: User;

  @OneToMany(() => ImportRowLog, (row) => row.batch)
  rows: ImportRowLog[];
}

