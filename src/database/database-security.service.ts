import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DB_SCHEMA } from './database.schema';

/**
 * ตารางทั้งหมดที่ระบบจัดการ (ต้องตรงกับชื่อใน entity)
 */
const TABLES = [
  'roles',
  'users',
  'businesses',
  'packages',
  'business_subscriptions',
  'subscription_periods',
  'api_keys',
  'api_key_usage_logs',
  'payment_orders',
  'webhook_logs',
  'business_email_otps',
] as const;

/**
 * Service ที่รันหลัง TypeORM synchronize เสร็จ เพื่อเสริมความปลอดภัยของ schema `apay`:
 * - เปิด Row Level Security (deny-by-default) ให้ทุกตาราง
 * - ถอนสิทธิ์ของ role `anon`/`authenticated` (Supabase) ออกจาก schema และ object ทั้งหมด
 *
 * เหตุผลที่ต้องรันซ้ำทุกครั้งที่ bootstrap: tabel ที่ TypeORM สร้างใหม่จะไม่สืบทอด RLS
 * และการย้าย/สร้างตารางใหม่จะทำให้สิทธิ์กลับมาโดยอัตโนมัติถ้าไม่ตั้ง default privileges
 *
 * SQL ข้างในเป็น idempotent ทั้งหมด การรันซ้ำจึงไม่มีผลข้างเคียง
 * และจะข้าม role ที่ไม่มีอยู่จริง (เช่น บน Postgres local ที่ไม่มี anon/authenticated)
 */
@Injectable()
export class DatabaseSecurityService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DatabaseSecurityService.name);

  constructor(private readonly dataSource: DataSource) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.hardenSchema();

      this.logger.log(
        `Applied RLS hardening on schema "${DB_SCHEMA}" (${TABLES.length} tables)`,
      );
    } catch (error) {
      this.logger.warn(
        `Failed to apply database security hardening: ${
          (error as Error).message
        }`,
      );
    }
  }

  private async hardenSchema(): Promise<void> {
    const tableList = TABLES.map((table) => `'${table}'`).join(', ');

    await this.dataSource.query(`
DO $$
DECLARE
  tbl text;
  role_name text;
BEGIN
  -- 1) เปิด RLS แบบ deny-by-default ให้ทุกตารางที่มีอยู่จริง
  FOREACH tbl IN ARRAY ARRAY[${tableList}]
  LOOP
    IF to_regclass(format('%I.%I', '${DB_SCHEMA}', tbl)) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', '${DB_SCHEMA}', tbl);
    END IF;
  END LOOP;

  -- 2) ถอนสิทธิ์ของ anon/authenticated (จะข้าม role ที่ไม่มีในระบบ)
  FOR role_name IN
    SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated')
  LOOP
    EXECUTE format('REVOKE ALL ON ALL TABLES    IN SCHEMA %I FROM %I', '${DB_SCHEMA}', role_name);
    EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA %I FROM %I', '${DB_SCHEMA}', role_name);
    EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA %I FROM %I', '${DB_SCHEMA}', role_name);
    EXECUTE format('REVOKE ALL ON SCHEMA %I FROM %I', '${DB_SCHEMA}', role_name);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I REVOKE ALL ON TABLES    FROM %I', '${DB_SCHEMA}', role_name);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I REVOKE ALL ON SEQUENCES FROM %I', '${DB_SCHEMA}', role_name);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I REVOKE ALL ON FUNCTIONS FROM %I', '${DB_SCHEMA}', role_name);
  END LOOP;
END $$;
`);
  }
}
