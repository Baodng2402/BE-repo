import {
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { Class } from './class.entity';
import { User } from './user.entity';

@Entity('ClassMembership')
export class ClassMembership {
  @PrimaryColumn({ type: 'uuid' })
  class_id: string;

  @PrimaryColumn({ type: 'uuid' })
  user_id: string;

  @CreateDateColumn({ type: 'timestamptz' })
  joined_at: Date;

  @ManyToOne(() => Class, (cls) => cls.memberships)
  @JoinColumn({ name: 'class_id' })
  class: Class | null;

  @ManyToOne(() => User, (user) => user.class_memberships)
  @JoinColumn({ name: 'user_id' })
  user: User;
}
