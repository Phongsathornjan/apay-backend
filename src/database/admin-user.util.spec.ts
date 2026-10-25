import { RoleEnum } from '../enums';
import {
  ADMIN_BCRYPT_ROUNDS,
  ADMIN_ROLE_NAME,
  ADMIN_USERNAME_MAX_LENGTH,
  AdminCredentialsError,
  AdminUserQueryable,
  resolveAdminCredentials,
  upsertAdminUser,
} from './admin-user.util';

type QueryCall = { text: string; values?: unknown[] };

function createQueryable(
  responses: Array<{ rows: Array<Record<string, unknown>> }>,
): { db: AdminUserQueryable; calls: QueryCall[] } {
  const calls: QueryCall[] = [];
  let index = 0;

  const db: AdminUserQueryable = {
    query: jest.fn(async (text: string, values?: unknown[]) => {
      calls.push({ text, values });
      const response = responses[index];
      index += 1;

      if (!response) {
        throw new Error(`Unexpected query #${index}: ${text}`);
      }

      return response;
    }),
  };

  return { db, calls };
}

describe('admin-user.util', () => {
  describe('constants', () => {
    it('keeps the admin role name and bcrypt rounds in sync with the app', () => {
      expect(ADMIN_ROLE_NAME).toBe(RoleEnum.ADMIN);
      expect(ADMIN_BCRYPT_ROUNDS).toBe(10);
    });
  });

  describe('resolveAdminCredentials', () => {
    it('returns a trimmed username and an untouched password', () => {
      const credentials = resolveAdminCredentials({
        ADMIN_USERNAME: '  superadmin  ',
        ADMIN_PASSWORD: ' Secret123! ',
      });

      expect(credentials).toEqual({
        username: 'superadmin',
        password: ' Secret123! ',
      });
    });

    it('throws when ADMIN_USERNAME is missing or blank', () => {
      expect(() =>
        resolveAdminCredentials({ ADMIN_PASSWORD: 'Secret123!' }),
      ).toThrow(AdminCredentialsError);

      expect(() =>
        resolveAdminCredentials({
          ADMIN_USERNAME: '   ',
          ADMIN_PASSWORD: 'Secret123!',
        }),
      ).toThrow(AdminCredentialsError);
    });

    it('throws when ADMIN_PASSWORD is missing', () => {
      expect(() =>
        resolveAdminCredentials({ ADMIN_USERNAME: 'admin' }),
      ).toThrow(AdminCredentialsError);
    });

    it('throws when the username exceeds the users.username column length', () => {
      expect(() =>
        resolveAdminCredentials({
          ADMIN_USERNAME: 'a'.repeat(ADMIN_USERNAME_MAX_LENGTH + 1),
          ADMIN_PASSWORD: 'Secret123!',
        }),
      ).toThrow(AdminCredentialsError);
    });
  });

  describe('upsertAdminUser', () => {
    const credentials = { username: 'superadmin', password: 'Secret123!' };
    const passwordHash = '$2b$10$hashed';

    it('creates the admin role and inserts a new admin user', async () => {
      const { db, calls } = createQueryable([
        { rows: [{ id: 'role-admin' }] }, // role upsert
        { rows: [] }, // existing user lookup
        { rows: [{ id: 'user-new' }] }, // insert
      ]);

      const result = await upsertAdminUser(db, credentials, passwordHash);

      expect(result).toEqual({
        id: 'user-new',
        username: 'superadmin',
        created: true,
      });
      expect(calls[0].text).toContain('INSERT INTO apay.roles');
      expect(calls[0].values).toEqual(['admin', 'ผู้ดูแลระบบ (Administrator)']);
      expect(calls[1].text).toContain('SELECT id FROM apay.users');
      expect(calls[1].values).toEqual(['superadmin']);
      expect(calls[2].text).toContain('INSERT INTO apay.users');
      expect(calls[2].values).toEqual([
        'superadmin',
        passwordHash,
        'role-admin',
      ]);
    });

    it('updates the existing user, forces the admin role and clears the refresh token', async () => {
      const { db, calls } = createQueryable([
        { rows: [{ id: 'role-admin' }] }, // role upsert
        { rows: [{ id: 'user-existing' }] }, // existing user lookup
        { rows: [] }, // update
      ]);

      const result = await upsertAdminUser(db, credentials, passwordHash);

      expect(result).toEqual({
        id: 'user-existing',
        username: 'superadmin',
        created: false,
      });
      expect(calls[2].text).toContain('UPDATE apay.users');
      expect(calls[2].text).toContain('refresh_token_hash = NULL');
      expect(calls[2].text).toContain('updated_at = now()');
      expect(calls[2].values).toEqual([
        'user-existing',
        passwordHash,
        'role-admin',
      ]);
    });

    it('throws when the role id cannot be resolved', async () => {
      const { db } = createQueryable([{ rows: [] }]);

      await expect(
        upsertAdminUser(db, credentials, passwordHash),
      ).rejects.toThrow('Unable to resolve the "admin" role id');
    });

    it('throws when the insert returns no id', async () => {
      const { db } = createQueryable([
        { rows: [{ id: 'role-admin' }] },
        { rows: [] },
        { rows: [] },
      ]);

      await expect(
        upsertAdminUser(db, credentials, passwordHash),
      ).rejects.toThrow('Unable to insert the admin user');
    });
  });
});
