import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { DataSource, Repository } from 'typeorm';
import { Business } from './entities/business.entity';
import { AuthUser } from '../auth/types/auth-user.type';
import { RoleEnum } from '../enums';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { Role } from '../users/entities/role.entity';
import { User } from '../users/entities/user.entity';

const BCRYPT_ROUNDS = 10;

/**
 * ข้อมูลขั้นต่ำที่ต้องใช้สร้างบัญชีธุรกิจ (User + Business)
 * ทั้ง `RegisterBusinessDto` (admin) และ `VerifyBusinessOtpDto` (self-service)
 * มีฟิลด์ครบตาม interface นี้
 */
export interface RegisterBusinessInput {
  username: string;
  password: string;
  business_name: string;
  email: string;
  promptpay_id: string;
  line_destination?: string;
  line_user_id?: string;
  package_id?: string;
}

export interface RegisterBusinessResult {
  user_id: string;
  username: string;
  role: RoleEnum;
  business_id: string;
  business_name: string;
  email: string | null;
  promptpay_id: string;
  line_user_id: string | null;
}

@Injectable()
export class BusinessService {
  constructor(
    @InjectRepository(Business)
    private readonly businessRepository: Repository<Business>,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly dataSource: DataSource,
  ) {}

  findById(id: string): Promise<Business | null> {
    return this.businessRepository.findOne({ where: { id } });
  }

  findByUserId(userId: string): Promise<Business | null> {
    return this.businessRepository.findOne({ where: { user_id: userId } });
  }

  findByLineDestination(destination: string): Promise<Business | null> {
    return this.businessRepository.findOne({
      where: { line_destination: destination },
    });
  }

  findByLineUserId(lineUserId: string): Promise<Business | null> {
    return this.businessRepository.findOne({
      where: { line_user_id: lineUserId },
    });
  }

  assertBusinessAccess(user: AuthUser, businessId: string): void {
    if (
      user.role === RoleEnum.BUSINESS &&
      (!user.businessId || user.businessId !== businessId)
    ) {
      throw new NotFoundException('Business not found');
    }
  }

  async create(data: Partial<Business>): Promise<Business> {
    const business = this.businessRepository.create(data);

    return this.businessRepository.save(business);
  }

  /**
   * สร้างบัญชีธุรกิจใหม่ทั้งชุดใน Transaction เดียว:
   * `User` (`role = business`), `Business` และผูก Master Package (ถ้าส่ง `package_id` มา)
   *
   * ใช้ร่วมกันทั้ง `POST /auth/register-business` (admin) และ
   * `POST /auth/register-business/verify-otp` (self-service หลังยืนยันอีเมลสำเร็จ)
   * — หากขั้นตอนใดล้มเหลว (username/email ซ้ำ, ไม่มี role, package ไม่พร้อมใช้งาน)
   * ทั้งหมดจะถูก Rollback
   */
  async registerBusiness(
    dto: RegisterBusinessInput,
  ): Promise<RegisterBusinessResult> {
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

      const existingBusiness = await businessesRepository.findOne({
        where: { email: dto.email },
      });

      if (existingBusiness) {
        throw new ConflictException('Email already exists');
      }

      const businessRole = await rolesRepository.findOne({
        where: { name: RoleEnum.BUSINESS },
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

      const business = await businessesRepository.save(
        businessesRepository.create({
          user_id: user.id,
          business_name: dto.business_name,
          email: dto.email,
          promptpay_id: dto.promptpay_id,
          api_key_prefix: null,
          api_key_hash: null,
          line_destination: dto.line_destination ?? null,
          line_user_id: dto.line_user_id ?? null,
          is_active: true,
        }),
      );

      /**
       * ผูก Package ใน Transaction เดียวกัน — หาก Package ไม่พร้อมใช้งาน
       * (เช่น ถูกปิด/ไม่มีอยู่) การสร้าง User และ Business จะถูก Rollback ทั้งหมด
       */
      if (dto.package_id) {
        await this.subscriptionsService.assignOrChangePackage(
          business.id,
          dto.package_id,
          manager,
        );
      }

      return {
        user_id: user.id,
        username: user.username,
        role: RoleEnum.BUSINESS,
        business_id: business.id,
        business_name: business.business_name,
        email: business.email,
        promptpay_id: business.promptpay_id,
        line_user_id: business.line_user_id,
      };
    });
  }

  async updateRefreshTokenHash(
    businessId: string,
    hash: string | null,
  ): Promise<void> {
    await this.businessRepository.update(
      { id: businessId },
      { refresh_token_hash: hash },
    );
  }

  async resolveBusinessId(user: AuthUser): Promise<string> {
    if (!user.businessId) {
      throw new BadRequestException('Business account not found');
    }

    return user.businessId;
  }
}
