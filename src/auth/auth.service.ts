import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { Business } from '../business/entities/business.entity';
import { BusinessService } from '../business/business.service';
import { safeCompare, sha256 } from '../common/utils/crypto.util';
import { durationToSeconds } from '../common/utils/duration.util';
import { Role } from '../users/entities/role.entity';
import { User } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { GetTokenDto } from './dto/get-token.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterBusinessDto } from './dto/register-business.dto';
import { UserRole } from './types/auth-user.type';
import { extractApiKeyPrefix, generateApiKey } from './utils/api-key.util';

const BCRYPT_ROUNDS = 10;
const DEFAULT_ACCESS_EXPIRES_IN = '15m';
const DEFAULT_REFRESH_EXPIRES_IN = '7d';

export interface TokenBundle {
  access_token: string;
  refresh_token: string;
  token_type: 'Bearer';
  expires_in: number;
}

interface SignTokenParams {
  userId: string;
  username: string;
  role: UserRole;
  businessId: string | null;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
    private readonly businessService: BusinessService,
    private readonly dataSource: DataSource,
  ) {}

  async login(dto: LoginDto) {
    const user = await this.usersService.findByUsername(dto.username);

    if (!user || !user.is_active || !user.role) {
      throw new UnauthorizedException('Invalid username or password');
    }

    const isPasswordValid = await bcrypt.compare(
      dto.password,
      user.password_hash,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid username or password');
    }

    const role = user.role.name as UserRole;
    let businessId: string | null = null;

    if (role === 'business') {
      const business = await this.businessService.findByUserId(user.id);

      if (!business || !business.is_active) {
        throw new UnauthorizedException('Business account is not active');
      }

      businessId = business.id;
    }

    const tokens = await this.signTokenBundle({
      userId: user.id,
      username: user.username,
      role,
      businessId,
    });

    await this.persistRefreshTokenHash(
      user.id,
      businessId,
      tokens.refresh_token,
    );

    return {
      ...tokens,
      user: {
        user_id: user.id,
        username: user.username,
        role,
        business_id: businessId,
      },
    };
  }

  async registerBusiness(dto: RegisterBusinessDto) {
    return this.dataSource.transaction(async (manager) => {
      const usersRepository = manager.getRepository(User);
      const rolesRepository = manager.getRepository(Role);
      const businessesRepository = manager.getRepository(Business);

      const existingUser = await usersRepository.findOne({
        where: { username: dto.username },
      });

      if (existingUser) {
        throw new ConflictException('Username already exists');
      }

      const businessRole = await rolesRepository.findOne({
        where: { name: 'business' },
      });

      if (!businessRole) {
        throw new InternalServerErrorException(
          'Business role is not configured',
        );
      }

      const password_hash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

      const user = await usersRepository.save(
        usersRepository.create({
          username: dto.username,
          password_hash,
          role_id: businessRole.id,
          is_active: true,
        }),
      );

      const { rawApiKey, prefix, hash } = generateApiKey();

      const business = await businessesRepository.save(
        businessesRepository.create({
          user_id: user.id,
          business_name: dto.business_name,
          promptpay_id: dto.promptpay_id,
          api_key_prefix: prefix,
          api_key_hash: hash,
          line_destination: dto.line_destination ?? null,
          is_active: true,
        }),
      );

      return {
        user_id: user.id,
        username: user.username,
        role: 'business' as UserRole,
        business_id: business.id,
        business_name: business.business_name,
        promptpay_id: business.promptpay_id,
        api_key: rawApiKey,
      };
    });
  }

  async exchangeApiKey(dto: GetTokenDto, headerApiKey?: string): Promise<TokenBundle> {
    const apiKey = dto.api_key ?? headerApiKey;

    if (!apiKey) {
      throw new UnauthorizedException('API key is required');
    }

    const prefix = extractApiKeyPrefix(apiKey);
    const business = await this.businessService.findByApiKeyPrefix(prefix);

    if (!business || !business.is_active) {
      throw new UnauthorizedException('Invalid API key');
    }

    if (!business.user || !business.user.is_active) {
      throw new UnauthorizedException('Invalid API key');
    }

    if (!safeCompare(sha256(apiKey), business.api_key_hash)) {
      throw new UnauthorizedException('Invalid API key');
    }

    const tokens = await this.signTokenBundle({
      userId: business.user_id,
      username: business.user.username,
      role: 'business',
      businessId: business.id,
    });

    await this.persistRefreshTokenHash(
      business.user_id,
      business.id,
      tokens.refresh_token,
    );

    return tokens;
  }

  async refresh(refreshToken: string): Promise<TokenBundle> {
    let payload: { sub?: string; type?: string };

    try {
      payload = await this.jwtService.verifyAsync(refreshToken, {
        secret: this.getRefreshSecret(),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (payload.type !== 'refresh' || !payload.sub) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const user = await this.usersService.findById(payload.sub);

    if (!user || !user.is_active || !user.role) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const role = user.role.name as UserRole;
    let business: Business | null = null;

    if (role === 'business') {
      business = await this.businessService.findByUserId(user.id);

      if (!business || !business.is_active) {
        throw new UnauthorizedException('Invalid refresh token');
      }
    }

    const incomingHash = sha256(refreshToken);
    const userHash = user.refresh_token_hash;
    const businessHash = business?.refresh_token_hash ?? null;

    const matchesUserHash = userHash ? safeCompare(incomingHash, userHash) : false;
    const matchesBusinessHash = businessHash
      ? safeCompare(incomingHash, businessHash)
      : false;

    if (!matchesUserHash && !matchesBusinessHash) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const tokens = await this.signTokenBundle({
      userId: user.id,
      username: user.username,
      role,
      businessId: business?.id ?? null,
    });

    await this.persistRefreshTokenHash(
      user.id,
      business?.id ?? null,
      tokens.refresh_token,
    );

    return tokens;
  }

  private async persistRefreshTokenHash(
    userId: string,
    businessId: string | null,
    refreshToken: string,
  ): Promise<void> {
    const hash = sha256(refreshToken);

    await this.usersService.updateRefreshTokenHash(userId, hash);

    if (businessId) {
      await this.businessService.updateRefreshTokenHash(businessId, hash);
    }
  }

  private async signTokenBundle(params: SignTokenParams): Promise<TokenBundle> {
    const accessExpiresIn = this.configService.get<string>('JWT_EXPIRES_IN') ??
      DEFAULT_ACCESS_EXPIRES_IN;
    const refreshExpiresIn =
      this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') ??
      DEFAULT_REFRESH_EXPIRES_IN;

    const access_token = await this.jwtService.signAsync(
      {
        sub: params.userId,
        username: params.username,
        role: params.role,
        business_id: params.businessId,
        type: 'access',
      } satisfies Record<string, unknown>,
      {
        secret: this.configService.getOrThrow<string>('JWT_SECRET'),
        expiresIn: accessExpiresIn as unknown as number,
      },
    );

    const refresh_token = await this.jwtService.signAsync(
      {
        sub: params.userId,
        username: params.username,
        role: params.role,
        business_id: params.businessId,
        type: 'refresh',
        jti: randomUUID(),
      } satisfies Record<string, unknown>,
      {
        secret: this.getRefreshSecret(),
        expiresIn: refreshExpiresIn as unknown as number,
      },
    );

    return {
      access_token,
      refresh_token,
      token_type: 'Bearer',
      expires_in: durationToSeconds(accessExpiresIn, 900),
    };
  }

  private getRefreshSecret(): string {
    return this.configService.getOrThrow<string>('JWT_REFRESH_SECRET');
  }
}
