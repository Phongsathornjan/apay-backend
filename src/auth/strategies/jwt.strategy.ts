import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { RoleEnum } from '../../enums';
import { AuthUser, UserRole } from '../types/auth-user.type';

export interface JwtPayload {
  sub: string;
  username?: string;
  role?: UserRole;
  business_id?: string | null;
  api_key_id?: string | null;
  type?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_SECRET'),
    });
  }

  async validate(payload: JwtPayload): Promise<AuthUser> {
    if (!payload?.sub || (payload.type && payload.type !== 'access')) {
      throw new UnauthorizedException('Invalid access token');
    }

    return {
      userId: payload.sub,
      username: payload.username ?? '',
      role: payload.role ?? RoleEnum.BUSINESS,
      businessId: payload.business_id ?? null,
      apiKeyId: payload.api_key_id ?? null,
    };
  }
}
