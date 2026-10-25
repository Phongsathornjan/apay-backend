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

  @Column({ type: 'varchar', length: 128, name: 'api_key_hash', nullable: true })
  api_key_hash: string | null;

  @Column({
    type: 'varchar',
    length: 128,
    name: 'refresh_token_hash',
    nullable: true,
  })
  refresh_token_hash: string | null;

  @Index('idx_businesses_line_destination')
  @Column({ type: 'varchar', length: 64, name: 'line_destination', nullable: true })
  line_destination: string | null;

  /**
   * LINE User ID ของเจ้าของธุรกิจ (ได้มาจากการผูกผ่าน QR ยืนยัน 0.01 - 0.99)
   * เป็น `null` จนกว่าจะผูกสำเร็จ และธุรกิจที่ยังไม่ผูกจะสร้าง QR รับเงินไม่ได้
   */
  @Index('idx_businesses_line_user_id', { unique: true })
  @Column({ type: 'varchar', length: 64, name: 'line_user_id', nullable: true })
  line_user_id: string | null;

  @Column({ type: 'boolean', name: 'is_active', default: true })
  is_active: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
