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
import { ApiKey } from '../../api-keys/entities/api-key.entity';
import { Business } from '../../business/entities/business.entity';
import { numericTransformer } from '../../common/transformers/numeric.transformer';
import { DB_SCHEMA } from '../../database/database.schema';
import {
  PaymentOrderStatusEnum,
  type PaymentOrderStatus,
} from '../../enums/payment-order-status.enum';

export type { PaymentOrderStatus };

@Entity({ schema: DB_SCHEMA, name: 'payment_orders' })
@Index('idx_payment_orders_lookup', ['lookup_key', 'status', 'expires_at'])
@Index('idx_payment_orders_business', ['business_id', 'status', 'expires_at'])
@Index('idx_payment_orders_business_created', ['business_id', 'created_at'])
@Index('idx_payment_orders_business_paid', ['business_id', 'paid_at'])
@Index('idx_payment_orders_line_lookup', [
  'line_user_id',
  'lookup_key',
  'status',
  'expires_at',
])
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

  @Column({ type: 'uuid', name: 'api_key_id', nullable: true })
  api_key_id: string | null;

  @ManyToOne(() => ApiKey, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'api_key_id' })
  api_key: ApiKey | null;

  /**
   * LINE User ID ที่ผูกกับ Order นี้ ใช้จับคู่ Webhook เพิ่มเติมจาก `lookup_key`
   * - Order รับเงินปกติ: บันทึกจาก `businesses.line_user_id` ตอนสร้าง QR (เป็น `null`
   *   ได้ ถ้าธุรกิจยังไม่ผูก LINE — Webhook จะจับคู่ด้วยยอดเงิน + วันเวลาแทน)
   * - Order สำหรับผูก LINE (`is_line_link = true`): เป็น `null` จนกว่า Webhook จะมาผูกให้
   */
  @Column({ type: 'varchar', length: 64, name: 'line_user_id', nullable: true })
  line_user_id: string | null;

  /**
   * `true` = QR ยืนยันสำหรับผูก LINE User ID เข้ากับ Business (ยอด 0.01 - 0.99)
   * `false` = QR รับเงินปกติ
   */
  @Column({ type: 'boolean', name: 'is_line_link', default: false })
  is_line_link: boolean;

  @Column({
    type: 'numeric',
    precision: 12,
    scale: 2,
    name: 'base_amount',
    transformer: numericTransformer,
  })
  base_amount: number;

  /**
   * เศษสตางค์อ้างอิงที่จองไว้เพื่อแยกออเดอร์ที่มียอดฐาน (base_amount) เดียวกัน
   * - `0.01` - `0.99` = ออเดอร์ปกติ (ยอดรวมมีเศษสตางค์)
   * - `0` = ออเดอร์ที่สร้างด้วย `zero_decimal = true` (ยอดลงท้าย `.00` เช่น 99.00)
   */
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

  @Column({ type: 'text', name: 'redirect_url', nullable: true })
  redirect_url: string | null;

  @Column({
    type: 'varchar',
    length: 20,
    default: PaymentOrderStatusEnum.UNVERIFIED,
  })
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
