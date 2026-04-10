import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Group } from './group.entity';
import { SrsVersion } from './srs-version.entity';
import { User } from './user.entity';

@Entity('SrsDocument')
export class SrsDocument {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', unique: true })
  group_id: string;

  @Column({ type: 'text', nullable: true })
  draft_content: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  draft_updated_at: Date | null;

  @Column({ type: 'uuid', nullable: true })
  draft_updated_by_id: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @OneToOne(() => Group)
  @JoinColumn({ name: 'group_id' })
  group: Group;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'draft_updated_by_id' })
  draftUpdatedBy: User | null;

  @OneToMany(() => SrsVersion, (version) => version.srsDocument)
  versions: SrsVersion[];
}
