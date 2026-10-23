import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RoleEnum } from '../../enums';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;

  beforeEach(() => {
    const configService = {
      getOrThrow: jest.fn().mockReturnValue('test-jwt-secret'),
    } as unknown as ConfigService;

    strategy = new JwtStrategy(configService);
  });

  it('maps a valid access JWT payload to AuthUser', async () => {
    const user = await strategy.validate({
      sub: 'user-1',
      username: 'merchant',
      role: RoleEnum.BUSINESS,
      business_id: 'biz-1',
      api_key_id: 'key-1',
      type: 'access',
    });

    expect(user).toEqual({
      userId: 'user-1',
      username: 'merchant',
      role: RoleEnum.BUSINESS,
      businessId: 'biz-1',
      apiKeyId: 'key-1',
    });
  });

  it('applies safe defaults when optional fields are omitted', async () => {
    const user = await strategy.validate({
      sub: 'user-2',
    });

    expect(user).toEqual({
      userId: 'user-2',
      username: '',
      role: RoleEnum.BUSINESS,
      businessId: null,
      apiKeyId: null,
    });
  });

  it('rejects payloads missing sub', async () => {
    await expect(strategy.validate({ sub: '' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects refresh tokens used as access tokens', async () => {
    await expect(
      strategy.validate({
        sub: 'user-1',
        type: 'refresh',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
