import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { RoleEnum } from '../../enums';
import { UsersService } from '../../users/users.service';
import { AuthUser } from '../types/auth-user.type';
import { RoleGuard } from './role.guard';

describe('RoleGuard', () => {
  let guard: RoleGuard;
  let reflector: { getAllAndOverride: jest.Mock };
  let usersService: { findById: jest.Mock };

  const buildContext = (user?: Partial<AuthUser>): ExecutionContext =>
    ({
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
    }) as unknown as ExecutionContext;

  beforeEach(async () => {
    reflector = {
      getAllAndOverride: jest.fn(),
    };
    usersService = {
      findById: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoleGuard,
        { provide: Reflector, useValue: reflector },
        { provide: UsersService, useValue: usersService },
      ],
    }).compile();

    guard = module.get<RoleGuard>(RoleGuard);
  });

  it('allows access when no roles are required on the route', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);

    await expect(guard.canActivate(buildContext())).resolves.toBe(true);
    expect(usersService.findById).not.toHaveBeenCalled();
  });

  it('allows access when requiredRoles array is empty', async () => {
    reflector.getAllAndOverride.mockReturnValue([]);

    await expect(guard.canActivate(buildContext())).resolves.toBe(true);
  });

  it('throws ForbiddenException when request.user or userId is missing', async () => {
    reflector.getAllAndOverride.mockReturnValue([RoleEnum.ADMIN]);

    await expect(guard.canActivate(buildContext(undefined))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('throws ForbiddenException when user does not exist or is inactive', async () => {
    reflector.getAllAndOverride.mockReturnValue([RoleEnum.ADMIN]);
    usersService.findById.mockResolvedValue({
      id: 'user-1',
      is_active: false,
      role: { name: RoleEnum.ADMIN },
    });

    await expect(
      guard.canActivate(buildContext({ userId: 'user-1', role: RoleEnum.ADMIN })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('throws ForbiddenException when user role is not in requiredRoles', async () => {
    reflector.getAllAndOverride.mockReturnValue([RoleEnum.ADMIN]);
    usersService.findById.mockResolvedValue({
      id: 'user-1',
      is_active: true,
      role: { name: RoleEnum.BUSINESS },
    });

    await expect(
      guard.canActivate(
        buildContext({ userId: 'user-1', role: RoleEnum.BUSINESS }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows access and syncs request.user.role from DB when user has required role', async () => {
    reflector.getAllAndOverride.mockReturnValue([
      RoleEnum.ADMIN,
      RoleEnum.BUSINESS,
    ]);
    usersService.findById.mockResolvedValue({
      id: 'user-1',
      is_active: true,
      role: { name: RoleEnum.ADMIN },
    });

    const user: AuthUser = {
      userId: 'user-1',
      username: 'admin',
      role: RoleEnum.BUSINESS,
      businessId: null,
    };

    const context = {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(user.role).toBe(RoleEnum.ADMIN);
  });
});
