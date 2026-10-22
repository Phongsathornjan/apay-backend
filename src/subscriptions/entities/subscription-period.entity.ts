import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { DB_SCHEMA } from '../../database/database.schema';
import { BusinessSubscription } from './business-subscription.entity';

/**
 * Snapshot ของแต่ละรอบบิล (เก็บไว้ก่อนโควต้าถูกรีเซ็ตหรือหมดอายุ)
 */
@Entity({ schema: DB_SCHEMA, name: 'subscription_periods' })
@Index('idx_subscription_periods_business', ['business_id', 'created_at'])
export class SubscriptionPeriod {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'subscription_id' })
  subscription_id: string;

  @ManyToOne(() => BusinessSubscription, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'subscription_id' })
  subscription: BusinessSubscription;

  @Column({ type: 'uuid', name: 'business_id' })
  business_id: string;

  @Column({ type: 'uuid', name: 'package_id' })
  package_id: string;

  @Column({ type: 'timestamptz', name: 'period_start' })
  period_start: Date;

  @Column({ type: 'timestamptz', name: 'period_end' })
  period_end: Date;

  @Column({ type: 'int', name: 'quota_limit' })
  quota_limit: number;

  @Column({ type: 'int', name: 'quota_used' })
  quota_used: number;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
