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

/**
 * API Key ของ Business (1 Business มีได้หลาย Key ตาม `max_api_keys` ของแพ็กเกจ)
 * เก็บเฉพาะ `key_prefix` และ SHA-256 `key_hash` ไม่เก็บ Raw Key
 */
@Entity({ schema: DB_SCHEMA, name: 'api_keys' })
export class ApiKey {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('idx_api_keys_business')
  @Column({ type: 'uuid', name: 'business_id' })
  business_id: string;

  @ManyToOne(() => Business, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'business_id' })
  business: Business;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'varchar', length: 24, name: 'key_prefix', unique: true })
  key_prefix: string;

  @Column({ type: 'varchar', length: 128, name: 'key_hash' })
  key_hash: string;

  @Column({
    type: 'varchar',
    length: 128,
    name: 'refresh_token_hash',
    nullable: true,
  })
  refresh_token_hash: string | null;

  @Column({ type: 'boolean', name: 'is_active', default: true })
  is_active: boolean;

  @Column({ type: 'timestamptz', name: 'last_used_at', nullable: true })
  last_used_at: Date | null;

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
