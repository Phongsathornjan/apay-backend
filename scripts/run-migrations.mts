/**
 * Migration runner: apply ไฟล์ SQL ใน `migrations/` ที่ยังไม่เคยรัน
 * แล้วบันทึกชื่อไฟล์ลง `apay.schema_migrations` (idempotent — รันซ้ำได้)
 *
 * ใช้งาน:
 *   pnpm migrate              # apply ทุกไฟล์ที่ยังไม่เคยรัน
 *   pnpm migrate --dry-run    # ดูว่าจะรันอะไร (ไม่แตะ DB เลย)
 *   node scripts/run-migrations.mts
 *
 * เรียกอัตโนมัติจาก `deploy.sh` ก่อน restart PM2 เพื่อกัน schema ตกหล่น
 * (บทเรียนจริง: prod เคย error `column "message_id" does not exist`
 *  เพราะ migration 20261102 ไม่เคยถูกสั่งรัน)
 *
 * หมายเหตุ:
 * - ต้องมี Node ที่รองรับ TypeScript type stripping (Node >= 22.18 / 24) — repo ใช้ Node 24
 * - ไฟล์ SQL ควร idempotent และจัดการ transaction เอง (BEGIN/COMMIT ในไฟล์)
 *   เพราะ runner ไม่ห่อ transaction ให้ (ไฟล์ที่มี BEGIN/COMMIT ของตัวเองจะชนกัน)
 * - import path ต้องลงท้าย `.ts` เพราะ Node resolve แบบ ESM
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnvFile } from 'node:process';
import { Client } from 'pg';
import {
  CREATE_MIGRATIONS_TABLE_SQL,
  MIGRATIONS_DIR,
  MIGRATIONS_TABLE,
  findPendingMigrations,
  isMigrationFileName,
  resolveDatabaseUrl,
} from '../src/database/migration.util.ts';

const ENV_FILE = '.env';
const DRY_RUN = process.argv.includes('--dry-run');

/** โหลด `.env` ถ้า DATABASE_URL ยังไม่มี (env ที่ตั้งไว้แล้วมีสิทธิ์เหนือกว่า) */
function loadEnvironment(): void {
  if (process.env.DATABASE_URL || !existsSync(ENV_FILE)) {
    return;
  }

  loadEnvFile(ENV_FILE);
}

/** อ่านไฟล์ migration ทั้งหมดในโฟลเดอร์ `migrations/` */
function readMigrationFiles(): { name: string; sql: string }[] {
  if (!existsSync(MIGRATIONS_DIR)) {
    return [];
  }

  return readdirSync(MIGRATIONS_DIR)
    .filter(isMigrationFileName)
    .map((name) => ({
      name,
      sql: readFileSync(join(MIGRATIONS_DIR, name), 'utf8'),
    }));
}

async function main(): Promise<void> {
  loadEnvironment();

  const connectionString = resolveDatabaseUrl(process.env);
  const files = readMigrationFiles();

  if (files.length === 0) {
    console.log(`No migration files found in ${MIGRATIONS_DIR}/`);
    return;
  }

  const client = new Client({ connectionString });
  await client.connect();

  try {
    await client.query(CREATE_MIGRATIONS_TABLE_SQL);

    const appliedResult = await client.query<{ name: string }>(
      `SELECT name FROM ${MIGRATIONS_TABLE}`,
    );
    const applied = appliedResult.rows.map((row) => row.name);
    const pending = findPendingMigrations(files, applied);

    if (pending.length === 0) {
      console.log(`Database is up to date (${applied.length} migrations applied)`);
      return;
    }

    console.log(`Applying ${pending.length} migration(s):`);

    for (const migration of pending) {
      console.log(`  - ${migration.name}`);

      if (DRY_RUN) {
        continue;
      }

      try {
        await client.query(migration.sql);
        await client.query(
          `INSERT INTO ${MIGRATIONS_TABLE} (name) VALUES ($1)
           ON CONFLICT (name) DO NOTHING`,
          [migration.name],
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Migration "${migration.name}" failed: ${message}`);
      }
    }

    console.log(
      DRY_RUN
        ? 'Dry run completed — nothing was written to the database'
        : `Applied ${pending.length} migration(s) successfully`,
    );
  } finally {
    await client.end().catch(() => undefined);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  const hint =
    message.includes('ENOTFOUND') || message.includes('ECONNREFUSED')
      ? '\nHint: check DATABASE_URL (Supabase ต้องใช้ host ของ Supavisor pooler).'
      : '';

  console.error(`Failed to run migrations: ${message}${hint}`);
  process.exitCode = 1;
});
