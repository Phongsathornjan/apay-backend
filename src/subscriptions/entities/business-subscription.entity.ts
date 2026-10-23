import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Business } from '../../business/entities/business.entity';
import { DB_SCHEMA } from '../../database/database.schema';
import {
  BusinessSubscriptionStatusEnum,
  type BusinessSubscriptionStatus,
} from '../../enums/business-subscription-status.enum';
import { Package } from '../../packages/entities/package.entity';

export type { BusinessSubscriptionStatus };

/**
 * Subscription ของ Business (1 Business → 1 Active Subscription)
 * โควต้าเป็น Pool เดียวระดับ Business ที่แชร์ร่วมกันทุก API Key
 *
 * `current_period_end` คือ "วันที่ชำระเงินล่วงหน้าถึง" (paid-through)
 * เมื่อเลยกำหนดโดยไม่ต่ออายุจะถูกเปลี่ยนเป็น `PAST_DUE` และ `quota_remaining = 0`
 * โดยไม่มีการรีเซ็ตโควต้าให้ฟรี (Prepaid / No Top-up)
 */
@Entity({ schema: DB_SCHEMA, name: 'business_subscriptions' })
export class BusinessSubscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('idx_business_subscriptions_business')
  @Column({ type: 'uuid', name: 'business_id' })
  business_id: string;

  @ManyToOne(() => Business, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'business_id' })
  business: Business;

  @Column({ type: 'uuid', name: 'package_id' })
  package_id: string;

  @ManyToOne(() => Package, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'package_id' })
  package: Package;

  @Column({
    type: 'varchar',
    length: 20,
    default: BusinessSubscriptionStatusEnum.ACTIVE,
  })
  status: BusinessSubscriptionStatus;

  @Column({ type: 'int', name: 'quota_limit' })
  quota_limit: number;

  @Column({ type: 'int', name: 'quota_used', default: 0 })
  quota_used: number;

  @Column({ type: 'int', name: 'quota_remaining' })
  quota_remaining: number;

  @Column({ type: 'int', name: 'rate_limit_per_hour' })
  rate_limit_per_hour: number;

  @Column({ type: 'int', name: 'max_api_keys' })
  max_api_keys: number;

  @Column({ type: 'timestamptz', name: 'current_period_start' })
  current_period_start: Date;

  @Index('idx_business_subscriptions_period_end')
  @Column({ type: 'timestamptz', name: 'current_period_end' })
  current_period_end: Date;

  @Column({ type: 'timestamptz', name: 'cancelled_at', nullable: true })
  cancelled_at: Date | null;

  @Column({ type: 'timestamptz', name: 'last_payment_at', nullable: true })
  last_payment_at: Date | null;

  @DeleteDateColumn({
    type: 'timestamptz',
    name: 'deleted_at',
    nullable: true,
  })
  deleted_at: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
