# Plan: Dashboard Module (Usage Analytics & Chart APIs)

**Generated**: 2026-10-20
**Estimated Complexity**: High
**Target Project**: `apay-backend` (NestJS 12, TypeORM, PostgreSQL schema `apay`)

---

## Overview

สร้าง `DashboardModule` สำหรับให้ Frontend เรียกข้อมูลไป plot กราฟและ KPI Card เกี่ยวกับการใช้งานระบบ โดยแยกเป็น 2 ระดับ:

1. **Business Dashboard** — Business ดูข้อมูลของตัวเอง (หรือ Admin ระบุ `business_id`)
   - Quota / Package usage
   - QR Created / QR Paid / Success Rate / GMV
   - การใช้งานแยกตาม API Key
   - Rate Limit ต่อชั่วโมง
   - Webhook ที่ match กับออเดอร์ของร้าน
   - Quota burn-down รายวัน + ประวัติรอบบิล
2. **Admin Dashboard** — Admin ดูภาพรวมทั้ง Platform
   - จำนวน Business / Subscription แยกสถานะ
   - Package distribution
   - Platform GMV / QR Created / Paid
   - Top businesses
   - ตาราง Business พร้อม Usage / Quota / Subscription
   - Business ที่ใกล้หมดอายุหรือใกล้หมดโควต้า
   - Estimated MRR / ARR (ประมาณจากราคาแพ็กเกจปัจจุบัน)

Dashboard Module นี้เป็น **Read-only Analytics API** ไม่มีตารางใหม่ ไม่มี write flow และไม่แตะ Business Logic เดิม ยกเว้นการเพิ่ม Index เพื่อรองรับ query ของ Dashboard

---

## Assumptions & Scope

- Backend คืนข้อมูลเป็น JSON ที่พร้อมนำไป plot (series + summary + breakdown) — ไม่ทำงาน Frontend/Chart Library
- Timezone หลักคือ `Asia/Bangkok` (`UTC+7`) ทุก bucket ต้องตรงกับเวลาไทย
- Default range = 30 วันล่าสุด, สูงสุด 365 วัน
- `interval` รองรับ `hour` และ `day`
  - `hour` ใช้ได้เฉพาะ range ≤ 31 วัน
- Endpoint ทั้งหมดถูกห่อด้วย `ResponseInterceptor` อัตโนมัติ (ห้ามห่อ `{ ok, data }` เอง)
- Business role เข้าถึงได้เฉพาะ `businessId` ของตัวเอง
- Admin เข้าถึงได้ทุก Business และมี Endpoint สำหรับ Platform-wide
- Metrics ทั้งหมดคำนวณจากตารางที่มีอยู่แล้ว:
  - `payment_orders`
  - `api_key_usage_logs`
  - `api_keys`
  - `business_subscriptions`
  - `subscription_periods`
  - `packages`
  - `businesses`
  - `webhook_logs`
- ไม่มี Dependency ใหม่ (ไม่ต้องติดตั้ง chart library ฝั่ง Backend)

## Non-Goals (ไม่อยู่ใน MVP นี้)

- กราฟ 429 / 403 / Throttling เนื่องจากยังไม่มี request log ของ request ที่ถูกปฏิเสธ
- Revenue จาก Invoice จริง / MRR แบบบัญชี — ยังไม่มีตาราง invoice
- Churn rate / Subscription status history — ยังไม่มี event log ของการเปลี่ยนสถานะ
- Callback latency / retry count — ยังไม่เก็บ latency
- Pre-aggregation / Materialized View / Redis cache (ดูในหัวข้อ Future Work)
- Frontend implementation

---

## Metric Definitions (ใช้ร่วมกันทุก Task)

> ทุกค่าต้องถูก cast เป็น `number` (PostgreSQL `SUM(numeric)` อาจคืนเป็น string)

| Metric | สูตร |
|---|---|
| `usage.qr_created` | `COUNT(api_key_usage_logs.action = 'QR_CREATED')` |
| `usage.qr_paid` | `COUNT(api_key_usage_logs.action = 'QR_PAID')` |
| `usage.quota_deducted` | `COUNT(api_key_usage_logs.action = 'QR_PAID' AND quota_deducted = true)` |
| `transactions.orders_created` | `COUNT(payment_orders.created_at in range)` |
| `transactions.paid_count` | `COUNT(payment_orders.status = 'PAID' AND paid_at in range)` |
| `transactions.expired_count` | `COUNT(payment_orders.created_at in range AND (status = 'EXPIRED' OR (status = 'UNVERIFIED' AND expires_at <= now)))` |
| `transactions.active_unverified_count` | `COUNT(status = 'UNVERIFIED' AND expires_at > now)` |
| `transactions.gmv` | `SUM(payment_orders.total_amount WHERE status = 'PAID' AND paid_at in range)` |
| `transactions.average_order_value` | `gmv / paid_count` (ถ้า `paid_count = 0` ให้ 0) |
| `transactions.paid_rate` | `paid_count / (paid_count + expired_count)` (ถ้า denominator = 0 ให้ 0) |
| `rate_limit.requests_last_hour` | `COUNT(api_key_usage_logs.action = 'QR_CREATED' AND created_at >= now - 1 hour)` |
| `rate_limit.utilization` | `requests_last_hour / rate_limit_per_hour` (clamp 0..1) |
| `webhook.matched` | `COUNT(webhook_logs.process_status = 'MATCHED')` |
| `webhook.no_match` | `COUNT(webhook_logs.process_status = 'NO_MATCH')` (Admin only — ดู Gotchas) |
| `webhook.match_rate` | `matched / (matched + no_match)` (ถ้า denominator = 0 ให้ 0) |
| `quota_utilization` | `quota_used / quota_limit` (ถ้า `quota_limit = 0` ให้ 0) |
| `estimated_mrr` | `SUM(packages.price WHERE business_subscriptions.status = 'ACTIVE')` |
| `estimated_arr` | `estimated_mrr * 12` |
| `days_until_period_end` | `ceil((current_period_end - now) / 86400000)` clamp ขั้นต่ำ 0 |

### Bucket rule

- Day bucket เริ่ม `00:00` เวลาไทย
- Hour bucket เริ่มต้นทุกต้นชั่วโมงเวลาไทย
- SQL ที่แนะนำ:

```sql
date_trunc(
  'day', -- หรือ 'hour'
  created_at AT TIME ZONE 'Asia/Bangkok'
) AT TIME ZONE 'Asia/Bangkok' AS bucket_start
```

- Range เป็นแบบ half-open `[from, to)` เพื่อไม่ให้นับ bucket สุดท้ายซ้ำ
- ต้อง **zero-fill** bucket ที่ไม่มีข้อมูลเสมอ เพื่อให้กราฟต่อเนื่อง
- Response ต้องมีทั้ง:
  - `bucket_start`: ISO string (UTC)
  - `label`: label เวลาไทย เช่น `20 Oct` หรือ `14:00`

---

## API Surface

### Business-scoped (Role `business` ใช้ของตัวเอง, `admin` ต้องส่ง `business_id`)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/v1/dashboard/overview` | KPI cards + subscription summary |
| `GET` | `/api/v1/dashboard/usage/timeseries` | QR Created / Paid / Quota Deducted ตามเวลา |
| `GET` | `/api/v1/dashboard/transactions/timeseries` | Orders / Paid / Expired / GMV / AOV |
| `GET` | `/api/v1/dashboard/rate-limit` | Usage 60 นาทีล่าสุด + series 24 ชั่วโมง |
| `GET` | `/api/v1/dashboard/api-keys` | Breakdown การใช้งานราย Key |
| `GET` | `/api/v1/dashboard/api-keys/timeseries` | Stacked series การใช้งานราย Key |
| `GET` | `/api/v1/dashboard/subscription` | Quota trend + ประวัติรอบบิล |

### Admin-only (Role `admin`)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/v1/dashboard/admin/overview` | Platform KPI |
| `GET` | `/api/v1/dashboard/admin/timeseries` | New businesses / Orders / Paid / GMV |
| `GET` | `/api/v1/dashboard/admin/distribution` | Package / Subscription status / Quota utilization |
| `GET` | `/api/v1/dashboard/admin/businesses` | ตาราง Business + filters + pagination |
| `GET` | `/api/v1/dashboard/admin/expiring` | ใกล้หมดอายุ / ใกล้หมดโควต้า |

---

## Prerequisites

- โมดูล `Packages`, `Subscriptions`, `ApiKeys`, `Payment`, `Webhook` ถูก implement แล้ว
- ทำตามกฎใน `AGENTS.md`:
  - ทุก Endpoint/Logic ใหม่ต้องมี Unit Test ใน `*.spec.ts`
  - ต้องอัปเดต `AGENTS.md` และ `api-docs.html` ในงานเดียวกัน
  - รัน `pnpm lint && pnpm test && pnpm build` ผ่านก่อนส่งงาน
- **ต้องแก้ Guard DI ที่มีอยู่ก่อน** (ดู Task 1.1) เพราะ `RoleGuard` inject `UsersService` แต่บาง Module ยังไม่ได้ import `UsersModule`

---

## Sprint 1: Foundation, Guard Wiring & Date Bucketing

**Goal**: เตรียม Module, DTO, Type, Utility และแก้ปัญหา Guard DI ให้ Endpoint ที่มี Guard ทำงานได้จริงตอน Runtime

**Demo/Validation**:
- `DashboardModule` ถูกโหลดใน `AppModule`
- Boot TestingModule ที่มี `DashboardController` + Guard แล้วไม่ error
- `pnpm build` ผ่าน

### Task 1.1: Fix Guard Dependency Injection across guarded modules

- **Location**:
  - `src/packages/packages.module.ts`
  - `src/subscriptions/subscriptions.module.ts`
  - `src/api-keys/api-keys.module.ts`
  - `src/dashboard/dashboard.module.ts` (จะสร้างใน Task 1.2)
- **Description**:
  - ปัจจุบัน Controller ใน Packages/Subscriptions/ApiKeys ใช้ `@UseGuards(JwtAuthGuard, RoleGuard)` แต่ Module ไม่ได้ import `UsersModule`
  - `RoleGuard` inject `UsersService` → Nest ไม่สามารถ resolve dependency ได้เมื่อ boot แอปจริง
  - เพิ่ม `UsersModule` เข้า `imports` ของทั้ง 3 Module (และ DashboardModule)
  - **ห้าม import `AuthModule` เข้า `SubscriptionsModule`** เพราะจะเกิด circular dependency (`AuthModule` import `SubscriptionsModule` อยู่แล้ว)
  - `JwtStrategy` ยังคง register ผ่าน `AuthModule` ที่ `AppModule` import อยู่แล้ว
- **Dependencies**: None
- **Acceptance Criteria**:
  - ทั้ง 4 Module import `UsersModule`
  - ไม่มี circular dependency
  - Controller ที่มี Guard สามารถ boot ได้ใน TestingModule
- **Validation**:
  - `pnpm build`
  - เพิ่ม `src/dashboard/dashboard.module.spec.ts` ที่ boot Controller พร้อม mock `UsersService` และ mock `DashboardService` (Task 5.1) เพื่อยืนยันว่า Guard resolve ได้

### Task 1.2: Create DashboardModule and register in AppModule

- **Location**:
  - `src/dashboard/dashboard.module.ts`
  - `src/app.module.ts`
- **Description**:
  - สร้าง `DashboardModule`
  - `TypeOrmModule.forFeature([...])` สำหรับ:
    - `PaymentOrder`
    - `ApiKeyUsageLog`
    - `ApiKey`
    - `BusinessSubscription`
    - `SubscriptionPeriod`
    - `Package`
    - `Business`
    - `WebhookLog`
  - import `UsersModule` (Guard) และ `SubscriptionsModule` (ใช้ `SubscriptionsService.getCurrentSubscription`)
  - ลงทะเบียน `DashboardController`, `DashboardService`
  - เพิ่ม `DashboardModule` ใน `imports` ของ `AppModule`
- **Dependencies**: Task 1.1
- **Acceptance Criteria**:
  - Module โหลดได้โดยไม่ชนกับ Module อื่น
  - ไม่มี circular dependency
- **Validation**: `pnpm build`

### Task 1.3: Create shared Dashboard types

- **Location**: `src/dashboard/types/dashboard.types.ts`
- **Description**:
  - ประกาศ Type/Interface กลาง:

```ts
export type DashboardInterval = 'hour' | 'day';

export interface DashboardRange {
  from: string; // ISO
  to: string;   // ISO
  interval: DashboardInterval;
  timezone: 'Asia/Bangkok';
}

export interface DashboardSeriesPoint {
  bucket_start: string;
  label: string;
  value: number;
}

export interface DashboardSeries {
  key: string;
  label: string;
  points: DashboardSeriesPoint[];
}

export interface DashboardPagination {
  page: number;
  limit: number;
  total: number;
  total_pages: number;
}
```

  - เพิ่ม Type สำหรับ response ของแต่ละ Endpoint (Overview, Usage, Transactions, RateLimit, ApiKeyBreakdown, SubscriptionTrend, AdminOverview, AdminTimeseries, AdminDistribution, AdminBusinessList, AdminExpiring)
- **Dependencies**: Task 1.2
- **Acceptance Criteria**:
  - Type ใช้ร่วมกันใน Service/Controller/Tests
  - ไม่ใช้ `any` ใน response หลัก
- **Validation**: `pnpm build`

### Task 1.4: Create Dashboard DTOs

- **Location**:
  - `src/dashboard/dto/dashboard-range-query.dto.ts`
  - `src/dashboard/dto/dashboard-usage-query.dto.ts`
  - `src/dashboard/dto/dashboard-api-keys-query.dto.ts`
  - `src/dashboard/dto/admin-businesses-query.dto.ts`
  - `src/dashboard/dto/dashboard-expiring-query.dto.ts`
- **Description**:
  - `DashboardRangeQueryDto`:
    - `from?: string` → `@IsOptional() @IsISO8601()`
    - `to?: string` → `@IsOptional() @IsISO8601()`
    - `interval?: 'hour' | 'day'` → `@IsOptional() @IsIn(['hour','day'])`
    - `business_id?: string` → `@IsOptional() @IsUUID()`
  - `DashboardUsageQueryDto extends DashboardRangeQueryDto`:
    - `metric?: 'qr_created' | 'qr_paid' | 'quota_deducted'` default `qr_created`
    - `api_key_id?: string` → `@IsOptional() @IsUUID()`
  - `DashboardApiKeysQueryDto extends DashboardRangeQueryDto`:
    - `include_deleted?: boolean` default `true` (ใช้ `@Transform` หรือ parse string)
  - `AdminBusinessesQueryDto extends DashboardRangeQueryDto`:
    - `search?: string` (`@MaxLength(150)`)
    - `package_id?: string` (`@IsUUID`)
    - `status?: 'ACTIVE' | 'PAST_DUE' | 'CANCELLED'`
    - `sort_by?: 'gmv' | 'qr_created' | 'qr_paid' | 'quota_used' | 'current_period_end' | 'created_at'`
    - `sort_order?: 'asc' | 'desc'` default `desc`
    - `page?: number` default `1`, `@Min(1)`
    - `limit?: number` default `20`, `@Min(1) @Max(100)`
  - `DashboardExpiringQueryDto`:
    - `days?: number` default `7`, `@Min(1) @Max(90)`
    - `quota_threshold?: number` default `0.8`, `@Min(0) @Max(1)`
- **Dependencies**: Task 1.3
- **Acceptance Criteria**:
  - Validation ทำงานผ่าน Global `ValidationPipe`
  - ค่า default ถูก resolve ใน Service (ไม่พึ่งพิงแค่ DTO)
- **Validation**: `pnpm build`

### Task 1.5: Implement Bangkok bucket utilities

- **Location**:
  - `src/dashboard/utils/dashboard-bucket.util.ts`
  - `src/dashboard/utils/dashboard-bucket.util.spec.ts`
- **Description**:
  - ฟังก์ชันที่ต้องมี:

```ts
export function resolveDashboardRange(
  from?: string,
  to?: string,
  interval: DashboardInterval = 'day',
  now: Date = new Date(),
): { from: Date; to: Date; interval: DashboardInterval };

export function generateBuckets(
  from: Date,
  to: Date,
  interval: DashboardInterval,
): Date[];

export function formatBucketLabel(
  bucket: Date,
  interval: DashboardInterval,
): string;
```

  - `resolveDashboardRange`:
    - default `to = now`, `from = now - 30 days`
    - throw `BadRequestException` ถ้า `from > to`
    - throw ถ้า range > 365 วัน
    - throw ถ้า `interval = 'hour'` และ range > 31 วัน
    - throw ถ้า generate แล้วเกิน 744 buckets
  - `generateBuckets`:
    - Day → เริ่ม `00:00` เวลาไทยของวันแรก, เพิ่มทีละ 24 ชั่วโมง
    - Hour → เริ่มต้นชั่วโมงเวลาไทย, เพิ่มทีละ 1 ชั่วโมง
    - คืนเฉพาะ bucket ที่ `< to` (half-open)
  - `formatBucketLabel`:
    - Day → `20 Oct` (ใช้ `Intl.DateTimeFormat` timeZone `Asia/Bangkok`, `en-GB`)
    - Hour → `14:00`
- **Dependencies**: Task 1.3
- **Acceptance Criteria**:
  - ไม่มี bucket ซ้ำ/ข้าม
  - ขอบเขตเที่ยงคืนเวลาไทยถูกต้อง
  - ไม่มี DST issue (Asia/Bangkok ไม่มี DST แต่ต้องใช้ timezone ชัดเจน)
- **Validation**: Unit Test ครอบคลุม:
  - default range
  - `from > to` → 400
  - range เกิน 365 วัน → 400
  - hour interval เกิน 31 วัน → 400
  - day/hour bucket counts
  - label format
  - ขอบเขตเวลาไทย เช่น `2026-10-19T17:00:00.000Z` = `2026-10-20 00:00` เวลาไทย

### Task 1.6: Implement scope & range resolver in DashboardService

- **Location**: `src/dashboard/dashboard.service.ts`
- **Description**:
  - `private resolveBusinessId(user: AuthUser, businessId?: string): string`
    - `business`: ต้องมี `user.businessId`; ถ้า query `business_id` ถูกส่งมาและไม่ตรง → `NotFoundException('Business not found')`
    - `admin`: ต้องส่ง `business_id` (ไม่งั้น `BadRequestException('business_id is required for admin')`)
  - `private async getBusinessOrFail(businessId: string): Promise<Business>` → 404 ถ้าไม่พบ
  - `private async getCurrentSubscriptionOrFail(businessId: string): Promise<BusinessSubscription>` → ใช้ `SubscriptionsService.getCurrentSubscription()`; ถ้าไม่มี → `NotFoundException('Subscription not found')`
    - Endpoint ที่ไม่ต้องการ subscription (เช่น transactions) ไม่ต้อง throw
  - ใช้ `resolveDashboardRange` จาก Task 1.5
- **Dependencies**: Task 1.2, 1.5
- **Acceptance Criteria**:
  - Business role ไม่สามารถอ่านข้อมูลร้านอื่นได้
  - Admin ต้องระบุ `business_id` สำหรับ business-scoped endpoints
- **Validation**: Unit Test ใน `dashboard.service.spec.ts` (Task 5.1)

### Task 1.7: Add indexes for dashboard aggregation

- **Location**:
  - `src/payment/entities/payment-order.entity.ts`
  - `src/webhook/entities/webhook-log.entity.ts`
  - `src/business/entities/business.entity.ts`
  - `src/subscriptions/entities/subscription-period.entity.ts`
- **Description**:
  - `PaymentOrder` เพิ่ม:
    - `@Index('idx_payment_orders_business_created', ['business_id', 'created_at'])`
    - `@Index('idx_payment_orders_business_paid', ['business_id', 'paid_at'])`
  - `WebhookLog` เพิ่ม:
    - `@Index('idx_webhook_logs_created', ['created_at'])`
    - `@Index('idx_webhook_logs_status_created', ['process_status', 'created_at'])`
  - `Business` เพิ่ม:
    - `@Index('idx_businesses_created', ['created_at'])`
  - `SubscriptionPeriod` เพิ่ม:
    - `@Index('idx_subscription_periods_business', ['business_id', 'created_at'])`
  - ไม่มีตารางใหม่ → ไม่ต้องแก้ `TABLES` ใน `DatabaseSecurityService`
  - TypeORM `synchronize` ใน `ENV=development` จะสร้าง index ให้เอง
- **Dependencies**: None
- **Acceptance Criteria**:
  - Index ถูกสร้างเมื่อ synchronize
  - Query Dashboard ใช้ index ที่เกี่ยวข้อง
- **Validation**: `pnpm build` + ตรวจ schema ใน development

---

## Sprint 2: Business Analytics Endpoints

**Goal**: ให้ Business/Admin เรียกข้อมูล KPI, Usage, Transaction และ Rate Limit เพื่อ plot กราฟพื้นฐาน

**Demo/Validation**:
- `GET /api/v1/dashboard/overview?from=...&to=...` คืน KPI ครบ
- `GET /api/v1/dashboard/usage/timeseries?metric=qr_created&interval=day` คืน series ที่ zero-fill
- Business role เรียกข้อมูลร้านอื่นไม่ได้

### Task 2.1: Implement `getOverview(user, query)`

- **Location**: `src/dashboard/dashboard.service.ts`
- **Description**:
  - คืน Response:

```json
{
  "range": { "from": "...", "to": "...", "interval": "day", "timezone": "Asia/Bangkok" },
  "business": { "id": "...", "name": "Coffee Shop" },
  "subscription": {
    "id": "...",
    "package_id": "...",
    "package_code": "STARTER",
    "package_name": "Starter",
    "status": "ACTIVE",
    "quota_limit": 1000,
    "quota_used": 120,
    "quota_remaining": 880,
    "rate_limit_per_hour": 300,
    "max_api_keys": 3,
    "current_period_start": "...",
    "current_period_end": "...",
    "last_payment_at": "...",
    "days_until_period_end": 20
  },
  "usage": {
    "qr_created": 100,
    "qr_paid": 80,
    "quota_deducted": 80,
    "paid_rate": 0.8
  },
  "transactions": {
    "orders_created": 120,
    "paid_count": 80,
    "expired_count": 30,
    "active_unverified_count": 10,
    "gmv": 12345.67,
    "average_order_value": 154.32,
    "paid_rate": 0.72
  },
  "api_keys": { "used": 2, "active": 2, "max": 3 },
  "rate_limit": {
    "requests_last_hour": 12,
    "limit": 300,
    "remaining": 288,
    "utilization": 0.04
  },
  "webhook": { "matched": 75 }
}
```

  - `webhook.no_match` / `match_rate` **ไม่คืนสำหรับ business-scoped** เพราะไม่สามารถระบุเจ้าของ NO_MATCH ได้ (ดู Gotchas)
  - ดึงข้อมูล:
    - subscription + package ผ่าน `SubscriptionsService.getCurrentSubscription()` และ repository ของ `Package`
    - usage จาก `api_key_usage_logs`
    - transactions จาก `payment_orders`
    - api keys จาก `api_keys`
    - rate limit จาก usage log 60 นาทีล่าสุด
    - webhook matched จาก `webhook_logs` join `payment_orders` ผ่าน `matched_order_id`
  - ถ้าไม่มี subscription ให้ `subscription = null` และ quota-related เป็น `0` (ไม่ throw) เพื่อให้ Dashboard ยังแสดงกราฟ transactions ได้
- **Dependencies**: Task 1.6
- **Acceptance Criteria**:
  - ตัวเลขทุกตัวเป็น number
  - `paid_rate` ไม่เป็น NaN/Infinity
  - Business role ถูก scope อัตโนมัติ
- **Validation**: Unit Test ด้วย mock repositories

### Task 2.2: Implement `getUsageTimeseries(user, query)`

- **Location**: `src/dashboard/dashboard.service.ts`
- **Description**:
  - Query `api_key_usage_logs` ตาม `business_id`, `created_at in [from, to)`
  - Metrics:
    - `qr_created` → action `QR_CREATED`
    - `qr_paid` → action `QR_PAID`
    - `quota_deducted` → action `QR_PAID` AND `quota_deducted = true`
  - Group by bucket
  - Zero-fill bucket ด้วย `generateBuckets`
  - Response:

```json
{
  "range": { "...": "..." },
  "series": [
    {
      "key": "qr_created",
      "label": "QR Created",
      "points": [
        { "bucket_start": "2026-10-01T00:00:00.000Z", "label": "01 Oct", "value": 12 }
      ]
    }
  ]
}
```

- **Dependencies**: Task 1.5, 1.6
- **Acceptance Criteria**:
  - bucket ที่ไม่มีข้อมูลได้ `value: 0`
  - `api_key_id` filter ทำงาน
  - ไม่รวมข้อมูลข้าม business
- **Validation**: Unit Test ตรวจ series length, zero-fill, filter

### Task 2.3: Implement `getTransactionsTimeseries(user, query)`

- **Location**: `src/dashboard/dashboard.service.ts`
- **Description**:
  - Query `payment_orders` ตาม business และ range
  - คืน series หลายชุดใน Response เดียว:
    - `orders_created`
    - `paid_count`
    - `expired_count`
    - `gmv`
    - `average_order_value`
  - คืน `status_breakdown`:
    - `PAID`
    - `UNVERIFIED` (แยก active vs expired ตาม `expires_at`)
    - `EXPIRED`
  - ใช้ `created_at` สำหรับ orders/expired
  - ใช้ `paid_at` สำหรับ paid/GMV
  - GMV ต้องเป็น number (cast จาก numeric)
- **Dependencies**: Task 2.1
- **Acceptance Criteria**:
  - Order ที่ `UNVERIFIED` แต่ `expires_at <= now` ถูกนับเป็น expired
  - `average_order_value = 0` เมื่อไม่มี paid order
  - GMV ไม่รวม order ที่ไม่ใช่ PAID
- **Validation**: Unit Test ด้วย order ตัวอย่างครบทุกสถานะ

### Task 2.4: Implement `getRateLimitStatus(user, query)`

- **Location**: `src/dashboard/dashboard.service.ts`
- **Description**:
  - Query params: `hours?: number` default `24`, `@Min(1) @Max(168)` (เพิ่มใน DTO หรือใช้ `DashboardRangeQueryDto` + query แยก)
  - คืน:
    - `requests_last_hour` (sliding 60 นาที)
    - `limit_per_hour` จาก subscription
    - `remaining = max(0, limit - requests_last_hour)`
    - `utilization = requests_last_hour / limit` (clamp 0..1)
    - `series` รายชั่วโมงของ `QR_CREATED` ย้อนหลัง `hours`
  - ถ้าไม่มี subscription ให้ `limit_per_hour = 0`, `utilization = 0`
- **Dependencies**: Task 2.1
- **Acceptance Criteria**:
  - ใช้ sliding window 60 นาทีเหมือน `SubscriptionsService.assertQuotaAndRateLimit`
  - ไม่มี division by zero
- **Validation**: Unit Test ด้วย fake timers

### Task 2.5: Create DashboardController business routes

- **Location**: `src/dashboard/dashboard.controller.ts`
- **Description**:
  - `@Controller({ path: 'dashboard', version: '1' })`
  - `@UseGuards(JwtAuthGuard, RoleGuard)` ระดับ Class
  - Routes:
    - `@Get('overview') @Roles('admin','business')`
    - `@Get('usage/timeseries') @Roles('admin','business')`
    - `@Get('transactions/timeseries') @Roles('admin','business')`
    - `@Get('rate-limit') @Roles('admin','business')`
  - ใช้ `@Req() request: Request & { user: AuthUser }`
  - ไม่ต้อง wrap response เอง
- **Dependencies**: Task 2.1–2.4
- **Acceptance Criteria**:
  - Route ตรงตาม API Surface
  - Guard ทำงาน
- **Validation**:
  - `pnpm build`
  - `src/dashboard/dashboard.module.spec.ts` boot controller ได้

---

## Sprint 3: API Key & Subscription Analytics

**Goal**: เพิ่มกราฟราย API Key และ Quota burn-down สำหรับ Business

**Demo/Validation**:
- Breakdown ราย Key แสดง QR Created / Paid / Share
- Stacked timeseries แยกตาม Key
- Quota trend รายวัน + ประวัติรอบบิล

### Task 3.1: Implement `getApiKeyBreakdown(user, query)`

- **Location**: `src/dashboard/dashboard.service.ts`
- **Description**:
  - Query `api_keys` ของ business (default `withDeleted: true`)
  - Aggregate `api_key_usage_logs` ตาม `api_key_id`:
    - `qr_created`
    - `qr_paid`
    - `quota_deducted`
  - คืน:

```json
{
  "range": { "...": "..." },
  "summary": {
    "total_keys": 3,
    "active_keys": 2,
    "revoked_keys": 1,
    "max_api_keys": 3
  },
  "keys": [
    {
      "id": "...",
      "name": "POS Terminal",
      "key_prefix": "apay_live_1a2b3c4d",
      "is_active": true,
      "deleted_at": null,
      "created_at": "...",
      "last_used_at": "...",
      "qr_created": 40,
      "qr_paid": 38,
      "quota_deducted": 38,
      "share_of_created": 0.8,
      "share_of_paid": 0.76
    }
  ]
}
```

  - `share_of_*` = ค่าของ key / ผลรวมทุก key (ถ้าผลรวม = 0 ให้ 0)
- **Dependencies**: Task 1.6
- **Acceptance Criteria**:
  - Key ที่ถูก Soft Delete ยังแสดงใน breakdown
  - Key ที่ไม่มี usage ได้ค่า 0
  - ไม่คืน `key_hash` / `refresh_token_hash`
- **Validation**: Unit Test ตรวจ share, deleted key, empty usage

### Task 3.2: Implement `getApiKeyTimeseries(user, query)`

- **Location**: `src/dashboard/dashboard.service.ts`
- **Description**:
  - Query usage logs group by `api_key_id` + bucket
  - คืน series ต่อ Key (stacked bar):
    - `key`: `api_key:<id>`
    - `label`: `name (prefix)` หรือ `Deleted: name` ถ้า soft-delete
    - `points`: zero-filled
  - จำกัด top 10 keys ตามยอดรวมใน range และรวมที่เหลือเป็น series `other`
  - รองรับ `api_key_id` filter
- **Dependencies**: Task 3.1
- **Acceptance Criteria**:
  - จำนวน series ≤ 11 (top 10 + other)
  - ทุก series มีจุดครบทุก bucket
- **Validation**: Unit Test ตรวจ top 10 + other

### Task 3.3: Implement `getSubscriptionTrend(user, query)`

- **Location**: `src/dashboard/dashboard.service.ts`
- **Description**:
  - ใช้ subscription ปัจจุบัน + `subscription_periods`
  - คืน:
    - `current`: subscription summary
    - `quota.daily`: ข้อมูลรายวันตั้งแต่ `current_period_start` ถึง `min(now, current_period_end)`
      - `bucket_start`, `label`, `quota_deducted`, `cumulative_used`, `quota_remaining`
      - `quota_remaining = max(0, quota_limit - cumulative_used)`
    - `periods`: ประวัติรอบบิล `subscription_periods` เรียงใหม่ → เก่า พร้อม `utilization = quota_used / quota_limit`
  - ถ้าไม่มี subscription → `current: null`, `quota.daily: []`, `periods: []`
- **Dependencies**: Task 1.6
- **Acceptance Criteria**:
  - Cumulative ใช้เฉพาะ `QR_PAID` + `quota_deducted = true`
  - ไม่ติดลบ
- **Validation**: Unit Test ด้วย fake timers และ period ที่มี/ไม่มี usage

### Task 3.4: Add controller routes for API Keys & Subscription

- **Location**: `src/dashboard/dashboard.controller.ts`
- **Description**:
  - เพิ่ม:
    - `@Get('api-keys')`
    - `@Get('api-keys/timeseries')`
    - `@Get('subscription')`
  - `@Roles('admin','business')`
- **Dependencies**: Task 3.1–3.3
- **Acceptance Criteria**: Route ตรงตาม API Surface
- **Validation**: `pnpm build`

---

## Sprint 4: Admin Platform Analytics

**Goal**: ให้ Admin ดูภาพรวมทั้ง Platform และตาราง Business ที่พร้อมใช้งาน

**Demo/Validation**:
- Admin overview คืนจำนวน Business / Subscription / GMV / Estimated MRR
- ตาราง Business กรอง/เรียง/แบ่งหน้าได้
- Distribution และ Expiring ใช้งานได้

### Task 4.1: Implement `getAdminOverview(query)`

- **Location**: `src/dashboard/dashboard.service.ts`
- **Description**:
  - คืน:

```json
{
  "range": { "...": "..." },
  "businesses": {
    "total": 120,
    "active": 110,
    "new_in_range": 8
  },
  "subscriptions": {
    "active": 90,
    "past_due": 15,
    "cancelled": 5,
    "expiring_7d": 6,
    "expiring_30d": 20
  },
  "platform": {
    "orders_created": 2000,
    "paid_count": 1500,
    "expired_count": 300,
    "active_unverified_count": 200,
    "gmv": 250000.5,
    "average_order_value": 166.67,
    "paid_rate": 0.83,
    "qr_created": 1800,
    "qr_paid": 1450
  },
  "webhook": {
    "matched": 1450,
    "no_match": 120,
    "match_rate": 0.9235
  },
  "estimated_mrr": 89900,
  "estimated_arr": 1078800
}
```

  - `qr_created` / `qr_paid` ใน platform ใช้ `api_key_usage_logs` (API-key usage)
  - `orders_*` / `gmv` ใช้ `payment_orders`
  - `estimated_mrr` = sum `packages.price` ของ subscription `ACTIVE`
  - `webhook` ใช้ `webhook_logs` ทั้ง MATCHED และ NO_MATCH (Platform scope ทำได้)
- **Dependencies**: Task 1.6
- **Acceptance Criteria**:
  - ตัวเลขทั้งหมดเป็น number
  - ไม่รวม subscription ที่ soft-deleted
- **Validation**: Unit Test ด้วย mock repositories

### Task 4.2: Implement `getAdminTimeseries(query)`

- **Location**: `src/dashboard/dashboard.service.ts`
- **Description**:
  - คืน series เดียวกันกับ bucket:
    - `new_businesses` (`businesses.created_at`)
    - `orders_created` (`payment_orders.created_at`)
    - `paid_count` (`payment_orders.paid_at`)
    - `gmv` (`payment_orders.paid_at`)
    - `qr_created` (`api_key_usage_logs.action = 'QR_CREATED'`)
    - `qr_paid` (`api_key_usage_logs.action = 'QR_PAID'`)
  - Zero-fill ทุก series
- **Dependencies**: Task 4.1
- **Acceptance Criteria**:
  - series ทุกตัวมีจำนวนจุดเท่ากัน
  - ไม่มี bucket ขาด
- **Validation**: Unit Test ตรวจ series count + zero-fill

### Task 4.3: Implement `getAdminDistribution(query)`

- **Location**: `src/dashboard/dashboard.service.ts`
- **Description**:
  - คืน:
    - `packages`: [{ `package_id`, `code`, `name`, `price`, `business_count`, `active_count`, `past_due_count` }]
    - `subscription_status`: [{ `status`, `count` }]
    - `quota_utilization`: [{ `bucket`, `count` }] โดย bucket:
      - `0-25`
      - `26-50`
      - `51-75`
      - `76-100`
      - `100+`
  - `business_count` = จำนวน subscription ที่ไม่ soft-deleted ต่อ package
  - Quota utilization ใช้ subscription `ACTIVE` + `PAST_DUE`
  - คำนวณ percentage = `quota_used / quota_limit * 100`
- **Dependencies**: Task 4.1
- **Acceptance Criteria**:
  - Package ที่ไม่มี subscription ยังแสดง `business_count = 0`
  - ไม่มี division by zero
- **Validation**: Unit Test ด้วย package/subscription ตัวอย่าง

### Task 4.4: Implement `getAdminBusinesses(query)`

- **Location**: `src/dashboard/dashboard.service.ts`
- **Description**:
  - ใช้ `AdminBusinessesQueryDto`
  - Filters:
    - `search` → `businesses.business_name ILIKE %search%`
    - `package_id`
    - `status` (`business_subscriptions.status`)
  - Sort:
    - `gmv`, `qr_created`, `qr_paid`, `quota_used`, `current_period_end`, `created_at`
    - `sort_order` default `desc`
  - Pagination:
    - default `page=1`, `limit=20`, max 100
  - Response:

```json
{
  "range": { "...": "..." },
  "pagination": { "page": 1, "limit": 20, "total": 120, "total_pages": 6 },
  "items": [
    {
      "business_id": "...",
      "business_name": "Coffee Shop",
      "package_code": "STARTER",
      "package_name": "Starter",
      "subscription_status": "ACTIVE",
      "quota_limit": 1000,
      "quota_used": 120,
      "quota_remaining": 880,
      "current_period_end": "...",
      "last_payment_at": "...",
      "api_keys_used": 2,
      "api_keys_max": 3,
      "qr_created": 100,
      "qr_paid": 80,
      "gmv": 12345.67
    }
  ]
}
```

  - Business ที่ไม่มี subscription ต้องยังแสดงในตาราง (subscription fields เป็น `null`)
- **Dependencies**: Task 4.1, 4.2
- **Acceptance Criteria**:
  - Pagination ถูกต้อง
  - Sort by aggregate ทำงาน
  - Search case-insensitive
  - ไม่คืนข้อมูลเกิน `limit`
- **Validation**: Unit Test ด้วย query builder result / raw SQL mock

### Task 4.5: Implement `getAdminExpiring(query)`

- **Location**: `src/dashboard/dashboard.service.ts`
- **Description**:
  - Query `BusinessSubscription` สถานะ `ACTIVE` ที่ `current_period_end` อยู่ระหว่าง `now` ถึง `now + days`
  - คืน:
    - `expiring`: [{ `business_id`, `business_name`, `subscription_id`, `status`, `current_period_end`, `days_remaining`, `quota_remaining`, `quota_limit` }]
    - `near_quota`: subscription สถานะ `ACTIVE`/`PAST_DUE` ที่ `quota_used / quota_limit >= quota_threshold`
  - `days` default 7, max 90
  - `quota_threshold` default 0.8
- **Dependencies**: Task 4.1
- **Acceptance Criteria**:
  - เรียงตาม `current_period_end` / utilization มากไปน้อย
  - ไม่มี division by zero
- **Validation**: Unit Test

### Task 4.6: Add admin controller routes

- **Location**: `src/dashboard/dashboard.controller.ts`
- **Description**:
  - เพิ่ม:
    - `@Get('admin/overview') @Roles('admin')`
    - `@Get('admin/timeseries') @Roles('admin')`
    - `@Get('admin/distribution') @Roles('admin')`
    - `@Get('admin/businesses') @Roles('admin')`
    - `@Get('admin/expiring') @Roles('admin')`
  - Business role เรียก admin routes ต้องได้ `403`
- **Dependencies**: Task 4.1–4.5
- **Acceptance Criteria**: Route ตรงตาม API Surface
- **Validation**: `pnpm build`

---

## Sprint 5: Tests, Documentation & Final Verification

**Goal**: ครอบคลุม Unit Test, อัปเดตเอกสารบังคับ และตรวจคุณภาพทั้งโปรเจกต์

### Task 5.1: Comprehensive Unit Tests

- **Location**:
  - `src/dashboard/dashboard.service.spec.ts`
  - `src/dashboard/dashboard.module.spec.ts`
  - `src/dashboard/utils/dashboard-bucket.util.spec.ts`
- **Description**:
  - `dashboard-bucket.util.spec.ts`:
    - default range 30 วัน
    - from > to → `BadRequestException`
    - range > 365 วัน → `BadRequestException`
    - hour range > 31 วัน → `BadRequestException`
    - day/hour bucket count
    - zero-fill boundary
    - Bangkok midnight boundary
    - label format
  - `dashboard.service.spec.ts`:
    - Mock `Repository`, `DataSource`, `SubscriptionsService`
    - ใช้ `jest.useFakeTimers()` + `jest.setSystemTime()` สำหรับ metric ที่เกี่ยวกับ now/range
    - ครอบคลุม:
      - scope: business ต้องใช้ `user.businessId`, business อื่น → 404, admin ไม่ส่ง `business_id` → 400
      - `getOverview`: subscription null/active, quota numbers, webhook matched only
      - `getUsageTimeseries`: zero-fill, filter `api_key_id`
      - `getTransactionsTimeseries`: paid/expired/unverified, GMV, AOV, paid_rate
      - `getRateLimitStatus`: limit 0, utilization clamp
      - `getApiKeyBreakdown`: soft-deleted key, share denominator 0
      - `getApiKeyTimeseries`: top 10 + other
      - `getSubscriptionTrend`: cumulative quota + clamp
      - `getAdminOverview`: counts, MRR, match rate
      - `getAdminTimeseries`: series length เท่ากัน
      - `getAdminDistribution`: package/status/quota buckets
      - `getAdminBusinesses`: search/filter/sort/pagination
      - `getAdminExpiring`: days/threshold
    - หลีกเลี่ยง assert ค่า timestamp ที่ไม่ deterministic ให้ใช้ `expect.any(String)` หรือ fixed fake time
  - `dashboard.module.spec.ts`:
    - Boot TestingModule ที่มี `DashboardController`, mock `DashboardService`, mock `UsersService`
    - ยืนยันว่า Guard DI resolve ได้ (ไม่ต่อ DB)
- **Dependencies**: Sprint 1–4
- **Acceptance Criteria**:
  - Test ผ่านทั้งหมด
  - ไม่มี test ที่ต้องต่อ DB/HTTP/env จริง
- **Validation**: `pnpm test`

### Task 5.2: Update `AGENTS.md`

- **Location**: `AGENTS.md`
- **Description**:
  - เพิ่ม Section `7. Dashboard Analytics (`src/dashboard/`)`
  - อธิบาย:
    - Endpoint ทั้งหมดและ Scope (`business` vs `admin`)
    - Metric definitions หลัก
    - Timezone `Asia/Bangkok` และ bucket rule
    - Default range 30 วัน, max 365 วัน, hour interval max 31 วัน
    - Index ที่เพิ่มเพื่อรองรับ Dashboard
    - ข้อจำกัด:
      - `webhook_logs` ไม่มี `business_id` → NO_MATCH ไม่สามารถ scope ต่อ Business ได้
      - ยังไม่มี request log ของ 429/403
      - MRR เป็น Estimated MRR จากราคาแพ็กเกจปัจจุบัน ไม่ใช่ invoice จริง
      - Quota history ของรอบปัจจุบัน derive จาก usage logs
  - อัปเดตกฎ Tests/Docs ตาม AGENTS.md เดิม
- **Dependencies**: Task 5.1
- **Acceptance Criteria**: เอกสารตรงกับ Endpoint/Schema ล่าสุด
- **Validation**: ตรวจด้วยตาเปล่า + `pnpm lint`

### Task 5.3: Update `api-docs.html`

- **Location**: `api-docs.html`
- **Description**:
  - เพิ่ม Tag `Dashboard`
  - เพิ่ม Paths ทั้ง 12 Endpoint:
    - `/api/v1/dashboard/overview`
    - `/api/v1/dashboard/usage/timeseries`
    - `/api/v1/dashboard/transactions/timeseries`
    - `/api/v1/dashboard/rate-limit`
    - `/api/v1/dashboard/api-keys`
    - `/api/v1/dashboard/api-keys/timeseries`
    - `/api/v1/dashboard/subscription`
    - `/api/v1/dashboard/admin/overview`
    - `/api/v1/dashboard/admin/timeseries`
    - `/api/v1/dashboard/admin/distribution`
    - `/api/v1/dashboard/admin/businesses`
    - `/api/v1/dashboard/admin/expiring`
  - เพิ่ม Schemas:
    - `DashboardRange`
    - `DashboardSeriesPoint`
    - `DashboardSeries`
    - `DashboardOverviewData`
    - `DashboardUsageTimeseriesData`
    - `DashboardTransactionsTimeseriesData`
    - `DashboardRateLimitData`
    - `DashboardApiKeyBreakdownData`
    - `DashboardApiKeyTimeseriesData`
    - `DashboardSubscriptionTrendData`
    - `AdminDashboardOverviewData`
    - `AdminDashboardTimeseriesData`
    - `AdminDashboardDistributionData`
    - `AdminBusinessListData`
    - `AdminExpiringData`
    - `DashboardPagination`
  - ระบุ `security: [{ BearerAuth: [] }]`, query params, 400/401/403/404 responses
  - ใช้ `successEnvelope` helper เดิมในไฟล์
- **Dependencies**: Task 5.2
- **Acceptance Criteria**:
  - JSON/JS spec valid
  - `$ref` ทุกตัว resolve ได้
  - เอกสารตรงกับ DTO/Response จริง
- **Validation**:
  - เปิด `api-docs.html` ตรวจ Swagger UI
  - รัน script ตรวจ syntax/`$ref` (ดู pattern เดิมที่ใช้ในโปรเจกต์)

### Task 5.4: Final Verification

- **Location**: ทั้งโปรเจกต์
- **Description**:
  - รัน:

```bash
pnpm lint
pnpm test
pnpm build
```

  - ตรวจว่าไม่มี TypeScript error, lint warning, หรือ test fail
  - ตรวจว่า `tsconfig.build.tsbuildinfo` ไม่ถูก commit โดยไม่ตั้งใจ
- **Dependencies**: Task 5.1–5.3
- **Acceptance Criteria**:
  - ทั้ง 3 คำสั่งผ่าน 100%
  - จำนวน Test suite เพิ่มขึ้นและผ่านทั้งหมด
- **Validation**: แสดงผลลัพธ์ให้ผู้ใช้เห็น

---

## Testing Strategy

- **Unit-first**: mock Repository/DataSource/SubscriptionsService ทั้งหมด
- **Time control**: ใช้ `jest.useFakeTimers()` + `jest.setSystemTime()` สำหรับ range, rate limit, expiry
- **SQL aggregation**: mock query builder chain หรือ mock `dataSource.query` ตามวิธีที่ implement
- **Boundary tests**: เที่ยงคืนเวลาไทย, ต้นชั่วโมง, สิ้นเดือน, leap year
- **Empty data**: ทุก Endpoint ต้องไม่ throw เมื่อไม่มีข้อมูล และคืน `0`/`[]`/`null` ตาม contract
- **Scope tests**: business ต้องไม่เห็นข้อมูลร้านอื่น, admin ต้องเข้าถึงได้
- **No DB/HTTP/env จริงใน unit test**

---

## Potential Risks & Gotchas

1. **Guard DI ยังพังอยู่ถ้าไม่ทำ Task 1.1**
   - `RoleGuard` inject `UsersService`; Module ที่ใช้ Guard ต้อง import `UsersModule`
   - ห้าม import `AuthModule` เข้า `SubscriptionsModule` เพราะจะเกิด circular dependency

2. **Timezone bucketing**
   - ห้ามใช้ `new Date().toISOString().slice(0,10)` ตรงๆ เพราะเป็น UTC
   - ต้องใช้ `AT TIME ZONE 'Asia/Bangkok'` ใน SQL และ `Intl.DateTimeFormat` ฝั่ง JS

3. **Lazy Expiry ของ PaymentOrder**
   - ระบบ mark `EXPIRED` แบบ lazy เฉพาะตอนสร้าง QR ใหม่
   - Dashboard ต้องถือว่า `status = 'UNVERIFIED' AND expires_at <= now` เป็น expired

4. **Webhook NO_MATCH ไม่มี business_id**
   - `webhook_logs` ไม่มี `business_id`
   - Business-scoped dashboard แสดงได้แค่ MATCHED ที่ join ผ่าน `matched_order_id`
   - NO_MATCH / match_rate ให้แสดงเฉพาะ Admin

5. **ไม่มี Invoice / Billing History**
   - MRR/ARR เป็น **Estimated** จากราคาแพ็กเกจปัจจุบัน
   - ห้ามLabel ว่าเป็นรายได้ที่เรียกเก็บจริง

6. **ไม่มี 429/403 Log**
   - ไม่สามารถทำกราฟ Throttling หรือ Error rate ของ Dashboard ได้ใน MVP

7. **Quota History**
   - `quota_remaining` ไม่ได้เก็บเป็นรายวัน
   - ต้อง derive จาก `QR_PAID` + `quota_deducted = true` ตั้งแต่ `current_period_start`

8. **Soft-deleted API Keys**
   - Breakdown ต้องใช้ `withDeleted: true`
   - Key ที่ถูกลบต้องไม่ถูกนับใน `active_keys` แต่ยังแสดง usage history

9. **Division by Zero**
   - `paid_rate`, `AOV`, `utilization`, `share_of_*`, `match_rate` ต้องกัน `0/0`
   - Return `0` ไม่ใช่ `NaN`/`Infinity`

10. **Performance**
    - Query raw logs ใน range 365 วันอาจช้า
    - ต้องมี Index ตาม Task 1.7
    - ถ้าข้อมูลโตมาก ให้ทำ rollup ตาม Future Work

11. **Half-open range**
    - ใช้ `[from, to)` เพื่อไม่นับ bucket สุดท้ายซ้ำ
    - ต้องทดสอบขอบเขต `23:59:59` และ `00:00:00`

12. **Numeric cast**
    - `SUM(total_amount)` จาก PostgreSQL อาจเป็น string
    - ต้อง `Number(...)` หรือใช้ `numericTransformer`

---

## Future Work (ไม่อยู่ใน Task นี้)

- เพิ่ม `request_logs` เพื่อเก็บ 429/403, endpoint, status code และ latency
- เพิ่ม `subscription_invoices` เพื่อทำ Revenue/MRR จากข้อมูลจริง
- เพิ่ม `subscription_events` เพื่อทำ Churn / PAST_DUE trend
- เพิ่ม callback latency/retry fields
- ทำ Daily Rollup Table หรือ Materialized View:
  - `dashboard_daily_business_stats`
  - `dashboard_daily_platform_stats`
- เพิ่ม Redis cache สำหรับ Dashboard ที่ถูกเรียกบ่อย
- Export CSV / Scheduled report

---

## Rollback Plan

1. ลบ `src/dashboard/` ทั้งโฟลเดอร์
2. ถอด `DashboardModule` ออกจาก `AppModule`
3. คืนค่า Index ที่เพิ่มใน Entity (ถ้าต้องการย้อน schema)
4. คืนค่า `imports` ของ `PackagesModule`, `SubscriptionsModule`, `ApiKeysModule` (เฉพาะ Guard DI fix)
5. Revert `AGENTS.md` และ `api-docs.html` ส่วน Dashboard
6. รัน `pnpm lint && pnpm test && pnpm build` อีกครั้ง
