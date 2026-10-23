import { Test, TestingModule } from '@nestjs/testing';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { AuthUser } from '../auth/types/auth-user.type';
import { RoleEnum } from '../enums';
import { UsersService } from '../users/users.service';
import { ApiKeysController } from './api-keys.controller';
import { ApiKeysService } from './api-keys.service';

describe('ApiKeysController', () => {
  let controller: ApiKeysController;
  let apiKeysService: {
    createApiKey: jest.Mock;
    findAll: jest.Mock;
    getBusinessUsage: jest.Mock;
    getKeyUsage: jest.Mock;
    updateStatusOrName: jest.Mock;
    revokeApiKey: jest.Mock;
  };

  const user: AuthUser = {
    userId: 'u1',
    username: 'merchant',
    role: RoleEnum.BUSINESS,
    businessId: 'biz-1',
  };

  beforeEach(async () => {
    apiKeysService = {
      createApiKey: jest.fn(),
      findAll: jest.fn(),
      getBusinessUsage: jest.fn(),
      getKeyUsage: jest.fn(),
      updateStatusOrName: jest.fn(),
      revokeApiKey: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ApiKeysController],
      providers: [
        { provide: ApiKeysService, useValue: apiKeysService },
        { provide: UsersService, useValue: { findById: jest.fn() } },
      ],
    }).compile();

    controller = module.get<ApiKeysController>(ApiKeysController);
  });

  it('configures RoleEnum metadata on all routes', () => {
    for (const method of [
      ApiKeysController.prototype.create,
      ApiKeysController.prototype.findAll,
      ApiKeysController.prototype.getBusinessUsage,
      ApiKeysController.prototype.getKeyUsage,
      ApiKeysController.prototype.update,
      ApiKeysController.prototype.remove,
    ]) {
      expect(Reflect.getMetadata(ROLES_KEY, method)).toEqual([
        RoleEnum.ADMIN,
        RoleEnum.BUSINESS,
      ]);
    }
  });

  it('delegates all routes to ApiKeysService with authenticated user', async () => {
    await controller.create({ user } as any, { name: 'POS' });
    expect(apiKeysService.createApiKey).toHaveBeenCalledWith(user, {
      name: 'POS',
    });

    await controller.findAll({ user } as any, 'biz-1');
    expect(apiKeysService.findAll).toHaveBeenCalledWith(user, 'biz-1');

    await controller.getBusinessUsage({ user } as any, 'biz-1');
    expect(apiKeysService.getBusinessUsage).toHaveBeenCalledWith(user, 'biz-1');

    await controller.getKeyUsage({ user } as any, 'key-1');
    expect(apiKeysService.getKeyUsage).toHaveBeenCalledWith(user, 'key-1');

    await controller.update({ user } as any, 'key-1', { is_active: false });
    expect(apiKeysService.updateStatusOrName).toHaveBeenCalledWith(
      user,
      'key-1',
      { is_active: false },
    );

    await controller.remove({ user } as any, 'key-1');
    expect(apiKeysService.revokeApiKey).toHaveBeenCalledWith(user, 'key-1');
  });
});
