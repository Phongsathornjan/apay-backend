/**
 * Helper สำหรับ migration script ที่สร้าง/อัปเดต user admin จากค่าใน `.env`
 * (`scripts/create-admin.mts` → `pnpm create:admin`)
 *
 * ไฟล์นี้ต้องไม่ import อะไรเลย เพราะถูก import ตรงจาก Node (type stripping)
 * ใน `scripts/create-admin.mts` ซึ่ง resolve path แบบ ESM ต้องมีนามสกุลไฟล์เท่านั้น
 */

/** ชื่อ role ของผู้ดูแลระบบ (ตรงกับ RoleEnum.ADMIN ใน src/enums/role.enum.ts) */
export const ADMIN_ROLE_NAME = 'admin';

/** คำอธิบาย role เริ่มต้น (ตรงกับ DatabaseSeederService) */
export const ADMIN_ROLE_DESCRIPTION = 'ผู้ดูแลระบบ (Administrator)';

/** จำนวนรอบ bcrypt ให้ตรงกับ DatabaseSeederService (BCRYPT_ROUNDS = 10) */
export const ADMIN_BCRYPT_ROUNDS = 10;

/** `apay.users.username` เป็น varchar(100) */
export const ADMIN_USERNAME_MAX_LENGTH = 100;

export interface AdminCredentials {
  username: string;
  password: string;
}

/** minimal interface ของ pg Client เพื่อให้ unit test mock ได้โดยไม่ต้องต่อ DB */
export interface AdminUserQueryable {
  query(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: Array<Record<string, unknown>> }>;
}

export interface UpsertAdminUserResult {
  id: string;
  username: string;
  /** true = สร้าง user ใหม่, false = อัปเดต user เดิม */
  created: boolean;
}

export class AdminCredentialsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdminCredentialsError';
  }
}

/**
 * ดึง username/password ของ admin จาก environment (`.env`)
 * - username จะถูก trim ส่วน password ไม่ trim (ช่องว่างอาจเป็นส่วนหนึ่งของรหัสผ่าน)
 * - ต้องมีทั้งสองค่าและ username ต้องไม่เกิน 100 ตัวอักษรตาม schema
 */
export function resolveAdminCredentials(
  env: NodeJS.ProcessEnv = process.env,
): AdminCredentials {
  const username = (env.ADMIN_USERNAME ?? '').trim();
  const password = env.ADMIN_PASSWORD ?? '';

  if (!username || !password) {
    throw new AdminCredentialsError(
      'ADMIN_USERNAME and ADMIN_PASSWORD must be set (e.g. in .env)',
    );
  }

  if (username.length > ADMIN_USERNAME_MAX_LENGTH) {
    throw new AdminCredentialsError(
      `ADMIN_USERNAME must be at most ${ADMIN_USERNAME_MAX_LENGTH} characters`,
    );
  }

  return { username, password };
}

/**
 * สร้าง/อัปเดต admin user ใน schema `apay` (idempotent)
 * - สร้าง role `admin` ให้ถ้ายังไม่มี
 * - ถ้ามี username อยู่แล้ว: เปลี่ยน password_hash, role, เปิดใช้งาน และล้าง refresh_token_hash
 * - ถ้ายังไม่มี: insert user ใหม่
 *
 * ต้องเรียกภายใน transaction (script ทำ BEGIN/COMMIT ให้)
 */
export async function upsertAdminUser(
  db: AdminUserQueryable,
  credentials: AdminCredentials,
  passwordHash: string,
): Promise<UpsertAdminUserResult> {
  const roleResult = await db.query(
    `INSERT INTO apay.roles (name, description)
     VALUES ($1, $2)
     ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [ADMIN_ROLE_NAME, ADMIN_ROLE_DESCRIPTION],
  );

  const roleId = roleResult.rows[0]?.id;
  if (!roleId) {
    throw new Error(`Unable to resolve the "${ADMIN_ROLE_NAME}" role id`);
  }

  const existing = await db.query(
    'SELECT id FROM apay.users WHERE username = $1',
    [credentials.username],
  );

  const existingId = existing.rows[0]?.id;
  if (existingId) {
    await db.query(
      `UPDATE apay.users
       SET password_hash = $2,
           role_id = $3,
           is_active = true,
           refresh_token_hash = NULL,
           updated_at = now()
       WHERE id = $1`,
      [existingId, passwordHash, roleId],
    );

    return {
      id: String(existingId),
      username: credentials.username,
      created: false,
    };
  }

  const inserted = await db.query(
    `INSERT INTO apay.users (username, password_hash, role_id, is_active)
     VALUES ($1, $2, $3, true)
     RETURNING id`,
    [credentials.username, passwordHash, roleId],
  );

  const insertedId = inserted.rows[0]?.id;
  if (!insertedId) {
    throw new Error('Unable to insert the admin user');
  }

  return {
    id: String(insertedId),
    username: credentials.username,
    created: true,
  };
}
