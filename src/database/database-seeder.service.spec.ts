import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { RoleEnum } from '../enums';
import { Package } from '../packages/entities/package.entity';
import { Role } from '../users/entities/role.entity';
import { User } from '../users/entities/user.entity';
import { DatabaseSeederService } from './database-seeder.service';

describe('DatabaseSeederService', () => {
  let service: DatabaseSeederService;
  let rolesRepository: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let usersRepository: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
  };
  let packagesRepository: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let configService: {
    get: jest.Mock;
  };

  beforeEach(async () => {
    rolesRepository = {
      findOne: jest.fn(),
      create: jest.fn((data) => data),
      save: jest.fn(async (data) => data),
    };
    usersRepository = {
      findOne: jest.fn(),
      create: jest.fn((data) => data),
      save: jest.fn(async (data) => data),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    packagesRepository = {
      findOne: jest.fn(),
      create: jest.fn((data) => data),
      save: jest.fn(async (data) => data),
    };
    configService = {
      get: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DatabaseSeederService,
        { provide: getRepositoryToken(Role), useValue: rolesRepository },
        { provide: getRepositoryToken(User), useValue: usersRepository },
        { provide: getRepositoryToken(Package), useValue: packagesRepository },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<DatabaseSeederService>(DatabaseSeederService);
  });

  it('seeds missing default roles, default packages, and admin user on bootstrap', async () => {
    rolesRepository.findOne
      .mockResolvedValueOnce(null) // admin role check during seedRoles
      .mockResolvedValueOnce(null) // business role check during seedRoles
      .mockResolvedValueOnce({ id: 'role-admin', name: RoleEnum.ADMIN }); // admin role check during seedAdminUser

    packagesRepository.findOne.mockResolvedValue(null);
    configService.get.mockImplementation((key: string) => {
      if (key === 'ADMIN_USERNAME') return 'superadmin';
      if (key === 'ADMIN_PASSWORD') return 'Secret123!';
      return undefined;
    });
    usersRepository.findOne.mockResolvedValue(null);

    await service.onApplicationBootstrap();

    expect(rolesRepository.save).toHaveBeenCalledTimes(2);
    expect(packagesRepository.save).toHaveBeenCalledTimes(3);
    expect(usersRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        username: 'superadmin',
        role_id: 'role-admin',
        is_active: true,
      }),
    );
  });

  it('skips existing roles and packages and updates existing admin user role if needed', async () => {
    rolesRepository.findOne.mockResolvedValue({
      id: 'role-admin',
      name: RoleEnum.ADMIN,
    });
    packagesRepository.findOne.mockResolvedValue({ id: 'pkg-1' });
    configService.get.mockImplementation((key: string) => {
      if (key === 'ADMIN_USERNAME') return 'superadmin';
      if (key === 'ADMIN_PASSWORD') return 'Secret123!';
      return undefined;
    });
    usersRepository.findOne.mockResolvedValue({
      id: 'user-1',
      username: 'superadmin',
      role_id: 'old-role',
    });

    await service.onApplicationBootstrap();

    expect(rolesRepository.save).not.toHaveBeenCalled();
    expect(packagesRepository.save).not.toHaveBeenCalled();
    expect(usersRepository.update).toHaveBeenCalledWith(
      { id: 'user-1' },
      { role_id: 'role-admin' },
    );
  });

  it('skips admin seeding when ADMIN_USERNAME or ADMIN_PASSWORD is not set', async () => {
    rolesRepository.findOne.mockResolvedValue({ id: 'role-1' });
    packagesRepository.findOne.mockResolvedValue({ id: 'pkg-1' });
    configService.get.mockReturnValue(undefined);

    await service.onApplicationBootstrap();

    expect(usersRepository.save).not.toHaveBeenCalled();
  });

  it('catches and logs errors without crashing application bootstrap', async () => {
    rolesRepository.findOne.mockRejectedValue(new Error('DB connection error'));

    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
  });
});
