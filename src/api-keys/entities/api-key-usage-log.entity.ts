import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Business } from '../../business/entities/business.entity';
import { DB_SCHEMA } from '../../database/database.schema';
import type { ApiKeyUsageAction } from '../../enums/api-key-usage-action.enum';
import { ApiKey } from './api-key.entity';

export type { ApiKeyUsageAction };

/**
 * ประวัติการใช้งาน API Key (ใช้คิด Rate Limit ต่อชั่วโมงและสรุป Usage)
 * เก็บแถวไว้แม้ API Key จะถูก Soft Delete
 */
@Entity({ schema: DB_SCHEMA, name: 'api_key_usage_logs' })
@Index('idx_usage_logs_business_action_created', [
  'business_id',
  'action',
  'created_at',
])
@Index('idx_usage_logs_api_key_created', ['api_key_id', 'created_at'])
export class ApiKeyUsageLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'api_key_id' })
  api_key_id: string;

  @ManyToOne(() => ApiKey, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'api_key_id' })
  api_key: ApiKey;

  @Column({ type: 'uuid', name: 'business_id' })
  business_id: string;

  @ManyToOne(() => Business, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'business_id' })
  business: Business;

  @Column({ type: 'varchar', length: 64, name: 'payment_order_id', nullable: true })
  payment_order_id: string | null;

  @Column({ type: 'varchar', length: 30 })
  action: ApiKeyUsageAction;

  @Column({ type: 'boolean', name: 'quota_deducted', default: false })
  quota_deducted: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
