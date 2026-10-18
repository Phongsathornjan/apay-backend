import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Role } from './entities/role.entity';
import { User } from './entities/user.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(Role)
    private readonly rolesRepository: Repository<Role>,
  ) {}

  findByRoleName(name: string): Promise<Role | null> {
    return this.rolesRepository.findOne({ where: { name } });
  }

  findByUsername(username: string): Promise<User | null> {
    return this.usersRepository.findOne({
      where: { username },
      relations: { role: true },
    });
  }

  findById(id: string): Promise<User | null> {
    return this.usersRepository.findOne({
      where: { id },
      relations: { role: true },
    });
  }

  async create(data: {
    username: string;
    password_hash: string;
    role_id: string;
    is_active?: boolean;
  }): Promise<User> {
    const user = this.usersRepository.create({
      is_active: true,
      ...data,
    });

    return this.usersRepository.save(user);
  }

  async updateRefreshTokenHash(
    userId: string,
    hash: string | null,
  ): Promise<void> {
    await this.usersRepository.update({ id: userId }, { refresh_token_hash: hash });
  }
}
