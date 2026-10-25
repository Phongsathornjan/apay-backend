import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { DB_SCHEMA } from '../../database/database.schema';

/**
 * OTP สำหรับยืนยันอีเมลตอนสมัครบัญชีธุรกิจด้วยตัวเอง
 * เก็บเฉพาะ SHA-256 hash ของรหัส ไม่เก็บรหัสจริง
 */
@Entity({ schema: DB_SCHEMA, name: 'business_email_otps' })
@Index('idx_business_email_otps_email_created', ['email', 'created_at'])
export class BusinessEmailOtp {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255, name: 'email' })
  email: string;

  @Column({ type: 'varchar', length: 128, name: 'otp_hash' })
  otp_hash: string;

  @Column({ type: 'integer', name: 'attempts', default: 0 })
  attempts: number;

  @Column({ type: 'timestamptz', name: 'expires_at' })
  expires_at: Date;

  @Column({ type: 'timestamptz', name: 'consumed_at', nullable: true })
  consumed_at: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
