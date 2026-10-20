import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { numericTransformer } from '../../common/transformers/numeric.transformer';
import { DB_SCHEMA } from '../../database/database.schema';

/**
 * Master Package (แพ็กเกจหลัก) ที่ Admin กำหนด
 * ใช้เป็นต้นแบบของโควต้า/สิทธิ์เมื่อผูกให้ Business
 */
@Entity({ schema: DB_SCHEMA, name: 'packages' })
export class Package {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 50, unique: true })
  code: string;

  @Column({ type: 'varchar', length: 150 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({
    type: 'numeric',
    precision: 12,
    scale: 2,
    default: 0,
    transformer: numericTransformer,
  })
  price: number;

  @Column({ type: 'int', name: 'max_api_keys', default: 1 })
  max_api_keys: number;

  @Column({ type: 'int', name: 'quota_limit' })
  quota_limit: number;

  @Column({ type: 'int', name: 'rate_limit_per_hour' })
  rate_limit_per_hour: number;

  @Column({ type: 'int', name: 'billing_cycle_months', default: 1 })
  billing_cycle_months: number;

  @Column({ type: 'boolean', name: 'is_active', default: true })
  is_active: boolean;

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
