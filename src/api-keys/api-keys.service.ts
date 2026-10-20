import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThanOrEqual, Repository } from 'typeorm';
import { generateApiKey } from '../auth/utils/api-key.util';
import { AuthUser } from '../auth/types/auth-user.type';
import { Business } from '../business/entities/business.entity';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { CreateApiKeyDto } from './dto/create-api-key.dto';
import { UpdateApiKeyDto } from './dto/update-api-key.dto';
import { ApiKeyUsageLog } from './entities/api-key-usage-log.entity';
import { ApiKey } from './entities/api-key.entity';

const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const RECENT_LOGS_LIMIT = 20;

@Injectable()
export class ApiKeysService {
  constructor(
    @InjectRepository(ApiKey)
    private readonly apiKeysRepository: Repository<ApiKey>,
    @InjectRepository(ApiKeyUsageLog)
    private readonly usageLogsRepository: Repository<ApiKeyUsageLog>,
    @InjectRepository(Business)
    private readonly businessesRepository: Repository<Business>,
    private readonly subscriptionsService: SubscriptionsService,
  ) {}

  /**
   * สร้าง API Key ใหม่ — ต้องมี Subscription ที่ ACTIVE (ยังไม่เลย paid-through)
   * และจำนวน Key ที่ยังไม่ถูกลบต้องไม่เกิน `max_api_keys` ของแพ็กเกจ
   */
  async createApiKey(user: AuthUser, dto: CreateApiKeyDto) {
    const businessId = this.resolveBusinessId(user, dto);

    if (user.role === 'admin' && dto.package_id) {
      await this.subscriptionsService.assignOrChangePackage(
        businessId,
        dto.package_id,
      );
    }

    const business = await this.businessesRepository.findOne({
      where: { id: businessId },
    });

    if (!business) {
      throw new NotFoundException('Business not found');
    }

    if (!business.is_active) {
      throw new BadRequestException('Business is inactive');
    }

    const subscription =
      await this.subscriptionsService.getCurrentSubscription(businessId);

    if (
      !subscription ||
      subscription.status !== 'ACTIVE' ||
      subscription.current_period_end <= new Date()
    ) {
      throw new BadRequestException(
        'Business has no active prepaid package subscription',
      );
    }

    const currentKeyCount = await this.apiKeysRepository.count({
      where: { business_id: businessId },
    });

    if (currentKeyCount >= subscription.max_api_keys) {
      throw new ConflictException(
        'Maximum API keys limit reached for current package',
      );
    }

    const { rawApiKey, prefix, hash } = generateApiKey();

    const apiKey = await this.apiKeysRepository.save(
      this.apiKeysRepository.create({
        business_id: businessId,
        name: dto.name,
        key_prefix: prefix,
        key_hash: hash,
        is_active: true,
      }),
    );

    return {
      ...this.toApiKeySummary(apiKey),
      api_key: rawApiKey,
    };
  }

  async findAll(user: AuthUser, businessId?: string) {
    if (user.role === 'business' && !user.businessId) {
      throw new BadRequestException('Business account not found');
    }

    const targetBusinessId =
      user.role === 'business' ? user.businessId : businessId;

    const apiKeys = await this.apiKeysRepository.find({
      where: targetBusinessId ? { business_id: targetBusinessId } : {},
      order: { created_at: 'DESC' },
    });

    return apiKeys.map((apiKey) => this.toApiKeySummary(apiKey));
  }

  async updateStatusOrName(user: AuthUser, id: string, dto: UpdateApiKeyDto) {
    const apiKey = await this.findAccessibleKey(user, id);

    if (dto.name !== undefined) {
      apiKey.name = dto.name;
    }

    if (dto.is_active !== undefined) {
      apiKey.is_active = dto.is_active;

      // ปิดการใช้งานต้องยกเลิก Refresh Token เดิมของ Key นี้ทันที
      if (dto.is_active === false) {
        apiKey.refresh_token_hash = null;
      }
    }

    return this.toApiKeySummary(await this.apiKeysRepository.save(apiKey));
  }

  async revokeApiKey(user: AuthUser, id: string) {
    const apiKey = await this.findAccessibleKey(user, id);

    apiKey.is_active = false;
    apiKey.refresh_token_hash = null;
    await this.apiKeysRepository.save(apiKey);
    await this.apiKeysRepository.softRemove(apiKey);

    return { id: apiKey.id, revoked: true };
  }

  async getKeyUsage(user: AuthUser, apiKeyId: string) {
    const apiKey = await this.findAccessibleKey(user, apiKeyId, true);

    const hourAgo = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);

    const [
      totalQrCreated,
      totalQrPaidAndDeducted,
      requestsLastHour,
      recentLogs,
    ] = await Promise.all([
      this.usageLogsRepository.count({
        where: { api_key_id: apiKey.id, action: 'QR_CREATED' },
      }),
      this.usageLogsRepository.count({
        where: {
          api_key_id: apiKey.id,
          action: 'QR_PAID',
          quota_deducted: true,
        },
      }),
      this.usageLogsRepository.count({
        where: {
          api_key_id: apiKey.id,
          action: 'QR_CREATED',
          created_at: MoreThanOrEqual(hourAgo),
        },
      }),
      this.usageLogsRepository.find({
        where: { api_key_id: apiKey.id },
        order: { created_at: 'DESC' },
        take: RECENT_LOGS_LIMIT,
      }),
    ]);

    return {
      api_key_id: apiKey.id,
      name: apiKey.name,
      key_prefix: apiKey.key_prefix,
      is_active: apiKey.is_active,
      deleted_at: apiKey.deleted_at,
      last_used_at: apiKey.last_used_at,
      total_qr_created: totalQrCreated,
      total_qr_paid_and_deducted: totalQrPaidAndDeducted,
      current_hour_requests: requestsLastHour,
      recent_logs: recentLogs.map((log) => ({
        id: log.id,
        action: log.action,
        payment_order_id: log.payment_order_id,
        quota_deducted: log.quota_deducted,
        created_at: log.created_at,
      })),
    };
  }

  async getBusinessUsage(user: AuthUser, businessId: string) {
    this.assertBusinessAccess(user, businessId);

    return this.subscriptionsService.getBusinessUsage(businessId);
  }

  private resolveBusinessId(user: AuthUser, dto: CreateApiKeyDto): string {
    if (user.role === 'business') {
      if (!user.businessId) {
        throw new BadRequestException('Business account not found');
      }

      return user.businessId;
    }

    if (!dto.business_id) {
      throw new BadRequestException('business_id is required for admin');
    }

    return dto.business_id;
  }

  private async findAccessibleKey(
    user: AuthUser,
    id: string,
    withDeleted = false,
  ): Promise<ApiKey> {
    const apiKey = await this.apiKeysRepository.findOne({
      where: { id },
      withDeleted,
    });

    if (!apiKey) {
      throw new NotFoundException('API key not found');
    }

    this.assertBusinessAccess(user, apiKey.business_id);

    return apiKey;
  }

  private assertBusinessAccess(user: AuthUser, businessId: string): void {
    if (user.role === 'business' && user.businessId !== businessId) {
      throw new NotFoundException('API key not found');
    }
  }

  private toApiKeySummary(apiKey: ApiKey) {
    return {
      id: apiKey.id,
      business_id: apiKey.business_id,
      name: apiKey.name,
      key_prefix: apiKey.key_prefix,
      is_active: apiKey.is_active,
      last_used_at: apiKey.last_used_at,
      deleted_at: apiKey.deleted_at,
      created_at: apiKey.created_at,
      updated_at: apiKey.updated_at,
    };
  }
}
