/**
 * Helper สำหรับ migration runner (`scripts/run-migrations.mts` → `pnpm migrate`)
 * ใช้ร่วมกับ `deploy.sh` เพื่อไม่ให้ schema ใน production ตกหล่นจากโค้ดอีก
 *
 * ไฟล์นี้ต้องไม่ import อะไรเลย เพราะถูก import ตรงจาก Node (type stripping)
 * ใน `scripts/run-migrations.mts` ซึ่ง resolve path แบบ ESM ต้องมีนามสกุลไฟล์เท่านั้น
 */

/** โฟลเดอร์เก็บไฟล์ SQL (relative จาก root ของ repo) */
export const MIGRATIONS_DIR = 'migrations';

/** ตารางบันทึกว่าไฟล์ไหนถูก apply ไปแล้ว (idempotent: สร้างถ้ายังไม่มี) */
export const MIGRATIONS_TABLE = 'apay.schema_migrations';

/** ชื่อไฟล์ที่ถือว่าเป็น migration: `YYYYMMDD_ชื่อไฟล์.sql` */
export const MIGRATION_FILE_PATTERN = /^\d{8}_[A-Za-z0-9_]+\.sql$/;

/** DDL ของตาราง tracking — ต้องรันก่อนอ่านรายการที่ apply แล้ว */
export const CREATE_MIGRATIONS_TABLE_SQL = `
CREATE SCHEMA IF NOT EXISTS apay;

CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
  name varchar(255) PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
`;

export interface MigrationFile {
  name: string;
}

export class MigrationConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MigrationConfigError';
  }
}

/**
 * ไฟล์นี้เป็น migration หรือไม่
 * (ตัดไฟล์อื่นในโฟลเดอร์ เช่น `.gitkeep`, `README.md`, `*.sql.bak` ออก)
 */
export function isMigrationFileName(fileName: string): boolean {
  return MIGRATION_FILE_PATTERN.test(fileName);
}

/**
 * เรียงไฟล์ migration จากเก่าไปใหม่ตามชื่อ (prefix `YYYYMMDD` → lexical sort = chronological)
 * ไม่แก้ array ต้นฉบับ
 */
export function sortMigrationFiles<T extends MigrationFile>(files: T[]): T[] {
  return [...files].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * คืนเฉพาะไฟล์ที่ยังไม่ถูกบันทึกว่า apply แล้ว (เรียงตามลำดับเวลา)
 */
export function findPendingMigrations<T extends MigrationFile>(
  files: T[],
  applied: Iterable<string>,
): T[] {
  const appliedSet = new Set(applied);

  return sortMigrationFiles(files).filter((file) => !appliedSet.has(file.name));
}

/**
 * ดึง connection string จาก environment (`.env`)
 * ต้องมีค่าเสมอ ไม่งั้นหยุด deploy ทันทีเพื่อไม่ให้ขึ้นโค้ดใหม่บน schema เก่า
 */
export function resolveDatabaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const url = (env.DATABASE_URL ?? '').trim();

  if (!url) {
    throw new MigrationConfigError(
      'DATABASE_URL must be set (e.g. in .env) before running migrations',
    );
  }

  return url;
}
