import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { SrsVersionStatus } from '../common/enums';
import { SrsDocument } from './srs-document.entity';
import { User } from './user.entity';

@Entity('SrsVersion')
@Unique(['srs_document_id', 'version_number'])
export class SrsVersion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  srs_document_id: string;

  @Column({ type: 'int' })
  version_number: number;

  @Column({ type: 'text' })
  content: string;

  @Column({
    type: 'enum',
    enum: SrsVersionStatus,
    default: SrsVersionStatus.DRAFT,
  })
  status: SrsVersionStatus;

  @Column({ type: 'uuid' })
  submitted_by_id: string;

  @Column({ type: 'timestamptz', nullable: true })
  submitted_at: Date | null;

  @Column({ type: 'uuid', nullable: true })
  reviewed_by_id: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  reviewed_at: Date | null;

  @Column({ type: 'text', nullable: true })
  feedback: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @ManyToOne(() => SrsDocument, (doc) => doc.versions)
  @JoinColumn({ name: 'srs_document_id' })
  srsDocument: SrsDocument;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'submitted_by_id' })
  submittedBy: User;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'reviewed_by_id' })
  reviewedBy: User | null;
}
