import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { ChatConversationStatus } from '../common/enums';
import { Class } from './class.entity';
import { Group } from './group.entity';
import { Message } from './message.entity';
import { Semester } from './semester.entity';
import { User } from './user.entity';

@Entity('Conversation')
@Unique('UQ_conversation_context_pair', [
  'semester_id',
  'class_id',
  'student_id',
  'lecturer_id',
])
@Index('IDX_conversation_student_updated_at', ['student_id', 'updated_at'])
@Index('IDX_conversation_lecturer_updated_at', ['lecturer_id', 'updated_at'])
@Index('IDX_conversation_group_updated_at', ['group_id', 'updated_at'])
export class Conversation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  semester_id: string;

  @Column({ type: 'uuid' })
  class_id: string;

  @Column({ type: 'uuid', nullable: true })
  student_id: string | null;

  @Column({ type: 'uuid', nullable: true })
  group_id: string | null;

  @Column({ type: 'uuid' })
  lecturer_id: string;

  @Column({
    type: 'enum',
    enum: ChatConversationStatus,
    default: ChatConversationStatus.ACTIVE,
  })
  status: ChatConversationStatus;

  @Column({ type: 'varchar', length: 255, nullable: true })
  last_message_preview: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  last_message_at: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @ManyToOne(() => Semester, (semester) => semester.conversations, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'semester_id' })
  semester: Semester;

  @ManyToOne(() => Class, (cls) => cls.conversations, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'class_id' })
  class: Class;

  @ManyToOne(() => User, (user) => user.student_conversations, {
    onDelete: 'SET NULL',
    nullable: true,
  })
  @JoinColumn({ name: 'student_id' })
  student: User | null;

  @ManyToOne(() => Group, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'group_id' })
  group: Group | null;

  @ManyToOne(() => User, (user) => user.lecturer_conversations, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'lecturer_id' })
  lecturer: User;

  @OneToMany(() => Message, (message) => message.conversation)
  messages: Message[];
}
