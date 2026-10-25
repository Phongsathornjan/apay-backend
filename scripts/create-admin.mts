/**
 * Migration script: สร้าง (หรืออัปเดต) user admin ใน `apay.users`
 * โดยดึง username/password จาก `.env` (ADMIN_USERNAME / ADMIN_PASSWORD)
 *
 * ใช้งาน:
 *   pnpm create:admin
 *   node scripts/create-admin.mts
 *
 * หมายเหตุ:
 * - ต้องมี Node ที่รองรับ TypeScript type stripping (Node >= 22.18 / 24) — repo ใช้ Node 24
 * - ถ้า username มีอยู่แล้ว script จะ "อัปเดต" รหัสผ่าน + role ให้เป็น admin และล้าง refresh token
 * - ถ้าต้องการสร้าง admin เพิ่มอีกคน ให้ override ค่าผ่าน env เช่น
 *     PowerShell: $env:ADMIN_USERNAME='admin2'; $env:ADMIN_PASSWORD='...'; pnpm create:admin
 * - import path ต้องลงท้าย `.ts` เพราะ Node resolve แบบ ESM (ต่างจากโค้ด Nest ที่ import แบบไม่มีนามสกุล)
 */
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import bcrypt from 'bcrypt';
import { Client } from 'pg';
import {
  ADMIN_BCRYPT_ROUNDS,
  resolveAdminCredentials,
  upsertAdminUser,
} from '../src/database/admin-user.util.ts';

const ENV_FILE = '.env';

/** โหลด `.env` ถ้าค่าจำเป็นยังไม่มี (env ที่ตั้งไว้แล้วมีสิทธิ์เหนือกว่า) */
function loadEnvironment(): void {
  const hasAllValues =
    !!process.env.DATABASE_URL &&
    !!process.env.ADMIN_USERNAME &&
    !!process.env.ADMIN_PASSWORD;

  if (hasAllValues || !existsSync(ENV_FILE)) {
    return;
  }

  loadEnvFile(ENV_FILE);
}

async function main(): Promise<void> {
  loadEnvironment();

  const credentials = resolveAdminCredentials(process.env);
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error('DATABASE_URL is not set (e.g. in .env)');
  }

  const passwordHash = await bcrypt.hash(
    credentials.password,
    ADMIN_BCRYPT_ROUNDS,
  );

  const client = new Client({ connectionString });
  await client.connect();

  try {
    await client.query('BEGIN');
    const result = await upsertAdminUser(client, credentials, passwordHash);
    await client.query('COMMIT');

    const action = result.created ? 'Created' : 'Updated';
    console.log(`${action} admin user "${result.username}" (id: ${result.id})`);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end().catch(() => undefined);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  const hint =
    message.includes('does not exist') || message.includes('relation')
      ? '\nHint: run the schema migrations / bootstrap the app once so apay.roles and apay.users exist.'
      : '';

  console.error(`Failed to create admin user: ${message}${hint}`);
  process.exitCode = 1;
});
