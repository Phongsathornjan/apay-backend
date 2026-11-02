import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { DB_SCHEMA } from '../../database/database.schema';

@Entity({ schema: DB_SCHEMA, name: 'businesses' })
@Index('idx_businesses_created', ['created_at'])
export class Business {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'user_id', unique: true })
  user_id: string;

  @OneToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'varchar', length: 150, name: 'business_name' })
  business_name: string;

  /**
   * อีเมลติดต่อของธุรกิจ — บังคับส่งตอนสมัครผ่าน `POST /auth/register-business`
   * แต่คอลัมน์เป็น nullable เพื่อรองรับธุรกิจเดิมที่สร้างไว้ก่อนมีฟิลด์นี้
   * ใช้เป็นอีเมลยืนยันตัวตนสำหรับการสมัครด้วยตัวเอง (unique, 1 อีเมล = 1 ธุรกิจ)
   */
  @Index('idx_businesses_email', { unique: true })
  @Column({ type: 'varchar', length: 255, name: 'email', nullable: true })
  email: string | null;

  @Column({ type: 'varchar', length: 20, name: 'promptpay_id' })
  promptpay_id: string;

  @Column({
    type: 'varchar',
    length: 24,
    name: 'api_key_prefix',
    unique: true,
    nullable: true,
  })
  api_key_prefix: string | null;

  @Column({
    type: 'varchar',
    length: 128,
    name: 'api_key_hash',
    nullable: true,
  })
  api_key_hash: string | null;

  @Column({
    type: 'varchar',
    length: 128,
    name: 'refresh_token_hash',
    nullable: true,
  })
  refresh_token_hash: string | null;

  @Column({ type: 'boolean', name: 'is_active', default: true })
  is_active: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
