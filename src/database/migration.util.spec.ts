import {
  CREATE_MIGRATIONS_TABLE_SQL,
  MIGRATIONS_DIR,
  MIGRATIONS_TABLE,
  MigrationConfigError,
  findPendingMigrations,
  isMigrationFileName,
  resolveDatabaseUrl,
  sortMigrationFiles,
} from './migration.util';

describe('migration.util', () => {
  describe('isMigrationFileName', () => {
    it.each([
      '20261102_remove_line_integration.sql',
      '20261018_move_tables_to_apay_schema.sql',
      '20261025_add_business_email_otp.sql',
    ])('accepts %s', (name) => {
      expect(isMigrationFileName(name)).toBe(true);
    });

    it.each([
      'README.md',
      '.gitkeep',
      '20261102_remove_line_integration.sql.bak',
      'remove_line_integration.sql',
      '2026110_short_prefix.sql',
      '20261102_has space.sql',
      '20261102_remove_line_integration.txt',
      '',
    ])('rejects %s', (name) => {
      expect(isMigrationFileName(name)).toBe(false);
    });
  });

  describe('sortMigrationFiles', () => {
    it('sorts by name ascending without mutating the input', () => {
      const files = [
        { name: '20261102_remove_line_integration.sql' },
        { name: '20261018_move_tables_to_apay_schema.sql' },
        { name: '20261025_add_business_email.sql' },
      ];

      const sorted = sortMigrationFiles(files);

      expect(sorted.map((f) => f.name)).toEqual([
        '20261018_move_tables_to_apay_schema.sql',
        '20261025_add_business_email.sql',
        '20261102_remove_line_integration.sql',
      ]);
      expect(files[0].name).toBe('20261102_remove_line_integration.sql');
    });
  });

  describe('findPendingMigrations', () => {
    const files = [
      { name: '20261018_move_tables_to_apay_schema.sql', sql: 'a' },
      { name: '20261023_add_line_user_id.sql', sql: 'b' },
      { name: '20261102_remove_line_integration.sql', sql: 'c' },
    ];

    it('returns migrations not recorded as applied, in order', () => {
      const pending = findPendingMigrations(files, [
        '20261018_move_tables_to_apay_schema.sql',
      ]);

      expect(pending.map((f) => f.name)).toEqual([
        '20261023_add_line_user_id.sql',
        '20261102_remove_line_integration.sql',
      ]);
    });

    it('returns everything when nothing has been applied yet', () => {
      expect(findPendingMigrations(files, []).map((f) => f.name)).toEqual([
        '20261018_move_tables_to_apay_schema.sql',
        '20261023_add_line_user_id.sql',
        '20261102_remove_line_integration.sql',
      ]);
    });

    it('returns an empty list when everything is applied', () => {
      expect(
        findPendingMigrations(
          files,
          files.map((f) => f.name),
        ),
      ).toEqual([]);
    });

    it('ignores applied names that are not in the folder', () => {
      const pending = findPendingMigrations(files, ['20200101_old.sql']);

      expect(pending).toHaveLength(3);
    });
  });

  describe('resolveDatabaseUrl', () => {
    it('returns the trimmed connection string', () => {
      expect(
        resolveDatabaseUrl({ DATABASE_URL: '  postgresql://u:p@host:5432/db  ' }),
      ).toBe('postgresql://u:p@host:5432/db');
    });

    it('throws when DATABASE_URL is missing or blank', () => {
      expect(() => resolveDatabaseUrl({})).toThrow(MigrationConfigError);
      expect(() => resolveDatabaseUrl({ DATABASE_URL: '   ' })).toThrow(
        /DATABASE_URL must be set/,
      );
    });
  });

  describe('constants', () => {
    it('keeps the migrations table inside the apay schema', () => {
      expect(MIGRATIONS_DIR).toBe('migrations');
      expect(MIGRATIONS_TABLE).toBe('apay.schema_migrations');
      expect(CREATE_MIGRATIONS_TABLE_SQL).toContain(
        'CREATE TABLE IF NOT EXISTS apay.schema_migrations',
      );
    });
  });
});
