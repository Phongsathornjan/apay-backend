import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Business } from '../../business/entities/business.entity';
import { numericTransformer } from '../../common/transformers/numeric.transformer';
import { DB_SCHEMA } from '../../database/database.schema';

export type PaymentOrderStatus = 'UNVERIFIED' | 'PAID' | 'EXPIRED';

@Entity({ schema: DB_SCHEMA, name: 'payment_orders' })
@Index('idx_payment_orders_lookup', ['lookup_key', 'status', 'expires_at'])
@Index('idx_payment_orders_business', ['business_id', 'status', 'expires_at'])
export class PaymentOrder {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  id: string;

  @Column({ type: 'varchar', length: 40, name: 'lookup_key' })
  lookup_key: string;

  @Column({ type: 'uuid', name: 'business_id' })
  business_id: string;

  @ManyToOne(() => Business, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'business_id' })
  business: Business;

  @Column({
    type: 'numeric',
    precision: 12,
    scale: 2,
    name: 'base_amount',
    transformer: numericTransformer,
  })
  base_amount: number;

  @Column({
    type: 'numeric',
    precision: 4,
    scale: 2,
    name: 'decimal_ref',
    transformer: numericTransformer,
  })
  decimal_ref: number;

  @Column({
    type: 'numeric',
    precision: 12,
    scale: 2,
    name: 'total_amount',
    transformer: numericTransformer,
  })
  total_amount: number;

  @Column({ type: 'text', name: 'qr_payload' })
  qr_payload: string;

  @Column({ type: 'text', name: 'redirect_url' })
  redirect_url: string;

  @Column({ type: 'varchar', length: 20, default: 'UNVERIFIED' })
  status: PaymentOrderStatus;

  @Column({ type: 'boolean', name: 'callback_sent', default: false })
  callback_sent: boolean;

  @Column({ type: 'int', name: 'callback_status_code', nullable: true })
  callback_status_code: number | null;

  @Column({ type: 'timestamptz', name: 'expires_at' })
  expires_at: Date;

  @Column({ type: 'timestamptz', name: 'paid_at', nullable: true })
  paid_at: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
