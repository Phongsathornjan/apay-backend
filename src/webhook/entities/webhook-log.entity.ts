import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { PaymentOrder } from '../../payment/entities/payment-order.entity';
import { numericTransformer } from '../../common/transformers/numeric.transformer';
import { DB_SCHEMA } from '../../database/database.schema';

export type WebhookProcessStatus =
  | 'MATCHED'
  | 'NO_MATCH'
  | 'DUPLICATE'
  | 'IGNORED';

@Entity({ schema: DB_SCHEMA, name: 'webhook_logs' })
export class WebhookLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100, name: 'line_message_id', unique: true })
  line_message_id: string;

  @Column({ type: 'varchar', length: 64, name: 'matched_order_id', nullable: true })
  matched_order_id: string | null;

  @ManyToOne(() => PaymentOrder, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'matched_order_id' })
  matched_order: PaymentOrder | null;

  @Column({
    type: 'numeric',
    precision: 12,
    scale: 2,
    name: 'parsed_amount',
    nullable: true,
    transformer: numericTransformer,
  })
  parsed_amount: number | null;

  @Column({ type: 'varchar', length: 30, name: 'parsed_datetime', nullable: true })
  parsed_datetime: string | null;

  @Column({ type: 'jsonb', name: 'raw_payload' })
  raw_payload: Record<string, unknown>;

  @Column({ type: 'varchar', length: 30, name: 'process_status' })
  process_status: WebhookProcessStatus;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
