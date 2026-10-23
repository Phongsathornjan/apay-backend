import { Test, TestingModule } from '@nestjs/testing';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { AuthUser } from '../auth/types/auth-user.type';
import { RoleEnum } from '../enums';
import { UsersService } from '../users/users.service';
import { PackagesController } from './packages.controller';
import { PackagesService } from './packages.service';

describe('PackagesController', () => {
  let controller: PackagesController;
  let packagesService: {
    create: jest.Mock;
    findAll: jest.Mock;
    findByIdOrFail: jest.Mock;
    update: jest.Mock;
    softDelete: jest.Mock;
  };

  beforeEach(async () => {
    packagesService = {
      create: jest.fn(),
      findAll: jest.fn(),
      findByIdOrFail: jest.fn(),
      update: jest.fn(),
      softDelete: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PackagesController],
      providers: [
        { provide: PackagesService, useValue: packagesService },
        { provide: UsersService, useValue: { findById: jest.fn() } },
      ],
    }).compile();

    controller = module.get<PackagesController>(PackagesController);
  });

  it('configures RoleEnum metadata on routes', () => {
    expect(
      Reflect.getMetadata(ROLES_KEY, PackagesController.prototype.create),
    ).toEqual([RoleEnum.ADMIN]);
    expect(
      Reflect.getMetadata(ROLES_KEY, PackagesController.prototype.findAll),
    ).toEqual([RoleEnum.ADMIN, RoleEnum.BUSINESS]);
    expect(
      Reflect.getMetadata(ROLES_KEY, PackagesController.prototype.findOne),
    ).toEqual([RoleEnum.ADMIN, RoleEnum.BUSINESS]);
    expect(
      Reflect.getMetadata(ROLES_KEY, PackagesController.prototype.update),
    ).toEqual([RoleEnum.ADMIN]);
    expect(
      Reflect.getMetadata(ROLES_KEY, PackagesController.prototype.remove),
    ).toEqual([RoleEnum.ADMIN]);
  });

  it('forces only_active = true for business users in findAll', async () => {
    const businessUser: AuthUser = {
      userId: 'u1',
      username: 'merchant',
      role: RoleEnum.BUSINESS,
      businessId: 'biz-1',
    };

    await controller.findAll({ user: businessUser } as any, 'false');

    expect(packagesService.findAll).toHaveBeenCalledWith(true);
  });

  it('respects only_active query param for admin users in findAll', async () => {
    const adminUser: AuthUser = {
      userId: 'admin-1',
      username: 'admin',
      role: RoleEnum.ADMIN,
      businessId: null,
    };

    await controller.findAll({ user: adminUser } as any, undefined);
    expect(packagesService.findAll).toHaveBeenLastCalledWith(false);

    await controller.findAll({ user: adminUser } as any, 'true');
    expect(packagesService.findAll).toHaveBeenLastCalledWith(true);
  });

  it('delegates create, findOne, update, and remove to PackagesService', async () => {
    const createDto = {
      code: 'PRO',
      name: 'Pro',
      price: 999,
      max_api_keys: 5,
      quota_limit: 5000,
      rate_limit_per_hour: 500,
    };

    await controller.create(createDto);
    expect(packagesService.create).toHaveBeenCalledWith(createDto);

    await controller.findOne('pkg-1');
    expect(packagesService.findByIdOrFail).toHaveBeenCalledWith('pkg-1');

    await controller.update('pkg-1', { name: 'Pro Plus' });
    expect(packagesService.update).toHaveBeenCalledWith('pkg-1', {
      name: 'Pro Plus',
    });

    await controller.remove('pkg-1');
    expect(packagesService.softDelete).toHaveBeenCalledWith('pkg-1');
  });
});
