import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { RoleEnum } from '../enums';
import { Role } from './entities/role.entity';
import { User } from './entities/user.entity';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let service: UsersService;
  let usersRepository: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
  };
  let rolesRepository: {
    findOne: jest.Mock;
  };

  beforeEach(async () => {
    usersRepository = {
      findOne: jest.fn(),
      create: jest.fn((data) => data),
      save: jest.fn(async (data) => ({ id: 'user-1', ...data })),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    rolesRepository = {
      findOne: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: usersRepository },
        { provide: getRepositoryToken(Role), useValue: rolesRepository },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('finds a role by name', async () => {
    rolesRepository.findOne.mockResolvedValue({
      id: 'role-1',
      name: RoleEnum.ADMIN,
    });

    const result = await service.findByRoleName(RoleEnum.ADMIN);

    expect(rolesRepository.findOne).toHaveBeenCalledWith({
      where: { name: RoleEnum.ADMIN },
    });
    expect(result).toEqual({ id: 'role-1', name: RoleEnum.ADMIN });
  });

  it('finds a user by username with role relation', async () => {
    usersRepository.findOne.mockResolvedValue({
      id: 'user-1',
      username: 'merchant',
    });

    await service.findByUsername('merchant');

    expect(usersRepository.findOne).toHaveBeenCalledWith({
      where: { username: 'merchant' },
      relations: { role: true },
    });
  });

  it('finds a user by id with role relation', async () => {
    usersRepository.findOne.mockResolvedValue({ id: 'user-1' });

    await service.findById('user-1');

    expect(usersRepository.findOne).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      relations: { role: true },
    });
  });

  it('creates a user with default is_active = true', async () => {
    const result = await service.create({
      username: 'merchant',
      password_hash: 'hashed',
      role_id: 'role-1',
    });

    expect(usersRepository.create).toHaveBeenCalledWith({
      is_active: true,
      username: 'merchant',
      password_hash: 'hashed',
      role_id: 'role-1',
    });
    expect(result).toMatchObject({
      id: 'user-1',
      username: 'merchant',
      is_active: true,
    });
  });

  it('updates refresh_token_hash for a user', async () => {
    await service.updateRefreshTokenHash('user-1', 'new-hash');

    expect(usersRepository.update).toHaveBeenCalledWith(
      { id: 'user-1' },
      { refresh_token_hash: 'new-hash' },
    );
  });
});
