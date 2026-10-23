import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { UsersService } from '../../users/users.service';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { AuthUser, UserRole } from '../types/auth-user.type';

@Injectable()
export class RoleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly usersService: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthUser }>();

    const requestUser = request.user;

    if (!requestUser?.userId) {
      throw new ForbiddenException('Insufficient role permissions');
    }

    const user = await this.usersService.findById(requestUser.userId);

    if (!user || !user.is_active || !user.role) {
      throw new ForbiddenException('Insufficient role permissions');
    }

    const dbRole = user.role.name as UserRole;

    if (!requiredRoles.includes(dbRole)) {
      throw new ForbiddenException('Insufficient role permissions');
    }

    requestUser.role = dbRole;

    return true;
  }
}
