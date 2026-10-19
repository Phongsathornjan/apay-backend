# Plan: API Key Management, Master Package & Business Subscription System

**Generated**: 2026-10-20
**Estimated Complexity**: High
**Target Project**: `apay-backend` (NestJS 12, TypeORM, PostgreSQL schema `apay`)

---

## Overview

พัฒนาระบบจัดการ **Master Package (`packages`)**, **Business Subscription (`business_subscriptions`, `subscription_periods`)**, และ **API Key Management & Usage Tracking (`api_keys`, `api_key_usage_logs`)** โดยรองรับเงื่อนไขทางธุรกิจดังนี้:

1. **1 Business → 1 Active Subscription (ผูกกับ 1 Master Package)**:
   - แพ็กเกจเป็นตัวกำหนด `max_api_keys` (จำนวน API Key สูงสุดที่สร้างได้), `quota_limit` (โควต้าต่อรอบเดือน), `rate_limit_per_hour` (จำกัดการสร้าง QR ต่อชั่วโมงรวมทั้ง Business), และ `billing_cycle_months` (ค่าเริ่มต้น `1` เดือน)
   - โควต้า (`quota_limit`, `quota_used`, `quota_remaining`) เป็น Pool เดียวระดับ Business ที่แชร์ร่วมกันทุก API Key ของร้านค้านั้น
   - **ไม่สามารถเติมโควต้าเพิ่ม (No Top-up)** มีเฉพาะการเปลี่ยน Package (ซึ่งจะรีเซ็ตโควต้าและเริ่มรอบบิลใหม่ทันที) หรือรอรีเซ็ตอัตโนมัติทุกเดือนตามวันครบรอบ (`current_period_end`) ของ Business นั้น
2. **รอบบิลแบบ Prepaid / Paid-through + การหมดอายุ (Lazy Expiry + Cron)**:
   - `current_period_end` คือ **"วันที่ชำระเงินล่วงหน้าถึง" (paid-through)** ไม่ใช่แค่วันรีเซ็ต — ระบบจะ **ไม่รีเซ็ตโควต้าให้เอง** เมื่อครบรอบ เพราะยังไม่มีการชำระเงินรอบใหม่
   - ตรวจสอบแบบ Lazy ทุกครั้งที่มีการใช้งาน (`expireIfPastDue`): ถ้า `status = 'ACTIVE'` และ `now >= current_period_end`
     - บันทึก Snapshot รอบที่จบลง `subscription_periods`
     - เปลี่ยน `status = 'PAST_DUE'` และ `quota_remaining = 0` (คง `quota_used` ไว้เพื่อรายงาน) → สร้าง QR ไม่ได้ทันที
     - **ไม่มี grace period** (ไม่มีการผ่อนผันหลังครบกำหนด)
   - การได้โควต้าใหม่ (reset) เกิดได้จาก 2 ทางเท่านั้น:
     - Admin ต่ออายุ (`POST /api/v1/subscriptions/:id/renew`) → สร้างรอบบิลใหม่ + `quota_used = 0`, `quota_remaining = quota_limit`
     - Admin เปลี่ยน Package (`POST /api/v1/subscriptions`) → เริ่มรอบบิลใหม่ + reset โควต้าตาม Package ใหม่
   - มี `@Cron(CronExpression.EVERY_HOUR)` จาก `@nestjs/schedule` คอยกวาด Subscription ที่ `current_period_end <= now` เพื่อเปลี่ยนเป็น `PAST_DUE` แม้ไม่มี Request เข้ามา (ทำหน้าที่ "ตัดสิทธิ์" ไม่ใช่ "รีเซ็ตโควต้า")
3. **1 Business มีได้หลาย API Key (สูงสุดไม่เกิน `max_api_keys` ของแพ็กเกจ)**:
   - ตอนเรียก `POST /api/v1/auth/register-business` จะสร้างเฉพาะ `User` และ `Business` (ยังไม่สร้าง API Key ในขั้นตอนนี้)
   - Admin หรือ Business สามารถสร้าง API Key ภายหลังได้ โดยระบบจะตรวจสอบว่า Business มี Subscription ที่ `status = 'ACTIVE'` และยังไม่เลยวันจ่ายถึง (`current_period_end`) และจำนวน Key ที่ยังไม่ถูกลบ (`deleted_at IS NULL`) ยังไม่เกิน `max_api_keys`
   - รองรับการเปิด/ปิด (`is_active: true/false`) และการลบแบบ Soft Delete (`deleted_at`) เพื่อเก็บประวัติการใช้งานย้อนหลัง
4. **การนับ Quota และ Rate Limit**:
   - **ตอนสร้าง QR (`POST /api/v1/payments/qr`)**: ตรวจสอบว่า Subscription ยัง `ACTIVE` และยังไม่เลย `current_period_end` (ถ้า `PAST_DUE` → `403`), `quota_remaining > 0` (ไม่พอ → `429`), และจำนวนการสร้าง QR (`action = 'QR_CREATED'`) ของ Business ในรอบ 60 นาทีล่าสุดยังไม่เกิน `rate_limit_per_hour` (เกิน → `429`) จากนั้นผูก `api_key_id` ลงใน `payment_orders` และบันทึก `api_key_usage_logs` (`action = 'QR_CREATED'`, `quota_deducted = false`)
   - **ตอนชำระเงินสำเร็จ (`POST /api/v1/webhooks/kbank/line`)**: เมื่อจับคู่รายการ `UNVERIFIED` และเปลี่ยนเป็น `PAID` สำเร็จ (ครบเงื่อนไข **สร้าง QR + จ่ายเงินสำเร็จ**) จึงหัก `quota_remaining` ลง 1, เพิ่ม `quota_used` ขึ้น 1 และบันทึก `api_key_usage_logs` (`action = 'QR_PAID'`, `quota_deducted = true`)
5. **Private Functions สำหรับจัดการโควต้าจาก Package (ไม่มีการ "เติมโควต้า")**:
   - `applyPackageToSubscription()` — Map ค่าจาก `Package` ลง `BusinessSubscription` และเริ่มรอบบิลใหม่ (reset โควต้า) ใช้ทั้งตอนผูก/เปลี่ยนแพ็กเกจ และตอนต่ออายุ
   - `expireIfPastDue()` — ตรวจจับวันจ่ายถึงแล้วยังไม่ชำระ → `PAST_DUE` + โควต้า 0 (ไม่รีเซ็ตให้ฟรี)
   - `renewSubscription()` — ต่ออายุรอบบิล (Private/Admin endpoint) รักษาวันหมดอายุเดิมเมื่อต่ออายุก่อนกำหนด

---

## Prerequisites & Project Conventions (สำคัญมากสำหรับ AI Agent)

- **Schema Rule**: ทุก Entity ต้องกำหนด `@Entity({ schema: DB_SCHEMA, name: '<table_name>' })` โดย import `DB_SCHEMA` จาก `src/database/database.schema.ts`
- **Database Security Rule**: ทุกตารางใหม่ **ต้อง** นำชื่อไปเพิ่มในตัวแปร `TABLES` ในไฟล์ `src/database/database-security.service.ts` เพื่อให้เปิด Row Level Security (RLS) และถอนสิทธิ์ `anon`/`authenticated` อัตโนมัติตอน Bootstrap
- **Numeric Transformer**: คอลัมน์ประเภท `numeric` (เช่น `price`) ต้องใช้ `transformer: numericTransformer` จาก `src/common/transformers/numeric.transformer.ts`
- **Response Envelope**: ห้ามห่อ `{ ok: true, data }` เองใน Controller เพราะมี `ResponseInterceptor` จัดการให้อัตโนมัติแล้ว
- **Mandatory Documentation Rule**: เมื่อแก้ไขโค้ดเสร็จ **ต้อง** อัปเดตทั้ง `AGENTS.md`, `api-docs.html` และเพิ่ม/อัปเดต Unit Test (`*.spec.ts`) ในงานเดียวกันเสมอ
- **Mandatory Testing Rule (จาก `AGENTS.md`)**:
  - ทุกการ implement/แก้ไขโค้ดใน `src/` ต้องมี unit test คู่กันในไฟล์ `*.spec.ts` ที่วางไว้ข้างไฟล์ที่ทดสอบ (colocated) และต้องรัน `pnpm test` ผ่านก่อนส่งงาน
  - Unit test ต้อง mock dependency ภายนอกเสมอ — **ห้าม** ต่อ DB จริง, เรียก HTTP จริง หรือพึ่ง env var จริง (งานที่ต้องใช้ของจริงให้เขียนเป็น e2e test)
  - ใช้ `Test.createTestingModule` จาก `@nestjs/testing`; mock เวลา (`jest.useFakeTimers()`) เมื่อ logic เกี่ยวกับเวลา/TTL; หลีกเลี่ยง assert ค่าที่ไม่ deterministic
  - Jest ของโปรเจกต์รันผ่าน `node --experimental-vm-modules node_modules/jest/bin/jest.js` เพราะ NestJS v12 เป็น ESM-only — **ห้ามถอด flag นี้ออกจาก script `pnpm test`**

---

## Sprint 1: Dependencies, Database Entities & Security Hardening

**Goal**: ติดตั้ง Dependency สำหรับ Cron, สร้าง Entity ใหม่ทั้งหมดใน Schema `apay`, ปรับปรุง Entity เดิม และลงทะเบียนตารางใน `DatabaseSecurityService`
**Demo/Validation**:
- รัน `pnpm build` และ `pnpm lint` ผ่านโดยไม่มี Error
- เมื่อรันแอปในโหมด `ENV=development` ตารางทั้งหมดถูกสร้างใน schema `apay` พร้อมเปิด RLS ครบทุกตาราง

### Task 1.1: Install `@nestjs/schedule` and Register `ScheduleModule`
- **Location**: `package.json`, `src/app.module.ts`
- **Description**:
  - ติดตั้ง `@nestjs/schedule` ด้วยคำสั่ง `pnpm add @nestjs/schedule`
  - นำเข้า `ScheduleModule.forRoot()` ใน `imports` ของ `src/app.module.ts`
- **Dependencies**: None
- **Acceptance Criteria**:
  - มี `@nestjs/schedule` ใน `package.json`
  - `AppModule` โหลด `ScheduleModule.forRoot()` สำเร็จ
- **Validation**: `pnpm build`

### Task 1.2: Create `Package` Entity (`packages`)
- **Location**: `src/packages/entities/package.entity.ts`
- **Description**:
  - สร้าง Entity `@Entity({ schema: DB_SCHEMA, name: 'packages' })`
  - คอลัมน์:
    - `id`: `@PrimaryGeneratedColumn('uuid')`
    - `code`: `@Column({ type: 'varchar', length: 50, unique: true })` (เช่น `'FREE'`, `'STARTER'`, `'PRO'`)
    - `name`: `@Column({ type: 'varchar', length: 150 })`
    - `description`: `@Column({ type: 'text', nullable: true })`
    - `price`: `@Column({ type: 'numeric', precision: 12, scale: 2, default: 0, transformer: numericTransformer })`
    - `max_api_keys`: `@Column({ type: 'int', name: 'max_api_keys', default: 1 })`
    - `quota_limit`: `@Column({ type: 'int', name: 'quota_limit' })`
    - `rate_limit_per_hour`: `@Column({ type: 'int', name: 'rate_limit_per_hour' })`
    - `billing_cycle_months`: `@Column({ type: 'int', name: 'billing_cycle_months', default: 1 })`
    - `is_active`: `@Column({ type: 'boolean', name: 'is_active', default: true })`
    - `deleted_at`: `@DeleteDateColumn({ type: 'timestamptz', name: 'deleted_at', nullable: true })`
    - `created_at`: `@CreateDateColumn({ type: 'timestamptz' })`
    - `updated_at`: `@UpdateDateColumn({ type: 'timestamptz' })`
- **Dependencies**: Task 1.1
- **Acceptance Criteria**:
  - ใช้ `DB_SCHEMA` และ `numericTransformer` ถูกต้อง
  - รองรับ Soft Delete ด้วย `@DeleteDateColumn`
- **Validation**: `pnpm build`

### Task 1.3: Create `BusinessSubscription` and `SubscriptionPeriod` Entities
- **Location**:
  - `src/subscriptions/entities/business-subscription.entity.ts`
  - `src/subscriptions/entities/subscription-period.entity.ts`
- **Description**:
  - สร้าง `BusinessSubscription` (`@Entity({ schema: DB_SCHEMA, name: 'business_subscriptions' })`):
    - `id`: `uuid` PK
    - `business_id`: `uuid` (`@Index('idx_business_subscriptions_business')`, FK -> `Business`, `onDelete: 'CASCADE'`)
    - `package_id`: `uuid` (FK -> `Package`)
    - `status`: `varchar(20)` (`'ACTIVE' | 'PAST_DUE' | 'CANCELLED'`, default `'ACTIVE'`) — `PAST_DUE` = ครบรอบบิลแล้วยังไม่ชำระเงิน (ไม่มี grace period)
    - `quota_limit`: `int`
    - `quota_used`: `int`, default `0`
    - `quota_remaining`: `int`
    - `rate_limit_per_hour`: `int`
    - `max_api_keys`: `int`
    - `current_period_start`: `timestamptz`
    - `current_period_end`: `timestamptz` (`@Index('idx_business_subscriptions_period_end')`)
    - `cancelled_at`: `timestamptz`, nullable
    - `last_payment_at`: `timestamptz`, nullable — เวลาที่ชำระเงิน/ต่ออายุล่าสุด (ใช้ Audit การจ่ายเงินแบบ Prepaid)
    - `deleted_at`: `@DeleteDateColumn({ type: 'timestamptz', nullable: true })`
    - `created_at`, `updated_at`: `timestamptz`
  - สร้าง `SubscriptionPeriod` (`@Entity({ schema: DB_SCHEMA, name: 'subscription_periods' })`) สำหรับเก็บ Snapshot ประวัติโควต้าแต่ละรอบเดือนก่อนถูกรีเซ็ต:
    - `id`: `uuid` PK
    - `subscription_id`: `uuid` (FK -> `BusinessSubscription`, `onDelete: 'CASCADE'`)
    - `business_id`: `uuid`
    - `package_id`: `uuid`
    - `period_start`: `timestamptz`
    - `period_end`: `timestamptz`
    - `quota_limit`: `int`
    - `quota_used`: `int`
    - `created_at`: `timestamptz`
- **Dependencies**: Task 1.2
- **Acceptance Criteria**:
  - มี Index สำหรับค้นหาตาม `business_id` และ `current_period_end`
- **Validation**: `pnpm build`

### Task 1.4: Create `ApiKey` and `ApiKeyUsageLog` Entities
- **Location**:
  - `src/api-keys/entities/api-key.entity.ts`
  - `src/api-keys/entities/api-key-usage-log.entity.ts`
- **Description**:
  - สร้าง `ApiKey` (`@Entity({ schema: DB_SCHEMA, name: 'api_keys' })`):
    - `id`: `uuid` PK
    - `business_id`: `uuid` (`@Index('idx_api_keys_business')`, FK -> `Business`, `onDelete: 'CASCADE'`)
    - `name`: `varchar(100)`
    - `key_prefix`: `varchar(24)`, unique (`apay_live_<8_hex>`)
    - `key_hash`: `varchar(128)`
    - `refresh_token_hash`: `varchar(128)`, nullable
    - `is_active`: `boolean`, default `true`
    - `last_used_at`: `timestamptz`, nullable
    - `deleted_at`: `@DeleteDateColumn({ type: 'timestamptz', name: 'deleted_at', nullable: true })`
    - `created_at`, `updated_at`: `timestamptz`
  - สร้าง `ApiKeyUsageLog` (`@Entity({ schema: DB_SCHEMA, name: 'api_key_usage_logs' })`):
    - Index: `@Index('idx_usage_logs_business_action_created', ['business_id', 'action', 'created_at'])`
    - Index: `@Index('idx_usage_logs_api_key_created', ['api_key_id', 'created_at'])`
    - `id`: `uuid` PK
    - `api_key_id`: `uuid` (FK -> `ApiKey`, `onDelete: 'CASCADE'`)
    - `business_id`: `uuid` (FK -> `Business`, `onDelete: 'CASCADE'`)
    - `payment_order_id`: `varchar(64)`, nullable
    - `action`: `varchar(30)` (`'QR_CREATED' | 'QR_PAID'`)
    - `quota_deducted`: `boolean`, default `false`
    - `created_at`: `@CreateDateColumn({ type: 'timestamptz' })`
- **Dependencies**: Task 1.2
- **Acceptance Criteria**:
  - รองรับ Soft Delete ที่ `ApiKey` และเก็บประวัติใน `ApiKeyUsageLog` ได้แม้ Key ถูก Soft Delete ไปแล้ว
- **Validation**: `pnpm build`

### Task 1.5: Update `Business`, `PaymentOrder`, and `DatabaseSecurityService`
- **Location**:
  - `src/business/entities/business.entity.ts`
  - `src/payment/entities/payment-order.entity.ts`
  - `src/database/database-security.service.ts`
- **Description**:
  - ใน `Business`:
    - ปรับ `api_key_prefix` และ `api_key_hash` ให้เป็น `nullable: true` (หรือถอดความต้องการบังคับค่าเมื่อสมัคร Business ใหม่) เพื่อป้องกันข้อมูลเดิมสูญหายทันทีและรองรับการสร้าง Business โดยยังไม่มี API Key
  - ใน `PaymentOrder`:
    - เพิ่มคอลัมน์ `api_key_id`: `@Column({ type: 'uuid', name: 'api_key_id', nullable: true })` และ Relation `@ManyToOne(() => ApiKey, { nullable: true, onDelete: 'SET NULL' }) @JoinColumn({ name: 'api_key_id' })`
  - ใน `src/database/database-security.service.ts`:
    - เพิ่ม `'packages'`, `'business_subscriptions'`, `'subscription_periods'`, `'api_keys'`, `'api_key_usage_logs'` ลงใน `TABLES`
- **Dependencies**: Task 1.2, Task 1.3, Task 1.4
- **Acceptance Criteria**:
  - `TABLES` ใน `DatabaseSecurityService` มีครบทั้ง 10 ตาราง
  - `PaymentOrder` สามารถเก็บ `api_key_id` ได้
- **Validation**: `pnpm build && pnpm lint`

---

## Sprint 2: Master Package Module & Default Package Seeding

**Goal**: สร้าง CRUD สำหรับจัดการ Master Package (`/api/v1/packages`) สำหรับ Admin และการดูรายการ Package รวมถึง Seed แพ็กเกจเริ่มต้น
**Demo/Validation**:
- Admin สามารถเพิ่ม แก้ไข ดู และลบ (Soft Delete) Master Package ได้
- หากลบ Package ที่มี Subscription `ACTIVE` หรือ `PAST_DUE` ผูกอยู่ ระบบต้องปฏิเสธด้วย `409 Conflict`

### Task 2.1: Create Package DTOs
- **Location**:
  - `src/packages/dto/create-package.dto.ts`
  - `src/packages/dto/update-package.dto.ts`
- **Description**:
  - `CreatePackageDto`:
    - `code`: `@IsString() @IsNotEmpty() @MaxLength(50)`
    - `name`: `@IsString() @IsNotEmpty() @MaxLength(150)`
    - `description`: `@IsOptional() @IsString()`
    - `price`: `@IsNumber() @Min(0)`
    - `max_api_keys`: `@IsInt() @Min(1)`
    - `quota_limit`: `@IsInt() @Min(1)`
    - `rate_limit_per_hour`: `@IsInt() @Min(1)`
    - `billing_cycle_months`: `@IsOptional() @IsInt() @Min(1)` (default `1`)
    - `is_active`: `@IsOptional() @IsBoolean()`
  - `UpdatePackageDto`: ฟิลด์ข้างต้นทั้งหมดแบบ `@IsOptional()`
- **Dependencies**: Task 1.2
- **Acceptance Criteria**:
  - มี `class-validator` decorators ครบถ้วน
- **Validation**: `pnpm build`

### Task 2.2: Implement `PackagesService` and `PackagesController`
- **Location**:
  - `src/packages/packages.service.ts`
  - `src/packages/packages.controller.ts`
  - `src/packages/packages.module.ts`
  - `src/app.module.ts`
- **Description**:
  - `PackagesService`:
    - `create(dto)`: ตรวจสอบ `code` ซ้ำ (ถ้าซ้ำโยน `409 ConflictException`), บันทึกลง `packages`
    - `findAll(onlyActive?: boolean)`: คืนรายการแพ็กเกจทั้งหมดที่ยังไม่ถูก Soft Delete
    - `findByIdOrFail(id: string)`: คืนแพ็กเกจ (ถ้าไม่พบโยน `404 NotFoundException`)
    - `findActiveByIdOrFail(id: string)`: คืนแพ็กเกจที่ `is_active = true` (ถ้าไม่พบหรือ inactive โยน `400/404`)
    - `update(id, dto)`: อัปเดตข้อมูลแพ็กเกจ
    - `softDelete(id)`: ตรวจสอบก่อนว่ามี `BusinessSubscription` ที่ `package_id = id` และ `status IN ('ACTIVE', 'PAST_DUE')` (ยังไม่ถูกยกเลิก) อยู่หรือไม่ ถ้ามีให้โยน `409 ConflictException('Cannot delete package with active or past-due subscriptions')` ถ้าไม่มีให้ตั้ง `is_active = false` และเรียก `softRemove`
  - `PackagesController` (`@Controller({ path: 'packages', version: '1' })`):
    - `POST /` (`@Roles('admin')`)
    - `GET /` (`@Roles('admin', 'business')` — ถ้าเป็น `business` ให้บังคับ `onlyActive = true`)
    - `GET /:id` (`@Roles('admin', 'business')`)
    - `PATCH /:id` (`@Roles('admin')`)
    - `DELETE /:id` (`@Roles('admin')`)
- **Dependencies**: Task 2.1, Task 1.3
- **Acceptance Criteria**:
  - ทุก Endpoint ป้องกันด้วย `@UseGuards(JwtAuthGuard, RoleGuard)`
- **Validation**: เขียน Unit Test `src/packages/packages.service.spec.ts` และรัน `pnpm test`

### Task 2.3: Seed Default Master Packages in `DatabaseSeederService`
- **Location**:
  - `src/database/database.module.ts`
  - `src/database/database-seeder.service.ts`
- **Description**:
  - เพิ่ม `Package` เข้า `TypeOrmModule.forFeature([User, Role, Package])` ใน `DatabaseModule`
  - เพิ่ม `seedDefaultPackages()` ใน `DatabaseSeederService` เพื่อสร้างแพ็กเกจเริ่มต้นหากยังไม่มีในระบบ เช่น:
    - `FREE`: `price: 0, max_api_keys: 1, quota_limit: 100, rate_limit_per_hour: 60, billing_cycle_months: 1`
    - `STARTER`: `price: 499, max_api_keys: 3, quota_limit: 1000, rate_limit_per_hour: 300, billing_cycle_months: 1`
    - `PRO`: `price: 1499, max_api_keys: 10, quota_limit: 5000, rate_limit_per_hour: 1200, billing_cycle_months: 1`
- **Dependencies**: Task 2.2
- **Acceptance Criteria**:
  - Seeder ทำงานแบบ idempotent (ถ้ามี `code` นั้นอยู่แล้วจะไม่สร้างซ้ำ)
- **Validation**: `pnpm build && pnpm test`

---

## Sprint 3: Business Subscription, Prepaid Billing Enforcement & Private Package Mapping

**Goal**: สร้างระบบผูก Package ให้ Business แบบ Prepaid, Private Function สำหรับ Map Package → Subscription, กลไก Lazy Expiry + Cron รายชั่วโมงเพื่อตัดสิทธิ์เมื่อยังไม่ชำระเงิน, การต่ออายุ (Renew) และการตัดโควต้า
**Demo/Validation**:
- ทดสอบคำนวณวันครบรอบเดือนถัดไป (`addMonthsClamped`) ได้ถูกต้องแม้เป็นวันสิ้นเดือน (เช่น 31 ม.ค. -> 28/29 ก.พ.)
- เมื่อเปลี่ยน Package โควต้าถูกรีเซ็ตตาม Package ใหม่ทันที (`quota_remaining = quota_limit` ใหม่)
- เมื่อถึง `current_period_end` แล้วไม่มีการต่ออายุ: Snapshot ลง `subscription_periods`, `status = 'PAST_DUE'`, `quota_remaining = 0` และสร้าง QR ไม่ได้ — **โควต้าไม่ถูกรีเซ็ตให้ฟรี**
- เมื่อ Admin ต่ออายุ (`renew`) โควต้าถูกรีเซ็ตใหม่และ `status = 'ACTIVE'`

### Task 3.1: Add Monthly Anniversary Date Helper in `datetime.util.ts`
- **Location**: `src/common/utils/datetime.util.ts`
- **Description**:
  - เพิ่มฟังก์ชัน `addMonthsClamped(date: Date, months: number): Date` ที่บวกจำนวนเดือนโดยรักษาวันและเวลาเดิม และหากเดือนปลายทางมีจำนวนวันน้อยกว่า (เช่น วันที่ 31 ไปเดือนกุมภาพันธ์) ให้ Clamp เป็นวันสุดท้ายของเดือนนั้นอย่างถูกต้อง
- **Dependencies**: None
- **Acceptance Criteria**:
  - `addMonthsClamped` คำนวณวันครบรอบรายเดือนได้แม่นยำไม่กระโดดข้ามเดือน
- **Validation**: เขียน Unit Test ทดสอบกรณีทั่วไปและกรณีวันสิ้นเดือน (28/29/30/31)

### Task 3.2: Implement `SubscriptionsService` (Prepaid Billing, Renewal & Quota Enforcement)
- **Location**:
  - `src/subscriptions/subscriptions.service.ts`
  - `src/subscriptions/dto/assign-subscription.dto.ts`
  - `src/subscriptions/dto/renew-subscription.dto.ts`
  - `src/subscriptions/subscriptions.controller.ts`
  - `src/subscriptions/subscriptions.module.ts`
- **Description**:
  - **Private Function 1** — `private applyPackageToSubscription(businessId: string, pkg: Package, manager: EntityManager, periodStart?: Date): Promise<BusinessSubscription>`:
    - ค้นหา Subscription เดิมของ `businessId` (`status IN ('ACTIVE', 'PAST_DUE')`, ไม่ถูกลบ)
    - หากมีอยู่และมี `quota_used > 0` ให้บันทึก Snapshot รอบเดิมลง `subscription_periods` ก่อนทับค่า
    - Map ค่าจาก `pkg` ลง Subscription (เริ่มรอบบิลใหม่):
      - `package_id = pkg.id`
      - `status = 'ACTIVE'`
      - `quota_limit = pkg.quota_limit`
      - `quota_used = 0`
      - `quota_remaining = pkg.quota_limit`
      - `rate_limit_per_hour = pkg.rate_limit_per_hour`
      - `max_api_keys = pkg.max_api_keys`
      - `current_period_start = periodStart ?? now`
      - `current_period_end = addMonthsClamped(current_period_start, pkg.billing_cycle_months)`
      - `last_payment_at = now`
    - **โควต้าจะรีเซ็ตเฉพาะเมื่อเรียกฟังก์ชันนี้ (ผูก/เปลี่ยน Package หรือต่ออายุ) เท่านั้น**
  - **Private Function 2** — `expireIfPastDue(subscription: BusinessSubscription, manager?: EntityManager): Promise<BusinessSubscription>` (Lazy Expiry):
    - ถ้า `subscription.status === 'ACTIVE'` และ `now >= subscription.current_period_end`:
      - บันทึก Snapshot รอบที่จบลง `subscription_periods` (`quota_limit`, `quota_used`, `period_start`, `period_end`)
      - เปลี่ยน `status = 'PAST_DUE'`
      - ตั้ง `quota_remaining = 0` (คง `quota_used` เดิมไว้เพื่อรายงาน)
      - **ไม่ต่ออายุ / ไม่รีเซ็ตโควต้า / ไม่มี grace period**
    - คืนค่า subscription หลังอัปเดต (ถ้ายังไม่ครบกำหนดให้คืนค่าเดิมโดยไม่แก้ไข)
  - **Private Function 3** — `assignOrChangePackage(businessId: string, packageId: string)`:
    - ตรวจสอบ Business ว่า active และ Package นั้น `is_active = true` และไม่ถูกลบ
    - เรียก `applyPackageToSubscription(businessId, pkg, manager)` ภายใน Transaction (เริ่มรอบบิลใหม่ + reset โควต้าทันที)
  - **Private Function 4** — `renewSubscription(subscriptionId: string, packageId?: string)`:
    - ดึง Subscription (ต้องไม่ถูกยกเลิก/ลบ)
    - กำหนด `periodStart`:
      - ถ้า `current_period_end > now` (ต่ออายุล่วงหน้า) → `periodStart = current_period_end` เพื่อไม่ให้วันหมดอายุหายไป
      - ถ้าเลยกำหนดแล้ว → `periodStart = now`
    - ถ้ามี `packageId` ให้เปลี่ยนแพ็กเกจด้วย; ถ้าไม่มีให้ใช้ Package เดิม
    - เรียก `applyPackageToSubscription(..., periodStart)` → `status = 'ACTIVE'`, reset โควต้า, `last_payment_at = now`
  - **Cron** — `@Cron(CronExpression.EVERY_HOUR) async handleHourlyBillingEnforcement()`:
    - ค้นหา `BusinessSubscription` ที่ `status = 'ACTIVE'` และ `current_period_end <= new Date()`
    - เรียก `expireIfPastDue` ทีละรายการ (ทำหน้าที่ **ตัดสิทธิ์** ไม่ใช่รีเซ็ตโควต้า)
    - ห่อ try/catch ต่อรายการ + `Logger.warn` เพื่อไม่ให้รายการเดียวล้มทั้ง batch
  - **เมธอดตรวจสอบและตัดโควต้า**:
    - `assertQuotaAndRateLimit(businessId: string, manager?: EntityManager)`:
      - ดึง Subscription ล่าสุดของ Business แล้วเรียก `expireIfPastDue`
      - ถ้าไม่มี Subscription หรือ `status !== 'ACTIVE'` (รวมถึง `PAST_DUE` / `CANCELLED`) โยน `ForbiddenException('Business package is inactive or unpaid')`
      - ถ้า `quota_remaining <= 0` โยน `HttpException('Monthly package quota exceeded', HttpStatus.TOO_MANY_REQUESTS)`
      - นับจำนวน `ApiKeyUsageLog` ที่ `business_id = businessId`, `action = 'QR_CREATED'`, และ `created_at >= now - 1 hour`
      - ถ้าจำนวน `>= subscription.rate_limit_per_hour` โยน `HttpException('Hourly rate limit exceeded for this business', HttpStatus.TOO_MANY_REQUESTS)`
    - `deductQuotaOnPaid(order: PaymentOrder, manager: EntityManager): Promise<boolean>`:
      - ล็อกแถว `BusinessSubscription` ด้วย `pessimistic_write`
      - เรียก `expireIfPastDue(subscription, manager)`
      - ถ้า `subscription.status === 'ACTIVE'` และ `quota_remaining > 0`:
        - `quota_remaining -= 1`, `quota_used += 1`
        - บันทึกและคืนค่า `true` (`quota_deducted = true`)
      - ถ้า `status !== 'ACTIVE'` หรือ `quota_remaining <= 0` คืนค่า `false` (ไม่ให้ค่าติดลบ แต่ไม่ให้ธุรกรรมการจ่ายเงินล้มเหลว)
  - **`SubscriptionsController`** (`/api/v1/subscriptions`):
    - `POST /` (`admin`): ผูกหรือเปลี่ยน Package ให้ Business (`{ business_id, package_id }`) → เริ่มรอบบิลใหม่ + reset โควต้า
    - `POST /:id/renew` (`admin`): ต่ออายุรอบบิล (`{ package_id?: string }`) → reset โควต้า, `status = 'ACTIVE'`, ตั้ง `last_payment_at`
    - `GET /business/:businessId` (`admin`, `business`): ดู `status`, โควต้าคงเหลือ, `current_period_end` (paid-through), `last_payment_at`, จำนวน Key ที่ใช้/สูงสุด และประวัติรอบบิล (`subscription_periods`)
    - `GET /business/:businessId/usage` (`admin`, `business`): สรุปการใช้งานรอบปัจจุบัน + แยกตาม API Key
- **Dependencies**: Task 1.3, Task 2.2, Task 3.1
- **Acceptance Criteria**:
  - มี Private Function สำหรับ Map ค่าจาก Package → Subscription และรีเซ็ตโควต้าเฉพาะตอนผูก/เปลี่ยนแพ็กเกจหรือต่ออายุ
  - ครบกำหนดโดยไม่ต่ออายุ → `PAST_DUE` + `quota_remaining = 0` และสร้าง QR ไม่ได้ (ไม่มี grace period)
  - Cron รายชั่วโมงตัดสิทธิ์ได้แม้ไม่มี Request เข้ามา
- **Validation**: เขียน Unit Test `src/subscriptions/subscriptions.service.spec.ts` (ใช้ `jest.useFakeTimers()` ควบคุมเวลา) ครอบคลุม:
  - ผูก/เปลี่ยนแพ็กเกจ → reset โควต้าและ Snapshot รอบเดิม
  - `expireIfPastDue` ทั้งกรณียังไม่ครบกำหนด (ไม่แก้ไข) และครบกำหนดแล้ว (`PAST_DUE`, quota = 0, snapshot 1 แถว)
  - `renewSubscription` ทั้งกรณีต่ออายุล่วงหน้า (period start ต่อจากของเดิม) และต่ออายุหลังเลยกำหนด (`period start = now`)
  - `assertQuotaAndRateLimit`: ไม่มี subscription / `PAST_DUE` / quota หมด / เกิน rate limit / ผ่านเคสปกติ
  - `deductQuotaOnPaid`: หักสำเร็จ, quota = 0 (คืน `false`), และ subscription ไม่ active (คืน `false`)

---

## Sprint 4: API Key Management & Usage Tracking Module

**Goal**: สร้างระบบจัดการ API Key (เพิ่มได้หลาย Key ต่อ Business ตามเพดานแพ็กเกจ, เปิด/ปิด `is_active`, ลบแบบ Soft Delete) และระบบ Track การใช้งานตาม Business และตาม Key
**Demo/Validation**:
- สร้าง API Key ใหม่ได้เมื่อ Business มี Subscription ที่ `ACTIVE` (ยังไม่เลยวันจ่ายถึง) และจำนวน Key ยังไม่เกิน `max_api_keys`
- สร้าง API Key ไม่ได้เมื่อ Subscription เป็น `PAST_DUE` (ยังไม่ชำระเงินรอบใหม่)
- ปิดการใช้งาน (`is_active = false`) หรือลบ (`DELETE`) ได้
- เรียกดูสถิติการใช้งานทั้งระดับ Business และระดับ API Key รายตัวได้

### Task 4.1: Create API Key DTOs
- **Location**:
  - `src/api-keys/dto/create-api-key.dto.ts`
  - `src/api-keys/dto/update-api-key.dto.ts`
- **Description**:
  - `CreateApiKeyDto`:
    - `business_id`: `@IsOptional() @IsUUID()` (Admin ระบุได้, ส่วน Business ใช้ `req.user.businessId`)
    - `name`: `@IsString() @IsNotEmpty() @MaxLength(100)`
    - `package_id`: `@IsOptional() @IsUUID()` (กรณี Admin ต้องการผูก/อัปเดต Package ให้ Business พร้อมกับการสร้าง Key)
  - `UpdateApiKeyDto`:
    - `name`: `@IsOptional() @IsString() @MaxLength(100)`
    - `is_active`: `@IsOptional() @IsBoolean()`
- **Dependencies**: Task 1.4
- **Acceptance Criteria**:
  - Validate input ด้วย `class-validator` ครบถ้วน
- **Validation**: `pnpm build`

### Task 4.2: Implement `ApiKeysService` and `ApiKeysController`
- **Location**:
  - `src/api-keys/api-keys.service.ts`
  - `src/api-keys/api-keys.controller.ts`
  - `src/api-keys/api-keys.module.ts`
- **Description**:
  - `ApiKeysService`:
    - `createApiKey(user: AuthUser, dto: CreateApiKeyDto)`:
      - กำหนด `businessId` (ถ้า `user.role === 'business'` บังคับใช้ `user.businessId`; ถ้า `admin` ใช้ `dto.business_id`)
      - ถ้า `user.role === 'admin'` และส่ง `dto.package_id` มาด้วย ให้เรียก `subscriptionsService.assignOrChangePackage(businessId, dto.package_id)` ก่อน
      - ตรวจสอบว่า Business มี Subscription ที่ `status = 'ACTIVE'` และยังไม่เลย `current_period_end` (ถ้าไม่มี/ไม่ active/`PAST_DUE` โยน `400 BadRequestException('Business has no active prepaid package subscription')`)
      - นับจำนวน API Key ปัจจุบันของ Business ที่ยังไม่ถูกลบ (`deleted_at IS NULL`)
      - ถ้า `currentKeyCount >= subscription.max_api_keys` โยน `409 ConflictException('Maximum API keys limit reached for current package')`
      - สร้าง Key ด้วย `generateApiKey()` (`src/auth/utils/api-key.util.ts`) บันทึก `key_prefix` และ `key_hash` ลง `api_keys` และคืนค่า `rawApiKey` เพียงครั้งเดียว
    - `findAll(user: AuthUser, businessId?: string)`:
      - คืนรายการ API Key (ไม่คืน `key_hash` และ `refresh_token_hash`)
    - `updateStatusOrName(user: AuthUser, id: string, dto: UpdateApiKeyDto)`:
      - อัปเดต `name` หรือ `is_active` (ถ้าตั้ง `is_active = false` ให้ล้าง `refresh_token_hash = null` เพื่อยกเลิก Refresh Token เดิมของ Key นั้นทันที)
    - `revokeApiKey(user: AuthUser, id: string)`:
      - ตั้ง `is_active = false`, `refresh_token_hash = null`, และทำ Soft Delete (`softRemove`) เพื่อคืน Slot `max_api_keys` แต่ยังเก็บแถวไว้ให้ `api_key_usage_logs` อ้างอิงได้
    - `getKeyUsage(user: AuthUser, apiKeyId: string)`:
      - ดึงข้อมูล Key (รวมถึง Key ที่ถูก Soft Delete ถ้าค้นหาด้วย `withDeleted: true`)
      - สรุปจำนวน `total_qr_created`, `total_qr_paid_and_deducted`, จำนวนครั้งในชั่วโมงล่าสุด, และรายการ `recent_logs`
    - `getBusinessUsage(user: AuthUser, businessId: string)`:
      - ดึงข้อมูล Subscription ปัจจุบัน (`status`, `quota_limit`, `quota_used`, `quota_remaining`, `rate_limit_per_hour`, `max_api_keys`, `current_period_start`, `current_period_end`, `last_payment_at`)
      - นับจำนวนการใช้งานใน 1 ชั่วโมงล่าสุดของ Business (`current_hour_requests`)
      - สรุปยอดการใช้งานแยกตามแต่ละ API Key ของ Business นั้น (`keys_breakdown`: `api_key_id`, `name`, `key_prefix`, `is_active`, `deleted_at`, `qr_created_count`, `qr_paid_count`, `quota_deducted_count`, `last_used_at`)
  - `ApiKeysController` (`@Controller({ path: 'api-keys', version: '1' })`):
    - `POST /` (`@Roles('admin', 'business')`)
    - `GET /` (`@Roles('admin', 'business')`)
    - `GET /usage/business/:businessId` (`@Roles('admin', 'business')`)
    - `GET /:id/usage` (`@Roles('admin', 'business')`)
    - `PATCH /:id` (`@Roles('admin', 'business')`)
    - `DELETE /:id` (`@Roles('admin', 'business')`)
- **Dependencies**: Task 3.2, Task 4.1
- **Acceptance Criteria**:
  - Business สามารถเข้าถึงหรือจัดการได้เฉพาะข้อมูลของ `businessId` ตัวเองเท่านั้น (ถ้าเข้าถึงของร้านอื่นให้โยน `404/403`)
  - Admin สามารถจัดการและดู Usage ของทุก Business ได้
- **Validation**: เขียน Unit Test `src/api-keys/api-keys.service.spec.ts`

---

## Sprint 5: Auth, Payment QR & Webhook Integration

**Goal**: เชื่อมต่อระบบแลก Token, การสร้าง QR Payment และการรับ Webhook เข้ากับตาราง `api_keys`, `business_subscriptions`, และ `api_key_usage_logs`
**Demo/Validation**:
- `POST /api/v1/auth/register-business` สร้างเฉพาะ User และ Business (ไม่สร้าง API Key ตอนสมัคร)
- `POST /api/v1/auth/token` ตรวจสอบ API Key จากตาราง `api_keys` และแนบ `api_key_id` ใน JWT
- `POST /api/v1/payments/qr` ตรวจเช็ค Quota & Rate Limit และบันทึก `QR_CREATED`
- `POST /api/v1/payments/qr` จะถูกปฏิเสธ `403` เมื่อ Subscription เป็น `PAST_DUE` (ยังไม่ชำระเงินรอบใหม่)
- `POST /api/v1/webhooks/kbank/line` เมื่อจ่ายเงินสำเร็จ จะหักโควต้าและบันทึก `QR_PAID`

### Task 5.1: Update `AuthUser`, `JwtStrategy`, and `AuthService`
- **Location**:
  - `src/auth/types/auth-user.type.ts`
  - `src/auth/strategies/jwt.strategy.ts`
  - `src/auth/dto/register-business.dto.ts`
  - `src/auth/auth.service.ts`
  - `src/auth/auth.module.ts`
- **Description**:
  - ใน `AuthUser` และ `JwtStrategy`:
    - เพิ่ม `apiKeyId?: string | null` ใน `AuthUser` และอ่านจาก `payload.api_key_id ?? null`
  - ใน `RegisterBusinessDto` & `AuthService.registerBusiness`:
    - เพิ่ม `@IsOptional() @IsUUID() package_id?: string` ใน `RegisterBusinessDto` (เผื่อระบุแพ็กเกจเริ่มต้นตอนสร้าง Business หรือปล่อยว่างได้)
    - สร้างเฉพาะ `User` และ `Business` (ไม่ต้องสร้าง API Key ตอน `registerBusiness` ตาม Requirement)
    - คืนค่า `{ user_id, username, role: 'business', business_id, business_name, promptpay_id }`
  - ใน `AuthService.exchangeApiKey`:
    - ค้นหา API Key จากตาราง `api_keys` ด้วย `key_prefix` (ต้อง `is_active = true` และ `deleted_at IS NULL`)
    - ตรวจสอบว่า `business.is_active === true` และ `user.is_active === true`
    - ตรวจสอบ Hash ด้วย `safeCompare(sha256(apiKey), apiKeyRecord.key_hash)`
    - ออก Access Token & Refresh Token โดยแนบ `api_key_id: apiKeyRecord.id`
    - บันทึก `refresh_token_hash` ลงใน `api_keys.refresh_token_hash` และอัปเดต `api_keys.last_used_at = new Date()`
  - ใน `AuthService.refresh`:
    - หาก JWT refresh token มี `api_key_id` ให้ตรวจสอบว่า API Key นั้นยัง `is_active = true`, ไม่ถูกลบ และ `refresh_token_hash` ตรงกัน แล้วหมุนเวียน (Rotate) `refresh_token_hash` ในตาราง `api_keys`
- **Dependencies**: Task 4.2
- **Acceptance Criteria**:
  - API Key ที่ถูกตั้งเป็น `is_active = false` หรือถูกลบไปแล้ว จะไม่สามารถขอ Token หรือ Refresh Token ได้อีก
- **Validation**: อัปเดตและรัน Unit Test ของ Auth

### Task 5.2: Integrate Quota/Rate Limit Check & Usage Logging in `PaymentService`
- **Location**:
  - `src/payment/payment.service.ts`
  - `src/payment/payment.module.ts`
- **Description**:
  - ใน `PaymentService.createQrOrder(user: AuthUser, dto: CreateQrDto)`:
    - หากมี `user.apiKeyId` ให้ตรวจสอบว่า API Key ยัง `is_active = true` และไม่ถูก Soft Delete
    - เรียก `subscriptionsService.assertQuotaAndRateLimit(business.id, manager)` ภายใน Transaction ก่อนสร้าง Order
    - บันทึก `api_key_id: user.apiKeyId ?? null` ลงใน `PaymentOrder`
    - หากมี `user.apiKeyId` ให้บันทึก `ApiKeyUsageLog` (`action = 'QR_CREATED'`, `quota_deducted = false`, `payment_order_id = order.id`) และอัปเดต `api_keys.last_used_at = now`
- **Dependencies**: Task 3.2, Task 4.2, Task 5.1
- **Acceptance Criteria**:
  - หาก Subscription เป็น `PAST_DUE` / ถูกยกเลิก / ไม่มีแพ็กเกจ ระบบจะปฏิเสธด้วย HTTP `403 Forbidden`
  - หากโควต้าคงเหลือเป็น 0 หรือสร้าง QR เกิน `rate_limit_per_hour` ระบบจะปฏิเสธด้วย HTTP `429 Too Many Requests`
  - ทุก Order ที่สร้างผ่าน API Key จะมี `api_key_id` และมี Log `QR_CREATED`
- **Validation**: เขียน Unit Test ทดสอบ `PaymentService`

### Task 5.3: Integrate Quota Deduction on Payment Paid in `WebhookService`
- **Location**:
  - `src/webhook/webhook.service.ts`
  - `src/webhook/webhook.module.ts`
- **Description**:
  - ใน `WebhookService.matchAndMarkPaid(...)` ภายใน Transaction เดียวกับที่เปลี่ยนสถานะ `order.status = 'PAID'`:
    - เรียก `subscriptionsService.deductQuotaOnPaid(order, manager)` เพื่อหักโควต้าของ Business ลง 1 (เพราะครบเงื่อนไข **สร้าง QR และ จ่ายเงินสำเร็จ**)
    - หาก `order.api_key_id` มีค่า ให้สร้าง `ApiKeyUsageLog` (`api_key_id: order.api_key_id`, `business_id: order.business_id`, `payment_order_id: order.id`, `action: 'QR_PAID'`, `quota_deducted: deducted`)
- **Dependencies**: Task 3.2, Task 5.2
- **Acceptance Criteria**:
  - เมื่อ Order เปลี่ยนเป็น `PAID` โควต้าใน `business_subscriptions` จะถูกหัก 1 ทันที และมี `ApiKeyUsageLog` (`action = 'QR_PAID'`, `quota_deducted = true`)
  - หาก Order หมดอายุ (`EXPIRED`) หรือยังไม่จ่าย จะไม่มีการหักโควต้า
- **Validation**: เขียน Unit Test ทดสอบ `WebhookService`

---

## Sprint 6: Testing, Quality Assurance & Mandatory Documentation Updates

**Goal**: ทดสอบระบบทั้งหมด (Unit Tests, Lint, Build) และอัปเดตเอกสารบังคับของโปรเจกต์ (`AGENTS.md` และ `api-docs.html`)
**Demo/Validation**:
- `pnpm lint`, `pnpm test`, `pnpm build` ผ่านทั้งหมด 100%
- `AGENTS.md` และ `api-docs.html` มีรายละเอียดตารางและ API ใหม่ครบถ้วน

### Task 6.1: Comprehensive Unit Tests & Verification
- **Location**: `src/**/*.spec.ts`
- **Description**:
  - ตรวจสอบและเพิ่ม Unit Tests ให้ครอบคลุม:
    - `src/common/utils/datetime.util.spec.ts` (การคำนวณวันครบรอบรายเดือน `addMonthsClamped` รวมเคสวันสิ้นเดือน 28/29/30/31 และ `billing_cycle_months` มากกว่า 1)
    - `src/packages/packages.service.spec.ts` (CRUD, `code` ซ้ำ, และการป้องกันการลบ Package ที่มี Subscription `ACTIVE`/`PAST_DUE`)
    - `src/subscriptions/subscriptions.service.spec.ts` (Private function map package, `expireIfPastDue`, `renewSubscription`, `expireIfPastDue` ผ่าน Cron, Rate limit check, Quota deduction)
    - `src/api-keys/api-keys.service.spec.ts` (การจำกัดจำนวน Key ตาม `max_api_keys`, ปฏิเสธเมื่อ Subscription `PAST_DUE`, Soft delete, Inactive, Usage tracking)
    - `src/payment/payment.service.spec.ts` และ `src/webhook/webhook.service.spec.ts` (Quota/rate limit, การหักโควต้าเมื่อจ่ายสำเร็จ, ไม่หักเมื่อไม่จ่าย)
  - **ข้อกำหนดการเขียน test ตาม `AGENTS.md`**:
    - วางไฟล์ `*.spec.ts` ไว้ข้างไฟล์ที่ทดสอบ (colocated) และ mock dependency ภายนอกเสมอ (ห้ามต่อ DB/HTTP/env จริง)
    - ใช้ `Test.createTestingModule` สำหรับ provider ที่มี DI
    - ใช้ `jest.useFakeTimers()` / กำหนด `now` แบบ explicit เมื่อทดสอบ logic ที่เกี่ยวกับเวลา (`current_period_end`, Snapshot รอบบิล, rate limit 60 นาที)
    - ครอบคลุม happy path, edge case (ค่าขอบ, ข้อมูลว่าง/ผิดรูปแบบ) และ error case (exception ที่คาดว่าจะถูก throw)
    - หลีกเลี่ยงการ assert ค่าที่ไม่ deterministic ให้ใช้ `expect.any(String)` แทน
    - **ห้ามลบ/แก้ script `pnpm test` ให้ถอด flag `node --experimental-vm-modules`** เพราะ NestJS v12 เป็น ESM-only
  - รัน `pnpm lint`, `pnpm test`, และ `pnpm build`
- **Dependencies**: Sprint 1–5
- **Acceptance Criteria**:
  - ทุก Test suite ผ่านทั้งหมด และไม่มี Warning/Error จาก `oxlint`
- **Validation**: `pnpm lint && pnpm test && pnpm build`

### Task 6.2: Update `AGENTS.md` and `api-docs.html` (กฎเหล็กของโปรเจกต์)
- **Location**:
  - `AGENTS.md`
  - `api-docs.html`
- **Description**:
  - อัปเดต `AGENTS.md`:
    - อธิบายโครงสร้างตารางใหม่ (`packages`, `business_subscriptions`, `subscription_periods`, `api_keys`, `api_key_usage_logs`)
    - อธิบาย Flow การสมัคร Business, การผูก Package, การสร้างหลาย API Key, การคิด Rate Limit ต่อชั่วโมง, การหักโควต้าเมื่อสร้าง QR + จ่ายเงินสำเร็จ
    - อธิบาย **โมเดล Prepaid / Paid-through**: `current_period_end` คือวันจ่ายถึง, ไม่มี grace period, `PAST_DUE` = ยังไม่ชำระเงินรอบใหม่ (โควต้า 0 สร้าง QR ไม่ได้), และการได้โควต้าใหม่เกิดจาก `POST /subscriptions`, `POST /subscriptions/:id/renew` เท่านั้น
    - อธิบาย Hourly Cron ที่ทำหน้าที่ **ตัดสิทธิ์** (`PAST_DUE`) ไม่ใช่รีเซ็ตโควต้า
    - อัปเดตกฎการเขียน Unit Test (colocated `*.spec.ts`, jest ผ่าน `node --experimental-vm-modules`)
  - อัปเดต `api-docs.html` (OpenAPI 3.0.3):
    - อัปเดต Schema ของ `/api/v1/auth/register-business`
    - เพิ่ม Tags, Paths, Request/Response Schemas สำหรับ `/api/v1/packages`, `/api/v1/subscriptions`, และ `/api/v1/api-keys` (รวมถึง Usage Tracking Endpoints)
- **Dependencies**: Task 6.1
- **Acceptance Criteria**:
  - เอกสารทั้งสองไฟล์ตรงกับโค้ดและ DTO ล่าสุดทุกประการ
- **Validation**: เปิดตรวจสอบ `AGENTS.md` และความถูกต้องของ JSON/YAML spec ใน `api-docs.html`

---

## Potential Risks & Gotchas (ข้อควรระวังสำหรับ AI Agent)

1. **ลำดับการจดทะเบียนตารางใน `DatabaseSecurityService`**:
   - ห้ามลืมเพิ่มชื่อตารางใหม่ทั้ง 5 ตารางใน `TABLES` ของ `src/database/database-security.service.ts` มิฉะนั้นตารางจะไม่มี Row Level Security (RLS) บน Supabase/PostgreSQL
2. **การคำนวณวันครบรอบรายเดือน (End-of-Month Rollover)**:
   - การใช้ `Date.setMonth()` ของ JavaScript โดยตรงในวันที่ 31 มกราคม จะทำให้กระโดดไปเป็นวันที่ 2 หรือ 3 มีนาคม ต้องใช้ฟังก์ชัน `addMonthsClamped` ที่ตรวจสอบจำนวนวันสูงสุดของเดือนปลายทางเสมอ
3. **Race Condition ตอนตัดโควต้าใน Webhook**:
   - ต้องใช้ `pessimistic_write` lock บนแถว `business_subscriptions` ภายใน Transaction เดียวกับ `matchAndMarkPaid` เพื่อป้องกันการตัดโควต้าผิดพลาดเมื่อมีรายการโอนเงินเข้าพร้อมกันหลายรายการ
4. **การจัดการ API Key ที่ถูก Inactive หรือ Soft Delete**:
   - เมื่อตั้ง `is_active = false` หรือสั่ง `DELETE` API Key ต้องล้าง `refresh_token_hash = null` ของ API Key นั้นด้วยเสมอ เพื่อป้องกันไม่ให้นำ Refresh Token เดิมมาขอ Access Token ใหม่ได้
5. **ห้ามรีเซ็ตโควต้าให้เองเมื่อครบรอบบิล (Prepaid Model)**:
   - Cron/Lazy Expiry ต้อง **ไม่** รีเซ็ต `quota_remaining` เด็ดขาด ให้ทำหน้าที่แค่เปลี่ยน `status = 'PAST_DUE'` และตั้ง `quota_remaining = 0`
   - การรีเซ็ตโควต้าเกิดขึ้นได้เฉพาะ `applyPackageToSubscription()` (เรียกจาก `POST /subscriptions` และ `POST /subscriptions/:id/renew`) เท่านั้น เพื่อไม่ให้ลูกค้าที่ไม่ชำระเงินได้โควต้าฟรี
6. **การต่ออายุต้องรักษาวันหมดอายุเดิม (Prepaid Continuity)**:
   - ถ้าต่ออายุก่อนครบกำหนด ต้องตั้ง `period_start = current_period_end` เดิม (ไม่ใช่ `now`) มิฉะนั้นวันหมดอายุจะถูกดันเร็วขึ้นโดยไม่ตั้งใจ
7. **Zero-day Order ที่ค้างอยู่ตอน Subscription หมดอายุ**:
   - Order ที่สร้างไว้ก่อนหมดรอบยังสามารถถูกจับคู่เป็น `PAID` ได้ตามปกติ แต่ `deductQuotaOnPaid` จะคืน `false` (ไม่หักโควต้า) และ log `quota_deducted = false` — ต้องทดสอบเคสนี้ด้วย

---

## Rollback Plan

- หากต้องการย้อนกลับ:
  1. คืนค่าคอลัมน์ใน `businesses` และ `payment_orders`
  2. ถอด `PackagesModule`, `SubscriptionsModule`, `ApiKeysModule`, และ `ScheduleModule` ออกจาก `AppModule`
  3. ลบตาราง `api_key_usage_logs`, `api_keys`, `subscription_periods`, `business_subscriptions`, `packages` ออกจาก schema `apay`
