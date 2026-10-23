import { Test, TestingModule } from '@nestjs/testing';
import { ROLES_KEY } from './decorators/roles.decorator';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { RoleEnum } from '../enums';
import { UsersService } from '../users/users.service';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: {
    login: jest.Mock;
    registerBusiness: jest.Mock;
    exchangeApiKey: jest.Mock;
    refresh: jest.Mock;
  };

  beforeEach(async () => {
    authService = {
      login: jest.fn(),
      registerBusiness: jest.fn(),
      exchangeApiKey: jest.fn(),
      refresh: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: UsersService, useValue: { findById: jest.fn() } },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('delegates login to AuthService.login', async () => {
    const dto = { username: 'admin', password: 'secret' };
    authService.login.mockResolvedValue({ access_token: 'tok' });

    const result = await controller.login(dto);

    expect(authService.login).toHaveBeenCalledWith(dto);
    expect(result).toEqual({ access_token: 'tok' });
  });

  it('delegates registerBusiness to AuthService.registerBusiness and requires ADMIN role', async () => {
    const dto = {
      username: 'merchant',
      password: 'Password123!',
      business_name: 'Cafe',
      promptpay_id: '0812345678',
    };
    authService.registerBusiness.mockResolvedValue({ business_id: 'biz-1' });

    const roles = Reflect.getMetadata(
      ROLES_KEY,
      AuthController.prototype.registerBusiness,
    );
    expect(roles).toEqual([RoleEnum.ADMIN]);

    const result = await controller.registerBusiness(dto);

    expect(authService.registerBusiness).toHaveBeenCalledWith(dto);
    expect(result).toEqual({ business_id: 'biz-1' });
  });

  it('delegates token to AuthService.exchangeApiKey with body and x-api-key header', async () => {
    const dto = { api_key: 'apay_live_12345678_abcdef' };
    authService.exchangeApiKey.mockResolvedValue({ access_token: 'tok' });

    const result = await controller.token(dto, 'header-key');

    expect(authService.exchangeApiKey).toHaveBeenCalledWith(dto, 'header-key');
    expect(result).toEqual({ access_token: 'tok' });
  });

  it('delegates refresh to AuthService.refresh', async () => {
    authService.refresh.mockResolvedValue({ access_token: 'new-tok' });

    const result = await controller.refresh({ refresh_token: 'ref-tok' });

    expect(authService.refresh).toHaveBeenCalledWith('ref-tok');
    expect(result).toEqual({ access_token: 'new-tok' });
  });
});
