import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { DatabaseSecurityService } from './database-security.service';
import { DB_SCHEMA } from './database.schema';

describe('DatabaseSecurityService', () => {
  let service: DatabaseSecurityService;
  let dataSource: { query: jest.Mock };

  beforeEach(async () => {
    dataSource = {
      query: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DatabaseSecurityService,
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = module.get<DatabaseSecurityService>(DatabaseSecurityService);
  });

  it('executes RLS hardening SQL for the apay schema on bootstrap', async () => {
    await service.onApplicationBootstrap();

    expect(dataSource.query).toHaveBeenCalledTimes(1);
    const sql: string = dataSource.query.mock.calls[0][0];
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain(DB_SCHEMA);
    expect(sql).toContain("'payment_orders'");
    expect(sql).toContain("'webhook_logs'");
  });

  it('catches and logs warnings without throwing when query fails', async () => {
    dataSource.query.mockRejectedValueOnce(new Error('permission denied'));

    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
  });
});
