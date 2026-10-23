# AGENTS.md

> **กฎเหล็ก (Mandatory Maintenance Rule):**
> หากมีการเพิ่ม แก้ไข หรือเปลี่ยนแปลง Business Logic, โครงสร้าง Database/Entity, API Endpoint หรือ Flow การทำงานใดๆ ในโปรเจกต์นี้ **ต้องมาอัปเดตเอกสารให้ตรงกับโค้ดล่าสุดทุกครั้ง ดังนี้**
> 1. อัปเดตไฟล์ `AGENTS.md` นี้ให้ตรงกับโค้ดล่าสุด
> 2. อัปเดตไฟล์ `api-docs.html` (Interactive Swagger UI) ให้ตรงกับ API Endpoint, Request/Response DTO และ Schema ล่าสุด
> 3. เขียนหรืออัปเดต unit test ในไฟล์ `*.spec.ts` ทุกครั้งที่มีการ implement หรือแก้ไขโค้ด
> *(Whenever any business logic, database entity/schema, API endpoint, or execution flow is added or modified, you MUST update BOTH this `AGENTS.md` file AND `api-docs.html` in the same task. In addition, every implementation or code change MUST include new/updated unit tests in a `*.spec.ts` file.)*

## Commands

Package manager is **pnpm**. Linter is **oxlint** (not ESLint).

```bash
pnpm start:dev                           # Run dev server in watch mode
pnpm build                               # Compile via nest build -> dist/
pnpm lint                                # Run oxlint on src/ and test/
pnpm format                              # Format with Prettier
pnpm test                                # Run all unit tests (*.spec.ts)
pnpm test -- src/webhook/utils/kbank-message.parser.spec.ts  # Run a single unit test
pnpm test:e2e                            # Run e2e tests (test/jest-e2e.json)
```

> **Jest & ESM note:** NestJS v12 packages (`@nestjs/common`, `@nestjs/testing`, ...) are ESM-only (`"type": "module"`). Jest needs Node's VM modules to `require()` them, so all `test*` scripts run Jest via `node --experimental-vm-modules node_modules/jest/bin/jest.js` (instead of the bare `jest` binary). Keep this flag when adding new test scripts, otherwise suites importing `@nestjs/testing` fail with `Must use import to load ES Module`.

## Testing Rules

- **ทุกการ implement ต้องมี unit test**: ทุกครั้งที่สร้างไฟล์ใหม่หรือแก้ไข logic ใน `src/` ต้องเขียนหรืออัปเดต unit test ในไฟล์ `*.spec.ts` คู่กันในงานเดียวกัน (ไม่ใช่แยก PR/งานถัดไป) และต้องรัน `pnpm test` ผ่านก่อนส่งงาน
- **ตำแหน่งไฟล์**: วาง `*.spec.ts` ไว้ข้างไฟล์ที่ทดสอบ (colocated) เช่น `src/payment/payment.service.ts` → `src/payment/payment.service.spec.ts` ส่วน e2e test อยู่ใน `test/*.e2e-spec.ts`
- **ขอบเขตของ unit test**: ทดสอบ service/util/guard/parser แบบแยกส่วน (isolated) โดย mock dependency ภายนอกเสมอ — ห้ามต่อ DB จริง, เรียก HTTP จริง หรือพึ่ง env var จริงใน unit test; งานที่ต้องใช้ DB/HTTP จริงให้เขียนเป็น e2e test แทน
- **ครอบคลุม behavior**: อย่างน้อยต้องมีเคส happy path, edge case (ค่าขอบ, ข้อมูลว่าง/ผิดรูปแบบ) และ error case (exception ที่คาดว่าจะถูก throw) ของ logic ที่เพิ่มหรือแก้
- **รูปแบบ**: ใช้ `Test.createTestingModule` จาก `@nestjs/testing` สำหรับ provider ที่มี DI, ตั้งชื่อ `describe` ตามคลาส/ฟังก์ชัน และ `it` ให้อธิบาย behavior ที่ตรวจสอบ
- **ห้ามให้ test ค้าง/ไม่ stable**: mock time (`jest.useFakeTimers`) เมื่อ logic เกี่ยวเวลาหรือ TTL, และหลีกเลี่ยงการ assert ค่าที่ไม่ deterministic (เช่น timestamp จริง) ให้ใช้ `expect.any(String)` แทน

## Architecture & Conventions

- **Routing & Versioning**: Global prefix is `/api` with URI versioning enabled (`src/main.ts`). Controllers declaring `@Controller({ path: '...', version: '1' })` are served at `/api/v1/...`.
- **API Documentation (`api-docs.html`)**: Standalone interactive Swagger UI (`OpenAPI 3.0.3`) specification file at the project root covering all `/api/v1/...` endpoints, schemas, and webhook callbacks. Keep `api-docs.html` updated whenever endpoints or DTOs change.
- **Response & Error Envelope**:
  - Success responses are automatically wrapped by global `ResponseInterceptor` into `{ ok: true, status, correlation_id, data }`. Return raw data from controllers—do not manually wrap with `{ ok, data }`.
  - `HttpException` errors are formatted by global `HttpErrorFilter` into `{ ok: false, status, correlation_id, message }`.
  - Every request gets `req.correlation_id` via `correlationIdMiddleware` (from `x-correlation-id` header or generated UUID), and `LoggerInterceptor` logs masked request/response bodies via `src/utils/maskBody.ts`.
- **Raw Body Requirement**: `NestFactory.create(AppModule, { rawBody: true })` is required so `request.rawBody` is available for LINE webhook HMAC-SHA256 signature verification.
- **Central Enums (`src/enums/`)**: ทุกค่า enum ของระบบ (role + คอลัมน์ที่เป็น enum ใน DB) ถูกประกาศที่ `src/enums/*.enum.ts` และ re-export ผ่าน barrel `src/enums/index.ts`:
  - `role.enum.ts` → `RoleEnum` (`ADMIN = 'admin'`, `BUSINESS = 'business'`) + type `UserRole` (ใช้ใน `AuthUser`, JWT payload, `@Roles(...)`)
  - `business-subscription-status.enum.ts` → `BusinessSubscriptionStatusEnum` + type `BusinessSubscriptionStatus`
  - `payment-order-status.enum.ts` → `PaymentOrderStatusEnum` + type `PaymentOrderStatus`
  - `webhook-process-status.enum.ts` → `WebhookProcessStatusEnum` + type `WebhookProcessStatus`
  - `api-key-usage-action.enum.ts` → `ApiKeyUsageActionEnum` + type `ApiKeyUsageAction`
  - Query-value enums: `dashboard-interval.enum.ts`, `dashboard-usage-metric.enum.ts`, `sort-order.enum.ts`, `admin-businesses-sort-by.enum.ts` (`AdminBusinessesSortByEnum` + type `AdminBusinessesSortBy`)
  - Each file exports the runtime enum **and** a string-literal union type derived from it (`` `${XEnum}` ``), so entity/DTO types keep the exact same shape as before. Entity files (`payment-order.entity.ts`, `business-subscription.entity.ts`, `webhook-log.entity.ts`, `api-key-usage-log.entity.ts`) and `auth/types/auth-user.type.ts` re-export those types for backwards compatibility.
  - **ห้ามประกาศ union literal ซ้ำในโมดูลอื่น**: import จาก `src/enums` (หรือไฟล์ enum โดยตรง) และใช้ `Object.values(<Enum>)` เป็นค่าให้ `@IsIn(...)` / `In([...])` แทนการพิมพ์ค่าด้วยมือ เพื่อไม่ให้ validation กับ entity หลุดจากกัน (มี test คุมสัญญาที่ `src/enums/enums.spec.ts`)

## Database & Security Rules (`apay` Schema)

- **Dedicated Schema (`DB_SCHEMA = 'apay'`)**: All tables live in the `apay` PostgreSQL schema (`src/database/database.schema.ts`), **never** `public`, to prevent automatic exposure via Supabase PostgREST.
- **Adding a New Entity/Table**:
  1. Always set `@Entity({ schema: DB_SCHEMA, name: '<table_name>' })`.
  2. **MUST** add `<table_name>` to the `TABLES` array in `src/database/database-security.service.ts` so Row Level Security (`ENABLE ROW LEVEL SECURITY`) and `anon`/`authenticated` privilege revocations are applied on bootstrap.
  3. Use `numericTransformer` (`src/common/transformers/numeric.transformer.ts`) on `@Column({ type: 'numeric', ... })` fields so PostgreSQL `numeric` values map to JS `number` instead of `string`.
- **Auto-Synchronize & Seeding**:
  - TypeORM `synchronize` is controlled by `ENV === 'development'` (checks `ENV`, **not** `NODE_ENV`). Before synchronizing, `AppModule` runs `CREATE SCHEMA IF NOT EXISTS "apay"`.
  - On bootstrap, `DatabaseSeederService` seeds default roles (`admin`, `business`), default master packages (`FREE`, `STARTER`, `PRO` — idempotent by `code`) and upserts the admin user if `ADMIN_USERNAME` and `ADMIN_PASSWORD` are set.
- **Tables in `TABLES` (`src/database/database-security.service.ts`)**: `roles`, `users`, `businesses`, `packages`, `business_subscriptions`, `subscription_periods`, `api_keys`, `api_key_usage_logs`, `payment_orders`, `webhook_logs`.
- **Schema Notes**:
  - `businesses.api_key_prefix` / `businesses.api_key_hash` are **nullable legacy columns**; new API keys live in `api_keys` (multiple keys per business).
  - `payment_orders.api_key_id` is nullable and references `api_keys` with `onDelete: 'SET NULL'`.
  - `packages` and `business_subscriptions` use `@DeleteDateColumn` (`deleted_at`) for soft delete. `api_key_usage_logs` keeps history even after an API key is soft-deleted.

## Core Business Logic

### 1. Auth & API Keys (`src/auth/`, `src/users/`, `src/business/`)
- **Roles**: `admin` and `business`. Protected routes use `@UseGuards(JwtAuthGuard, RoleGuard)` and `@Roles(...)`. `RoleGuard` verifies the user exists, is active (`user.is_active`), has a valid role in `requiredRoles`, and syncs `request.user.role` from the database.
- **Endpoints (`/api/v1/auth`)**:
  - `POST /login`: Authenticates `admin` or `business` user with username/password; verifies business `is_active` for `business` role.
  - `POST /register-business` (`admin` only): Creates a `User` (`role = business`), a `Business`, and (optionally) the initial Master Package assignment — **all inside one TypeORM `DataSource.transaction`** (`manager` is passed to `SubscriptionsService.assignOrChangePackage`), so any failure (duplicate username, missing role, invalid/inactive `package_id`) rolls back everything. No API key is created at registration. Returns `{ user_id, username, role, business_id, business_name, promptpay_id }`.
  - `POST /token`: Exchanges a business API key (from body `api_key` or `x-api-key` header) for an access/refresh JWT bundle. Looks up `api_keys` by `key_prefix` with `is_active = true` and not soft-deleted, verifies `business.is_active` and `user.is_active`, then compares `sha256(apiKey)` via timing-safe `safeCompare` against `api_keys.key_hash`.
  - `POST /refresh`: Rotates access & refresh tokens. If the refresh token payload has `api_key_id`, the key must still be active/not deleted and `api_keys.refresh_token_hash` must match (rotated on every refresh). Otherwise falls back to `users.refresh_token_hash` / `businesses.refresh_token_hash`.
- **JWT Payload**: `sub`, `username`, `role`, `business_id`, `api_key_id` (`null` for username/password logins), `type` (`'access'` or `'refresh'`). `JwtStrategy` rejects payloads without `sub` or with `type !== 'access'`, and maps `api_key_id` to `req.user.apiKeyId`.
- **API Key Format**: `apay_live_<8_hex>_<32_hex>` (`src/auth/utils/api-key.util.ts`). Only `key_prefix` (`apay_live_<8_hex>`) and SHA-256 `key_hash` are stored in `api_keys`. Hash comparisons use timing-safe `safeCompare`.

### 2. Master Packages (`src/packages/`)
- **Endpoints (`/api/v1/packages`)**: `POST /` (admin), `GET /` (admin/business; business users are forced to `only_active = true`), `GET /:id`, `PATCH /:id` (admin), `DELETE /:id` (admin, soft delete).
- **Fields**: `code`, `name`, `description`, `price` (`numeric` + `numericTransformer`), `max_api_keys`, `quota_limit`, `rate_limit_per_hour`, `billing_cycle_months` (default `1`), `is_active`, `deleted_at`.
- `PackagesService.create` rejects duplicated `code` with `409 Conflict` (checks soft-deleted rows too). `softDelete` refuses (`409`) while any `business_subscriptions` with `package_id = id` and `status IN ('ACTIVE','PAST_DUE')` still exists; otherwise sets `is_active = false` and soft-removes the row.

### 3. Business Subscriptions — Prepaid / Paid-through (`src/subscriptions/`)
- **Model**: 1 Business → 1 active Master Package. `quota_limit`, `quota_used`, `quota_remaining` form a **single pool per business** shared across all API keys. **No top-up** exists.
- **`current_period_end` = paid-through date** (the date the business has paid up to), not merely a reset date.
- **Endpoints (`/api/v1/subscriptions`)**:
  - `POST /` (`admin`): Assign or change package (`{ business_id, package_id }`). Starts a new billing period immediately and **resets the quota**.
  - `POST /:id/renew` (`admin`): Renews the period (`{ package_id? }`). Resets quota, sets `status = 'ACTIVE'` and `last_payment_at = now`. If renewed early (`current_period_end > now`), the new period starts at the existing `current_period_end` so the paid-through date is preserved; otherwise it starts at `now`.
  - `GET /business/:businessId` (`admin`, `business`): Returns current subscription (status, quota, `current_period_end`, `last_payment_at`), API key slot usage (`used`/`max`), and `subscription_periods` history. Business users can only read their own `business_id` (otherwise `404`).
  - `GET /business/:businessId/usage` (`admin`, `business`): Returns current-period summary, requests in the last hour, and per-API-key breakdown (`qr_created_count`, `qr_paid_count`, `quota_deducted_count`, `last_used_at`, including soft-deleted keys).
- **`SubscriptionsService` internals**:
  - `assignOrChangePackage(businessId, packageId, manager?)` — validates the business/package (using `manager`'s repositories when provided) and wraps `applyPackageToSubscription()` in a new transaction; pass a `manager` to join an existing transaction (used by `POST /register-business`) so failures roll back everything.
  - `applyPackageToSubscription()` — maps package values (`quota_limit`, `rate_limit_per_hour`, `max_api_keys`, `billing_cycle_months`), resets `quota_used = 0` / `quota_remaining = quota_limit`, sets `status = 'ACTIVE'`, `current_period_start`, `current_period_end = addMonthsClamped(start, billing_cycle_months)`, `last_payment_at = now`. Snapshots the previous period when `quota_used > 0`. **Only this function resets quotas.**
  - `expireIfPastDue()` — lazy expiry: when `status = 'ACTIVE'` and `now >= current_period_end`, snapshots the period, sets `status = 'PAST_DUE'` and `quota_remaining = 0` (keeps `quota_used`). **No auto-renew, no grace period, no quota reset.**
  - `renewSubscription()` — admin renewal described above.
  - `assertQuotaAndRateLimit(businessId, manager?)` — used before creating a QR. Throws `403 ForbiddenException('Business package is inactive or unpaid')` when there is no subscription or status is not `ACTIVE`; throws `429` when `quota_remaining <= 0`; counts `api_key_usage_logs` with `action = 'QR_CREATED'` in the last 60 minutes and throws `429` when `>= rate_limit_per_hour`.
  - `deductQuotaOnPaid(order, manager)` — inside the webhook transaction, locks the subscription row with `pessimistic_write`, applies lazy expiry, and (if still `ACTIVE` with `quota_remaining > 0`) decrements `quota_remaining` / increments `quota_used`, returning `true`. Otherwise returns `false` without failing the payment transaction.
- **Hourly Cron**: `@Cron(CronExpression.EVERY_HOUR)` sweeps `status = 'ACTIVE'` subscriptions with `current_period_end <= now` and calls `expireIfPastDue()` per row (try/catch + `Logger.warn` so one failure does not stop the batch). The cron **revokes access** (sets `PAST_DUE`); it never resets quota.
- **Date helper**: `addMonthsClamped(date, months)` (`src/common/utils/datetime.util.ts`) preserves day/time and clamps end-of-month (e.g. 31 Jan → 28/29 Feb, 31 Mar → 30 Apr).

### 4. API Key Management & Usage Tracking (`src/api-keys/`)
- **Endpoints (`/api/v1/api-keys`)**:
  - `POST /` (`admin`, `business`): Creates a key. Business users are forced to their own `businessId`; admin must send `business_id` and may send `package_id` to assign/change the package first. Requires an `ACTIVE` subscription not past `current_period_end` (else `400`), and the count of non-deleted keys must be below `max_api_keys` (else `409`). Returns the raw `api_key` **once**.
  - `GET /` (`admin`, `business`): Lists keys (never returns `key_hash` / `refresh_token_hash`). Business users only see their own; admin may filter with `?business_id=`.
  - `PATCH /:id`: Updates `name` and/or `is_active`. Setting `is_active = false` clears `refresh_token_hash` immediately.
  - `DELETE /:id`: Sets `is_active = false`, clears `refresh_token_hash`, then soft-deletes the key (frees a `max_api_keys` slot while keeping usage logs attached).
  - `GET /:id/usage`: Per-key totals (`total_qr_created`, `total_qr_paid_and_deducted`, `current_hour_requests`) and `recent_logs` (latest 20). Works for soft-deleted keys (`withDeleted`).
  - `GET /usage/business/:businessId`: Business-level usage (delegates to `SubscriptionsService.getBusinessUsage`).
- **Ownership**: `business` callers can only access their own `business_id`; cross-business access responds `404` to avoid leaking existence. `admin` can manage all businesses.

### 5. Payment Orders & PromptPay QR (`src/payment/`)
- **Endpoints (`/api/v1/payments`)**:
  - `POST /qr` (`business`, `admin`): Creates a PromptPay QR payment order. Requires an `ACTIVE` paid-through subscription; otherwise `403` (`PAST_DUE`/no package) or `429` (quota exhausted / hourly rate limit exceeded). If the JWT contains `api_key_id`, the key must still be active/not deleted and belong to the business, `payment_orders.api_key_id` is set, an `api_key_usage_logs` row with `action = 'QR_CREATED'`, `quota_deducted = false` is written, and `api_keys.last_used_at` is updated.
  - `GET /orders/:id` (`business`, `admin`): Returns order details (`business` users must have a valid `businessId` matching `order.business_id`, otherwise `404`).
- **Order Allocation Logic (`PaymentService`)**:
  - Lazily marks any `UNVERIFIED` orders with `expires_at <= now` as `EXPIRED` before allocating.
  - Floors input `amount` (`>= 1`) to integer `base_amount` and allocates the lowest unused `decimal_ref` from `0.01` to `0.99` (`MAX_DECIMAL_REF = 99`) among active `UNVERIFIED` orders with the same `base_amount`. Throws `409 Conflict` if all 99 slots are occupied.
  - `total_amount = base_amount + decimal_ref`. QR TTL is **5 minutes** (`QR_TTL_MS`).
  - Uses `Asia/Bangkok` (`UTC+7`, `src/common/utils/datetime.util.ts`) to construct:
    - `order.id`: `YYYYMMDDHHmmss_<total_amount.toFixed(2)>`
    - `order.lookup_key`: `YYYYMMDD_<total_amount.toFixed(2)>`
  - Generates EMVCo PromptPay payload via `promptpay-qr` using `business.promptpay_id` and `total_amount`, plus a Base64 PNG Data URL via `qrcode`.

### 6. KBank LINE Webhook & Matching (`src/webhook/`)
- **Endpoint**: `POST /api/v1/webhooks/kbank/line`
- **Signature Verification**: Checks `x-line-signature` (HMAC-SHA256 of `request.rawBody` with `LINE_CHANNEL_SECRET`) only when `VERIFY_LINE_SIGNATURE=true`.
- **Idempotency**: Ignores non-text events and deduplicates by checking `webhook_logs.line_message_id`.
- **KBank Text Parser (`src/webhook/utils/kbank-message.parser.ts`)**:
  - Extracts 2-decimal transfer amount from Thai KBank LINE notifications (keywords: `จำนวนเงิน`, `จำนวน`, `เงินเข้า`, `รับโอนเงิน`, `รับโอน`, `รับเงิน`, `โอนเข้า`).
  - Parses `DD/MM/YY(YY)` and `HH:mm` in `Asia/Bangkok` time, converting 2-digit or 4-digit Thai Buddhist Era (พ.ศ.) years to CE (`convertBuddhistYearToCE`), falling back to the LINE event timestamp if no date is in the text.
- **Order Matching, Quota Deduction & Callback (`WebhookService`)**:
  - Builds `lookupKey = "${parsed.dateStr}_${parsed.amount}"` and queries `payment_orders` inside a transaction with `pessimistic_write` lock where `lookup_key = :lookupKey`, `status = 'UNVERIFIED'`, and `expires_at >= :transferTime` (ordered by `created_at DESC`).
  - Logs result in `webhook_logs` with `process_status` (`MATCHED` or `NO_MATCH`).
  - On match, marks order `PAID` (`paid_at = now`) and calls `subscriptions.deductQuotaOnPaid()` in the same transaction (quota is deducted only when **QR created + payment succeeded** and the subscription is still `ACTIVE` with remaining quota).
  - If `order.api_key_id` is set, writes `api_key_usage_logs` (`action = 'QR_PAID'`, `quota_deducted` = result of the deduction). Orders created without an API key still deduct quota but skip the log.
  - Sends an HTTP `POST` callback (`event: 'payment.paid'`, 5s timeout) to `order.redirect_url`, recording `callback_sent` and `callback_status_code` on the order.

### 7. Dashboard Analytics (`src/dashboard/`)
- **Read-only Analytics APIs** for Frontend KPI cards and charts (`Asia/Bangkok` / `UTC+7` timezone). Guarded by `@UseGuards(JwtAuthGuard, RoleGuard)`. Any module using `RoleGuard` (`PackagesModule`, `SubscriptionsModule`, `ApiKeysModule`, `PaymentModule`, `DashboardModule`) imports `UsersModule` so `RoleGuard` can resolve `UsersService` without circular dependencies.
- **Range & Bucketing (`src/dashboard/utils/dashboard-bucket.util.ts`)**:
  - Half-open range `[from, to)`. Default range = last 30 days (`to = now`, `from = now - 30d`), maximum 365 days (`400 BadRequestException` if `from > to`, `> 365d`, or `> 744` buckets).
  - Supports `interval = 'day' | 'hour'` (`hour` requires range `<= 31` days).
  - Day buckets align to `00:00` `Asia/Bangkok`; hour buckets align to the top of the hour in `Asia/Bangkok`. Empty buckets are always **zero-filled** and include both UTC `bucket_start` (ISO) and Bangkok `label` (e.g. `20 Oct` or `14:00`).
- **Business-scoped Endpoints (`/api/v1/dashboard`, `@Roles('admin', 'business')`)**:
  - Scope resolution: `business` callers are locked to their own `req.user.businessId` (passing another `business_id` throws `404`); `admin` callers must supply `?business_id=` (otherwise `400`).
  - `GET /overview`: KPI summary (`business`, `subscription` with `days_until_period_end`, `usage`, `transactions`, `api_keys`, `rate_limit`, `webhook.matched`). Returns `subscription: null` (without throwing) if no subscription is assigned yet.
  - `GET /usage/timeseries`: Zero-filled series for `qr_created`, `qr_paid`, `quota_deducted` (`metric` and `api_key_id` filters supported).
  - `GET /transactions/timeseries`: Zero-filled series for `orders_created`, `paid_count`, `expired_count`, `gmv`, `average_order_value`, plus `status_breakdown` (`PAID`, `UNVERIFIED: { active, expired }`, `EXPIRED`). Orders with `status = 'UNVERIFIED'` and `expires_at <= now` are counted as expired.
  - `GET /rate-limit`: Sliding 60-minute `requests_last_hour`, `limit_per_hour`, `remaining`, `utilization` (clamped `0..1`), and hourly `QR_CREATED` series (`hours` default `24`, max `168`).
  - `GET /api-keys`: Per-key breakdown (`qr_created`, `qr_paid`, `quota_deducted`, `share_of_created`, `share_of_paid`, `include_deleted` default `true`; never exposes `key_hash`/`refresh_token_hash`).
  - `GET /api-keys/timeseries`: Stacked timeseries per API key (capped at top 10 keys by volume in range + `other` series).
  - `GET /subscription`: Current subscription summary, daily quota burn-down (`quota.daily` derived from `QR_PAID` with `quota_deducted = true` since `current_period_start`), and `subscription_periods` history with `utilization`.
- **Admin Platform Endpoints (`/api/v1/dashboard/admin`, `@Roles('admin')`)**:
  - `GET /admin/overview`: Platform-wide counts (`businesses`, `subscriptions` including `expiring_7d`/`expiring_30d`, `platform` orders/GMV/AOV/paid_rate/QR counts, `webhook` `matched`/`no_match`/`match_rate`, and `estimated_mrr` / `estimated_arr`).
  - `GET /admin/timeseries`: Zero-filled platform series (`new_businesses`, `orders_created`, `paid_count`, `gmv`, `qr_created`, `qr_paid`).
  - `GET /admin/distribution`: Package distribution (`business_count`, `active_count`, `past_due_count`), subscription status counts, and quota utilization buckets (`0-25`, `26-50`, `51-75`, `76-100`, `100+`).
  - `GET /admin/businesses`: Paginated business table with `search` (case-insensitive `business_name`), `package_id`, `status`, `sort_by` (`gmv`, `qr_created`, `qr_paid`, `quota_used`, `current_period_end`, `created_at`), `sort_order`, `page`, `limit`. Businesses without a subscription are included with `null` subscription fields.
  - `GET /admin/expiring`: `expiring` `ACTIVE` subscriptions within `days` (default `7`, max `90`) and `near_quota` subscriptions with `quota_used / quota_limit >= quota_threshold` (default `0.8`).
- **Dashboard Indexes & Known Constraints**:
  - Indexes added on existing entities: `idx_payment_orders_business_created`, `idx_payment_orders_business_paid`, `idx_webhook_logs_created`, `idx_webhook_logs_status_created`, `idx_businesses_created`, `idx_subscription_periods_business`.
  - `webhook_logs` has no `business_id`, so `NO_MATCH` and `match_rate` are only available on Admin platform endpoints; business overview reports `webhook.matched` (joined via `matched_order_id`).
  - Rejected `429`/`403` requests are not persisted in request logs, `estimated_mrr`/`estimated_arr` are estimated from active package prices (no invoice table yet), and daily quota history is derived from `api_key_usage_logs`.

## Required Environment Variables

- `ENV`: Set to `development` to enable TypeORM `synchronize` (default off otherwise).
- `PORT`: HTTP server port (defaults to `3000`).
- `DATABASE_URL`: PostgreSQL connection string.
- `JWT_SECRET` / `JWT_REFRESH_SECRET`: Secrets for access and refresh tokens (`JWT_EXPIRES_IN` defaults to `15m`, `JWT_REFRESH_EXPIRES_IN` defaults to `7d`).
- `ADMIN_USERNAME` / `ADMIN_PASSWORD`: Used by `DatabaseSeederService` to seed the initial `admin` user.
- `VERIFY_LINE_SIGNATURE`: Set to `'true'` to enforce `x-line-signature` verification using `LINE_CHANNEL_SECRET`.
