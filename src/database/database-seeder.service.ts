import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';
import { Package } from '../packages/entities/package.entity';
import { Role } from '../users/entities/role.entity';
import { User } from '../users/entities/user.entity';

const DEFAULT_ROLES: Array<{ name: string; description: string }> = [
  { name: 'admin', description: 'ผู้ดูแลระบบ (Administrator)' },
  { name: 'business', description: 'บัญชีร้านค้า (Merchant/Business)' },
];

const DEFAULT_PACKAGES: Array<{
  code: string;
  name: string;
  description: string;
  price: number;
  max_api_keys: number;
  quota_limit: number;
  rate_limit_per_hour: number;
  billing_cycle_months: number;
}> = [
  {
    code: 'FREE',
    name: 'Free',
    description: 'แพ็กเกจทดลองใช้งานฟรี',
    price: 0,
    max_api_keys: 1,
    quota_limit: 100,
    rate_limit_per_hour: 60,
    billing_cycle_months: 1,
  },
  {
    code: 'STARTER',
    name: 'Starter',
    description: 'แพ็กเกจเริ่มต้นสำหรับร้านค้าขนาดเล็ก',
    price: 499,
    max_api_keys: 3,
    quota_limit: 1000,
    rate_limit_per_hour: 300,
    billing_cycle_months: 1,
  },
  {
    code: 'PRO',
    name: 'Pro',
    description: 'แพ็กเกจสำหรับร้านค้าที่มีปริมาณธุรกรรมสูง',
    price: 1499,
    max_api_keys: 10,
    quota_limit: 5000,
    rate_limit_per_hour: 1200,
    billing_cycle_months: 1,
  },
];

const BCRYPT_ROUNDS = 10;

@Injectable()
export class DatabaseSeederService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DatabaseSeederService.name);

  constructor(
    @InjectRepository(Role)
    private readonly rolesRepository: Repository<Role>,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(Package)
    private readonly packagesRepository: Repository<Package>,
    private readonly configService: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.seedRoles();
      await this.seedDefaultPackages();
      await this.seedAdminUser();
    } catch (error) {
      this.logger.error(
        `Database seeding failed: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }

  private async seedRoles(): Promise<void> {
    for (const role of DEFAULT_ROLES) {
      const existing = await this.rolesRepository.findOne({
        where: { name: role.name },
      });

      if (!existing) {
        await this.rolesRepository.save(this.rolesRepository.create(role));
        this.logger.log(`Seeded role "${role.name}"`);
      }
    }
  }

  private async seedDefaultPackages(): Promise<void> {
    for (const pkg of DEFAULT_PACKAGES) {
      const existing = await this.packagesRepository.findOne({
        where: { code: pkg.code },
        withDeleted: true,
      });

      if (existing) {
        continue;
      }

      await this.packagesRepository.save(
        this.packagesRepository.create({ ...pkg, is_active: true }),
      );
      this.logger.log(`Seeded package "${pkg.code}"`);
    }
  }

  private async seedAdminUser(): Promise<void> {
    const username = this.configService.get<string>('ADMIN_USERNAME');
    const password = this.configService.get<string>('ADMIN_PASSWORD');

    if (!username || !password) {
      this.logger.warn(
        'ADMIN_USERNAME or ADMIN_PASSWORD is not set, skipping admin seeding',
      );
      return;
    }

    const adminRole = await this.rolesRepository.findOne({
      where: { name: 'admin' },
    });

    if (!adminRole) {
      this.logger.warn('Admin role not found, skipping admin seeding');
      return;
    }

    const existing = await this.usersRepository.findOne({
      where: { username },
    });

    if (existing) {
      if (existing.role_id !== adminRole.id) {
        await this.usersRepository.update(
          { id: existing.id },
          { role_id: adminRole.id },
        );
        this.logger.log(`Updated user "${username}" to role "admin"`);
      }
      return;
    }

    const password_hash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    await this.usersRepository.save(
      this.usersRepository.create({
        username,
        password_hash,
        role_id: adminRole.id,
        is_active: true,
      }),
    );

    this.logger.log(`Seeded admin user "${username}"`);
  }
}
