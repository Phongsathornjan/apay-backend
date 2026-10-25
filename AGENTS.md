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
pnpm create:admin                        # Create/update admin user from ADMIN_USERNAME/ADMIN_PASSWORD in .env
```

> **Admin migration script note:** `pnpm create:admin` runs `scripts/create-admin.mts` directly with Node's built-in TypeScript type stripping (Node >= 22.18 / 24 — the repo/Docker use Node 24), so unlike `nest build` it does **not** compile first. The script imports the shared logic from `src/database/admin-user.util.ts` via an explicit `.ts` specifier (Node ESM resolution) and is invoked with `--disable-warning=MODULE_TYPELESS_PACKAGE_JSON` to silence the ESM-reparse warning.

> **Jest & ESM note:** NestJS v12 packages (`@nestjs/common`, `@nestjs/testing`, ...) are ESM-only (`"type": "module"`). Jest needs Node's VM modules to `require()` them, so all `test*` scripts run Jest via `node --experimental-vm-modules node_modules/jest/bin/jest.js` (instead of the bare `jest` binary). Keep this flag when adding new test scripts, otherwise suites importing `@nestjs/testing` fail with `Must use import to load ES Module`.

## Docker

Production image lives at `Dockerfile` (multi-stage, `node:24-bookworm-slim` + `pnpm@11.24.0` matching the lockfile/pnpm major used locally):

```bash
docker build -t apay-backend .                       # deps -> build -> prune --prod -> runtime
docker run --rm -p 3000:3000 --env-file .env apay-backend
```

- **Stages**: `base` (Node + pnpm) → `deps` (`pnpm install --frozen-lockfile`, includes devDeps + `python3/make/g++` for the `bcrypt` native build) → `build` (`pnpm build` then `pnpm prune --prod`) → `runtime` (copies only `dist/`, production `node_modules/`, `package.json`).
- **`pnpm-workspace.yaml` must be copied in the deps stage**: it holds pnpm 11 `allowBuilds` (`bcrypt: true`), without it bcrypt's install script is skipped and the app crashes at runtime.
- **Runtime**: runs as non-root `node`, `NODE_ENV=production`, `PORT=3000`, `CMD ["node","dist/main.js"]` (CommonJS build because `package.json` has no `"type": "module"`). `HEALTHCHECK` polls `GET /api/v1/app/health` with Node's built-in `fetch` (the slim image has no curl/wget).
- **Config comes from env only** — `DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `VERIFY_LINE_SIGNATURE`, `LINE_CHANNEL_SECRET` must be passed at `docker run`/orchestrator level. Never bake `.env` into the image (`.dockerignore` excludes `.env*`). Do **not** set `ENV=development` in the image, otherwise TypeORM `synchronize` runs.
- `.dockerignore` excludes `node_modules`, `dist`, tests/specs, docs, `migrations/` and secrets so the build context stays small.

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
  - Every request gets `req.correlation_id` via `correlationIdMiddleware` (from `x-correlation-id` header or generated UUID), and `LoggerInterceptor` logs masked request/response **headers and bodies**:
    - Request log (`ReqInterceptor`) is written immediately with `req_headers` (masked by `src/utils/maskHeaders.ts`), `req_body` (masked by `src/utils/maskBody.ts`), and `time_diff_ms` (≈0, since it measures up to the interceptor entry). It has no `statusCode`.
    - Response log (`ResInterceptor`) is written once on `finish` (or `close` for aborted connections — a `logged` guard prevents double logging) with final `statusCode`, `res_headers`, `res_body`, `time_diff_ms` (real duration), and `error` (`{ name, message }`, `null` on success).
    - `res_body` is never `null` for failures: on `catchError` the interceptor rebuilds the error envelope (`{ ok: false, status, correlation_id, message }`) from the `HttpException` (array validation messages preserved); non-`HttpException` errors log `{ ok: false, status: 500, correlation_id, message: 'Internal server error' }`.
    - `maskHeaders` masks sensitive header values (`Authorization`, `Cookie`, `Set-Cookie`, `x-api-key`, `X-Refresh-Token`, `x-line-signature`, ...) case-insensitively as `<first 8>***<last 4>` (`***` for short values), then passes the remaining values through `maskBody` so PII in custom headers is masked too.
- **Raw Body Requirement**: `NestFactory.create(AppModule, { rawBody: true })` is required so `request.rawBody` is available for LINE webhook HMAC-SHA256 signature verification.
- **CORS (`src/common/config/cors.config.ts`)**: `main.ts` calls `app.enableCors(buildCorsOptions())` **before** the correlation-id middleware so browser clients (frontend `http://localhost:3001`) can call the API and preflight `OPTIONS` requests succeed.
  - Allowed origins come from `CORS_ORIGINS` (comma-separated, trailing slashes stripped). When unset/blank it falls back to `DEFAULT_CORS_ORIGINS`: `http://localhost:3000`, `http://127.0.0.1:3000`, `http://localhost:3001`, `http://127.0.0.1:3001`, `http://localhost:5173`, `http://127.0.0.1:5173`.
  - `CORS_ORIGINS=*` or `CORS_ALLOW_ALL=true` reflects any origin, but then `credentials` is forced to `false` (browsers reject `*` + credentials).
  - Requests without an `Origin` header (curl, server-to-server, LINE webhook, payment callback) are always allowed.
  - `allowedHeaders`: `Accept`, `Authorization`, `Content-Type`, `Origin`, `X-Requested-With`, `x-api-key`, `x-correlation-id`; `exposedHeaders`: `x-correlation-id`, `Content-Length`; `maxAge` is 24h. Add any new custom request header to `CORS_ALLOWED_HEADERS` or browsers will block it.
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
  - **Standalone admin migration (`pnpm create:admin` → `scripts/create-admin.mts`)**: runnable without booting/Nest or restarting the app. It loads `.env` (only when `DATABASE_URL`/`ADMIN_USERNAME`/`ADMIN_PASSWORD` are not already in the process env — real env wins), connects with `pg`, hashes the password with bcrypt (10 rounds), and inside one transaction: upserts the `admin` role in `apay.roles` if missing, then inserts a new `apay.users` row **or** updates the existing username (password, `role_id = admin`, `is_active = true`, `refresh_token_hash = NULL`, `updated_at = now()`). Idempotent, safe to re-run; shared logic + unit tests live in `src/database/admin-user.util.ts` / `admin-user.util.spec.ts`.
- **Tables in `TABLES` (`src/database/database-security.service.ts`)**: `roles`, `users`, `businesses`, `packages`, `business_subscriptions`, `subscription_periods`, `api_keys`, `api_key_usage_logs`, `payment_orders`, `webhook_logs`, `business_email_otps`.
- **Schema Notes**:
  - `businesses.email` (`varchar(255)`, nullable in DB, **unique** via `idx_businesses_email`) is the business contact email. It is **required** in the `POST /register-business` request (`@IsEmail`, max 255, normalized to lowercase/trimmed by `@Transform`) and is returned in the response; the column stays nullable only to support businesses created before this field existed (migrations `migrations/20261025_add_business_email.sql`, `migrations/20261025_add_business_email_otp.sql`). One email can only be bound to one business.
  - `business_email_otps` stores self-registration OTPs: `email` (`varchar(255)`), `otp_hash` (`varchar(128)`, **SHA-256 only — never the raw code**), `attempts` (`integer`, default `0`), `expires_at`, `consumed_at` (nullable), `created_at`, indexed by `idx_business_email_otps_email_created` (`email`, `created_at`).
  - `businesses.line_user_id` (`varchar(64)`, nullable, **unique**) is the LINE User ID bound to the business. It is `null` until the business completes the LINE linking flow, and a business **cannot create a payment QR** while it is `null`. One LINE User ID can only be bound to one business (unique index `idx_businesses_line_user_id`).
  - `businesses.api_key_prefix` / `businesses.api_key_hash` are **nullable legacy columns**; new API keys live in `api_keys` (multiple keys per business).
  - `payment_orders.api_key_id` is nullable and references `api_keys` with `onDelete: 'SET NULL'`.
  - `payment_orders.line_user_id` (nullable) stores the LINE User ID used for matching; `payment_orders.is_line_link` (`false` by default) marks a LINE-linking verification order. Link orders accept an optional `redirect_url` (used only for the `line.linked` callback) and are indexed by `idx_payment_orders_line_lookup`.
  - `packages` and `business_subscriptions` use `@DeleteDateColumn` (`deleted_at`) for soft delete. `api_key_usage_logs` keeps history even after an API key is soft-deleted.

## Core Business Logic

### 1. Auth & API Keys (`src/auth/`, `src/users/`, `src/business/`)
- **Roles**: `admin` and `business`. Protected routes use `@UseGuards(JwtAuthGuard, RoleGuard)` and `@Roles(...)`. `RoleGuard` verifies the user exists, is active (`user.is_active`), has a valid role in `requiredRoles`, and syncs `request.user.role` from the database.
- **Endpoints (`/api/v1/auth`)**:
  - `POST /login`: Authenticates `admin` or `business` user with username/password; verifies business `is_active` for `business` role. For `business` users the response `user` object also returns `line_user_id` (`null` when not linked yet) so the frontend knows whether to start the LINE linking flow.
  - `POST /register-business` (`admin` only): Creates a `User` (`role = business`), a `Business`, and (optionally) the initial Master Package assignment — **all inside one TypeORM `DataSource.transaction`** (`manager` is passed to `SubscriptionsService.assignOrChangePackage`), so any failure (duplicate username, missing role, invalid/inactive `package_id`) rolls back everything. No API key is created at registration. Requires `email` (valid email, max 255) and accepts optional `line_destination` and `line_user_id`. Returns `{ user_id, username, role, business_id, business_name, email, promptpay_id, line_user_id }`.
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
  - `POST /line/link-qr` (`business`, `admin`): Creates a LINE-linking verification order (`is_line_link = true`) with a total amount between **0.01 and 0.99** (`base_amount = 0`, `decimal_ref` allocated from `0.01`–`0.99`). It does **not** check quota/rate limit, does **not** write usage logs, and does not attach an `api_key_id`. **Optional body** `{ redirect_url }` (`CreateLinkQrDto`, `@IsUrl({ require_tld: false })`, max 2048): when the QR is paid the backend POSTs a `line.linked` callback to it (5s timeout, records `callback_sent` / `callback_status_code`); without it there is no callback. Throws `409 Conflict` when the business already has `line_user_id`.
  - `POST /qr` (`business`, `admin`): Creates a PromptPay QR payment order. **Requires `businesses.line_user_id` to be set** (otherwise `403 ForbiddenException('Business is not linked to a LINE user yet; ...')`), and stores it on `payment_orders.line_user_id` (`is_line_link = false`). Also requires an `ACTIVE` paid-through subscription; otherwise `403` (`PAST_DUE`/no package) or `429` (quota exhausted / hourly rate limit exceeded). If the JWT contains `api_key_id`, the key must still be active/not deleted and belong to the business, `payment_orders.api_key_id` is set, an `api_key_usage_logs` row with `action = 'QR_CREATED'`, `quota_deducted = false` is written, and `api_keys.last_used_at` is updated.
  - `GET /orders/:id` (`business`, `admin`): Returns order details including `line_user_id` and `is_line_link` (`business` users must have a valid `businessId` matching `order.business_id`, otherwise `404`).
- **LINE Linking Flow**:
  - An unlinked business calls `POST /line/link-qr` and pays the generated QR (0.01–0.99) with the KBank account whose LINE notifications are forwarded to APay. Passing `redirect_url` in the body makes the backend POST a `line.linked` callback (5s timeout) after the binding succeeds — the backoffice uses it to relay the result to the browser over SSE; polling remains the fallback.
  - When the KBank webhook arrives with a matching amount + time (`lookup_key`) and `source.userId` (required), the system binds `businesses.line_user_id = source.userId` and `payment_orders.line_user_id` to that order. If the LINE User ID is already bound to another business (or the business is already linked), the webhook is logged as `NO_MATCH` and no binding happens.
  - Verification orders are marked `PAID` but **skip quota deduction** and the `QR_PAID` usage log (they are identity verification, not revenue).
- **Order Allocation Logic (`PaymentService`)**:
  - Lazily marks any `UNVERIFIED` orders with `expires_at <= now` as `EXPIRED` before allocating.
  - Floors input `amount` (`>= 1`) to integer `base_amount` and allocates the lowest unused `decimal_ref` from `0.01` to `0.99` (`MAX_DECIMAL_REF = 99`) among active `UNVERIFIED` orders with the same `base_amount`. Throws `409 Conflict` if all 99 slots are occupied. LINE-linking orders use `base_amount = 0`, so their 0.01–0.99 slots never collide with normal orders.
  - `total_amount = base_amount + decimal_ref`. QR TTL is **5 minutes** (`QR_TTL_MS`).
  - Uses `Asia/Bangkok` (`UTC+7`, `src/common/utils/datetime.util.ts`) to construct:
    - `order.id`: `YYYYMMDDHHmmss_<total_amount.toFixed(2)>`
    - `order.lookup_key`: `YYYYMMDD_<total_amount.toFixed(2)>`
  - Generates EMVCo PromptPay payload via `promptpay-qr` using `business.promptpay_id` and `total_amount`, plus a Base64 PNG Data URL via `qrcode`.

### 6. KBank LINE Webhook & Matching (`src/webhook/`)
- **Endpoint**: `POST /api/v1/webhooks/kbank/line`
- **Signature Verification**: Checks `x-line-signature` (HMAC-SHA256 of `request.rawBody` with `LINE_CHANNEL_SECRET`) only when `VERIFY_LINE_SIGNATURE=true`.
- **Idempotency**: Ignores non-text events and deduplicates by checking `webhook_logs.line_message_id`.
- **LINE User ID is required**: Each event's `source.userId` (`lineUserId`) is mandatory for processing. An event without `source.userId` is logged as `NO_MATCH` and is never matched against an order.
- **KBank Text Parser (`src/webhook/utils/kbank-message.parser.ts`)**:
  - Extracts 2-decimal transfer amount from Thai KBank LINE notifications (keywords: `จำนวนเงิน`, `จำนวน`, `เงินเข้า`, `รับโอนเงิน`, `รับโอน`, `รับเงิน`, `โอนเข้า`).
  - Parses `DD/MM/YY(YY)` and `HH:mm` in `Asia/Bangkok` time, converting 2-digit or 4-digit Thai Buddhist Era (พ.ศ.) years to CE (`convertBuddhistYearToCE`), falling back to the LINE event timestamp if no date is in the text.
- **Order Matching, Quota Deduction & Callback (`WebhookService`)**:
  - Builds `lookupKey = "${parsed.dateStr}_${parsed.amount}"` and, inside a transaction with `pessimistic_write` lock, first queries `payment_orders` where `lookup_key = :lookupKey` **AND `line_user_id = :lineUserId`** (the LINE User ID from the event), `status = 'UNVERIFIED'`, and `expires_at >= :transferTime` (ordered by `created_at DESC`).
  - If no normal order matches, it tries the **LINE linking** match: a `payment_orders` row with `is_line_link = true`, `line_user_id IS NULL`, matching `lookup_key`/time, and whose `businesses.line_user_id IS NULL`. On match it sets `businesses.line_user_id = lineUserId` and `payment_orders.line_user_id = lineUserId`. If that LINE User ID is already linked to another business, the match is rejected (unique index protects races).
  - Logs result in `webhook_logs` with `process_status` (`MATCHED` or `NO_MATCH`).
  - On a normal match, marks order `PAID` (`paid_at = now`) and calls `subscriptions.deductQuotaOnPaid()` in the same transaction (quota is deducted only when **QR created + payment succeeded** and the subscription is still `ACTIVE` with remaining quota). LINE-linking orders are marked `PAID` without deducting quota.
  - If `order.api_key_id` is set, writes `api_key_usage_logs` (`action = 'QR_PAID'`, `quota_deducted` = result of the deduction). Orders created without an API key still deduct quota but skip the log.
  - Sends an HTTP `POST` callback (5s timeout) to `order.redirect_url` (when present), recording `callback_sent` and `callback_status_code` on the order. `event` is `payment.paid` for normal orders and `line.linked` for `is_line_link = true` orders; the payload also carries `is_line_link` so receivers can branch.

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

### 8. Self-Service Business Registration with Email OTP (`src/registration/`, `src/mail/`)
- **Endpoints (`/api/v1/auth/register-business`, public — no JWT)**:
  - `POST /request-otp` (`RequestBusinessOtpDto` = `{ email }`, normalized lowercase/trimmed): rejects an email already bound to a business (`409 Conflict`), enforces `OTP_RESEND_COOLDOWN_SECONDS` and `OTP_MAX_REQUESTS_PER_HOUR` (`429`), generates a 6-digit code, sends it through `MailService` and stores only its SHA-256 hash with `expires_at = now + OTP_TTL_MINUTES`. Any previous unconsumed OTP for that email is marked consumed (invalidated). Returns `{ email, expires_in, resend_available_in }` — never the code. If SMTP is not configured or sending fails, responds `503` and stores nothing.
  - `POST /verify-otp` (`VerifyBusinessOtpDto` = `RegisterBusinessDto` + `otp` 6 digits): validates the latest unconsumed OTP (must exist, not expired, `attempts < OTP_MAX_ATTEMPTS`), compares the SHA-256 hash with `safeCompare` (a wrong code increments `attempts` and returns `400`; exceeding the limit returns `429`), re-checks the email is not taken (`409`), then delegates to `AuthService.registerBusiness()` (same transaction/package logic as the admin endpoint) and marks the OTP `consumed_at` **only after** the account is created. Returns the same payload as `POST /auth/register-business`.
- **`MailService` (`src/mail/`)**: lazily builds a `nodemailer` transporter from `SMTP_*` env vars (10s connection/greeting/socket timeouts), sends Thai text + HTML OTP emails, logs send failures (never the code) and throws `ServiceUnavailableException` (`503`). `MailModule` exports the service for `RegistrationModule`.
- **Cleanup**: `RegistrationService.cleanupExpiredOtps()` runs daily (`@Cron(CronExpression.EVERY_DAY_AT_3AM)`) and deletes OTP rows older than 7 days.
- **Notes**: OTP codes are never logged or persisted in plaintext; `business_email_otps` is protected by the same RLS hardening as other `apay` tables.

## Required Environment Variables

- `ENV`: Set to `development` to enable TypeORM `synchronize` (default off otherwise).
- `PORT`: HTTP server port (defaults to `3000`).
- `DATABASE_URL`: PostgreSQL connection string.
- `JWT_SECRET` / `JWT_REFRESH_SECRET`: Secrets for access and refresh tokens (`JWT_EXPIRES_IN` defaults to `15m`, `JWT_REFRESH_EXPIRES_IN` defaults to `7d`).
- `ADMIN_USERNAME` / `ADMIN_PASSWORD`: Used by `DatabaseSeederService` to seed the initial `admin` user and by `pnpm create:admin` (`scripts/create-admin.mts`) to create/update an admin user on demand.
- `VERIFY_LINE_SIGNATURE`: Set to `'true'` to enforce `x-line-signature` verification using `LINE_CHANNEL_SECRET`.
- `CORS_ORIGINS`: Comma-separated list of browser origins allowed to call the API (e.g. `http://localhost:3001,https://app.apay.com`). Defaults to the local dev origins. `*` allows any origin (forces `credentials: false`).
- `CORS_ALLOW_ALL`: Set to `'true'` as an alternative to `CORS_ORIGINS=*`.
- `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` / `SMTP_FROM_NAME`: SMTP credentials for sending self-registration OTP emails (`src/mail/mail.service.ts`). `SMTP_PORT` defaults to `587`, `SMTP_SECURE` (`'true'`) defaults to off but is forced on when the port is `465`, and `SMTP_FROM` falls back to `SMTP_USER`. If `SMTP_HOST` or the from address is missing, `POST /auth/register-business/request-otp` returns `503` ("Email service is not configured").
- `OTP_TTL_MINUTES` / `OTP_MAX_ATTEMPTS` / `OTP_RESEND_COOLDOWN_SECONDS` / `OTP_MAX_REQUESTS_PER_HOUR`: OTP policy for self-registration (defaults `10`, `5`, `60`, `5`).
