# APay Backend — Implementation Plan & Database Schema Specification

เอกสารนี้เป็นแผนการพัฒนาระบบ **APay Backend** (NestJS + TypeORM + PostgreSQL) อย่างละเอียด ออกแบบมาเพื่อให้ AI Agent หรือนักพัฒนาสามารถนำไป Implement ต่อได้ทันทีโดยไม่ต้องตีความเพิ่ม

---

## 1. ภาพรวมสถาปัตยกรรมและบริบทของโปรเจกต์ปัจจุบัน (Current Codebase Context)

### 1.1 Tech Stack ปัจจุบัน
- **Framework**: NestJS v12 (`@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express`)
- **ORM & Database**: TypeORM (`@nestjs/typeorm`) + PostgreSQL (`DATABASE_URL`)
- **Authentication**: `@nestjs/jwt`, `@nestjs/passport`, `passport-jwt`
- **Global Prefix & Versioning**: `/api/v1/...` (ตั้งค่าใน `src/main.ts` ด้วย `app.setGlobalPrefix('api')` และ `VersioningType.URI`)
- **Standard Response Format** (`src/common/interceptor/response.interceptor.ts`):
  ```json
  {
    "ok": true,
    "status": 200,
    "correlation_id": "uuid-or-header",
    "data": { ... }
  }
  ```
- **Standard Error Format** (`src/common/filters/exception.filter.ts`):
  ```json
  {
    "ok": false,
    "status": 400,
    "correlation_id": "uuid-or-header",
    "message": "Error message"
  }
  ```
- **Correlation ID Middleware** (`src/common/middleware/correlation-id.middleware.ts`):
  อ่านจาก Header `x-correlation-id` หากไม่มีจะสร้างด้วย `randomUUID()` และแนบไว้ที่ `req.correlation_id`

### 1.2 Packages ที่ต้องติดตั้งเพิ่ม
```bash
pnpm add pg bcrypt promptpay-qr qrcode class-validator class-transformer @nestjs/axios axios
pnpm add -D @types/bcrypt @types/qrcode
```
- `pg`: PostgreSQL driver สำหรับ TypeORM
- `bcrypt` (`@types/bcrypt`): สำหรับ Hash รหัสผ่านของ `admin` และ `business` user
- `promptpay-qr`: สร้าง EMVCo PromptPay Payload จากเบอร์โทรศัพท์/เลขประจำตัวผู้เสียภาษี และยอดเงิน
- `qrcode`: แปลง EMVCo Payload เป็นรูป QR Code (Base64 Data URL)
- `class-validator`, `class-transformer`: ตรวจสอบ DTO ขาเข้า
- `@nestjs/axios`, `axios`: สำหรับยิง HTTP Callback ไปยัง `redirect_url` ของร้านค้าเมื่อชำระเงินสำเร็จ

---

## 2. การออกแบบฐานข้อมูล (Database Schema Design)

ระบบประกอบด้วย **5 ตารางหลัก**:
1. **`roles`** — เก็บสิทธิ์การใช้งานในระบบ ปัจจุบันมี 2 ค่าคือ `'admin'` และ `'business'`
2. **`users`** — เก็บบัญชีผู้ใช้งาน (`username`, `password_hash`, `role_id`) สำหรับเข้าสู่ระบบของทั้ง `admin` และ `business`
3. **`businesses`** — เก็บข้อมูลร้านค้า (ผูกกับ `users.id`), เบอร์พร้อมเพย์, API Key (Hash) และ Refresh Token (Hash)
4. **`payment_orders`** — เก็บรายการสั่งสร้าง QR Code, ยอดเงินเต็ม, ทศนิยมอ้างอิง 2 ตำแหน่ง, ยอดรวม, `redirect_url`, สถานะ (`UNVERIFIED`, `PAID`, `EXPIRED`) และวันหมดอายุ (5 นาที)
5. **`webhook_logs`** — เก็บประวัติการรับ Webhook จาก LINE OA KBank และผลลัพธ์การยิง `redirect_url` เพื่อป้องกันการประมวลผลซ้ำ (Idempotency) และใช้ตรวจสอบย้อนหลัง (Audit Trail)

### 2.1 ER Diagram (Mermaid)
```mermaid
erDiagram
    ROLES ||--o{ USERS : "assigned_to"
    USERS ||--o| BUSINESSES : "owns"
    BUSINESSES ||--o{ PAYMENT_ORDERS : "creates"
    PAYMENT_ORDERS ||--o{ WEBHOOK_LOGS : "matched_by"

    ROLES {
        uuid id PK
        varchar(30) name UK "admin | business"
        varchar(150) description "คำอธิบายสิทธิ์ (nullable)"
        timestamptz created_at
        timestamptz updated_at
    }

    USERS {
        uuid id PK "user_id"
        varchar(100) username UK "ชื่อผู้ใช้สำหรับ Login"
        varchar(255) password_hash "bcrypt hash ของรหัสผ่าน"
        uuid role_id FK "FK -> roles.id"
        varchar(128) refresh_token_hash "SHA-256 hash ของ Refresh Token ล่าสุด (nullable)"
        boolean is_active "default true"
        timestamptz created_at
        timestamptz updated_at
    }

    BUSINESSES {
        uuid id PK "business_id"
        uuid user_id FK "FK -> users.id (unique)"
        varchar(150) business_name
        varchar(20) promptpay_id "เบอร์พร้อมเพย์ 10 หลัก หรือเลขบัตร 13 หลัก"
        varchar(24) api_key_prefix UK "เช่น apay_live_a1b2c3d4"
        varchar(128) api_key_hash "SHA-256 hash ของ API Key เต็ม"
        varchar(128) refresh_token_hash "SHA-256 hash ของ Refresh Token ล่าสุด (nullable)"
        varchar(64) line_destination "LINE Bot User ID ของร้านค้า (nullable)"
        boolean is_active "default true"
        timestamptz created_at
        timestamptz updated_at
    }

    PAYMENT_ORDERS {
        varchar(64) id PK "Format: YYYYMMDDHHmmss_<total_amount>"
        varchar(40) lookup_key "Format: YYYYMMDD_<total_amount> เช่น 20261018_100.25"
        uuid business_id FK "FK -> businesses.id"
        numeric(12_2) base_amount "ยอดเงินตั้งต้น เช่น 100.00"
        numeric(4_2) decimal_ref "ทศนิยม 2 ตำแหน่งที่ใช้เป็น ref เช่น 0.25"
        numeric(12_2) total_amount "ยอดเงินที่ต้องโอนจริง เช่น 100.25"
        text qr_payload "EMVCo PromptPay string"
        text redirect_url "URL ของร้านค้าสำหรับแจ้งผลเมื่อจ่ายสำเร็จ"
        varchar(20) status "UNVERIFIED | PAID | EXPIRED"
        boolean callback_sent "สถานะว่ายิงไปบอก redirect_url สำเร็จหรือยัง"
        int callback_status_code "HTTP Status ที่ได้รับจาก redirect_url (nullable)"
        timestamptz expires_at "created_at + 5 minutes"
        timestamptz paid_at "เวลาที่ยืนยันยอดเงินสำเร็จ (nullable)"
        timestamptz created_at
        timestamptz updated_at
    }

    WEBHOOK_LOGS {
        uuid id PK
        varchar(100) line_message_id UK "ป้องกัน LINE ส่งซ้ำ"
        varchar(64) matched_order_id FK "nullable"
        numeric(12_2) parsed_amount "ยอดเงินที่แกะได้จากข้อความ KBank"
        varchar(30) parsed_datetime "วันเวลาที่แกะได้จากข้อความ"
        jsonb raw_payload "Payload ดิบจาก LINE Webhook"
        varchar(30) process_status "MATCHED | NO_MATCH | DUPLICATE | IGNORED"
        timestamptz created_at
    }
```

### 2.2 รายละเอียดตารางและ Index สำคัญ

#### ตารางที่ 1: `roles`
| Column | Type | Constraints | คำอธิบาย |
|---|---|---|---|
| `id` | `uuid` | `PK`, Default `uuid_generate_v4()` | รหัส Role |
| `name` | `varchar(30)` | `UNIQUE, NOT NULL` | ชื่อ Role (`'admin'`, `'business'`) |
| `description` | `varchar(150)` | `NULLABLE` | คำอธิบาย Role |
| `created_at` | `timestamptz` | `DEFAULT now()` | เวลาที่สร้าง |
| `updated_at` | `timestamptz` | `DEFAULT now()` | เวลาที่แก้ไขล่าสุด |

#### ตารางที่ 2: `users`
| Column | Type | Constraints | คำอธิบาย |
|---|---|---|---|
| `id` | `uuid` | `PK`, Default `uuid_generate_v4()` | `user_id` ที่จะถูกฝังอยู่ใน JWT Token (`sub`) |
| `username` | `varchar(100)` | `UNIQUE, NOT NULL` | ชื่อผู้ใช้สำหรับ Login (ทั้ง `admin` และ `business`) |
| `password_hash` | `varchar(255)` | `NOT NULL` | รหัสผ่านที่ผ่านการ Hash ด้วย `bcrypt` |
| `role_id` | `uuid` | `FK -> roles.id, NOT NULL` | อ้างอิงสิทธิ์ของผู้ใช้ (`admin` หรือ `business`) |
| `refresh_token_hash` | `varchar(128)` | `NULLABLE` | ค่า SHA-256 Hash ของ Refresh Token ล่าสุด |
| `is_active` | `boolean` | `DEFAULT true` | สถานะเปิดใช้งานบัญชีผู้ใช้ |
| `created_at` | `timestamptz` | `DEFAULT now()` | เวลาที่สร้าง |
| `updated_at` | `timestamptz` | `DEFAULT now()` | เวลาที่แก้ไขล่าสุด |

#### ตารางที่ 3: `businesses`
| Column | Type | Constraints | คำอธิบาย |
|---|---|---|---|
| `id` | `uuid` | `PK`, Default `uuid_generate_v4()` | `business_id` ของร้านค้า |
| `user_id` | `uuid` | `FK -> users.id, UNIQUE, NOT NULL` | ผูกกับบัญชีผู้ใช้ที่มี Role เป็น `'business'` |
| `business_name` | `varchar(150)` | `NOT NULL` | ชื่อธุรกิจ/ร้านค้า |
| `promptpay_id` | `varchar(20)` | `NOT NULL` | เบอร์พร้อมเพย์ (เช่น `0812345678`) หรือเลขประจำตัว 13 หลัก |
| `api_key_prefix` | `varchar(24)` | `UNIQUE, NOT NULL` | ส่วนหน้าของ API Key สำหรับค้นหาเร็ว (เช่น `apay_live_8f9a1b2c`) |
| `api_key_hash` | `varchar(128)` | `NOT NULL` | ค่า SHA-256 Hash ของ API Key เต็ม (ไม่เก็บ Plaintext ลง DB) |
| `refresh_token_hash` | `varchar(128)` | `NULLABLE` | ค่า SHA-256 Hash ของ Refresh Token กรณีขอผ่าน API Key |
| `line_destination` | `varchar(64)` | `NULLABLE, INDEX` | `destination` จาก LINE Webhook (กรณีแยกหลายร้านค้า) |
| `is_active` | `boolean` | `DEFAULT true` | สถานะเปิดใช้งานร้านค้า |
| `created_at` | `timestamptz` | `DEFAULT now()` | เวลาที่สร้าง |
| `updated_at` | `timestamptz` | `DEFAULT now()` | เวลาที่แก้ไขล่าสุด |

#### ตารางที่ 4: `payment_orders`
| Column | Type | Constraints | คำอธิบาย |
|---|---|---|---|
| `id` | `varchar(64)` | `PK` | รหัส Order สร้างจาก `YYYYMMDDHHmmss_<total_amount>` (เช่น `20261018143025_100.25`) |
| `lookup_key` | `varchar(40)` | `NOT NULL, INDEX` | คีย์สำหรับค้นหาด้วยวันที่และยอดเงินทศนิยม: `YYYYMMDD_<total_amount>` (เช่น `20261018_100.25`) |
| `business_id` | `uuid` | `FK -> businesses.id, NOT NULL` | ร้านค้าเจ้าของรายการ |
| `base_amount` | `numeric(12,2)` | `NOT NULL` | ยอดเงินเต็มก่อนบวกทศนิยมอ้างอิง (เช่น `100.00`) |
| `decimal_ref` | `numeric(4,2)` | `NOT NULL` | เศษสตางค์ 2 ตำแหน่งที่ระบบสุ่ม/จัดสรรให้ (`0.01` ถึง `0.99`) |
| `total_amount` | `numeric(12,2)` | `NOT NULL` | ยอดเงินสุทธิที่ใช้สร้าง QR (`base_amount + decimal_ref` เช่น `100.25`) |
| `qr_payload` | `text` | `NOT NULL` | ข้อมูล EMVCo String ที่ใช้สร้าง QR Code |
| `redirect_url` | `text` | `NOT NULL` | URL ของร้านค้าที่ระบบจะยิงไปแจ้งเมื่อสถานะเปลี่ยนเป็น `PAID` |
| `status` | `varchar(20)` | `NOT NULL, DEFAULT 'UNVERIFIED'` | สถานะ: `'UNVERIFIED'`, `'PAID'`, `'EXPIRED'` |
| `callback_sent` | `boolean` | `DEFAULT false` | ยิงแจ้ง `redirect_url` สำเร็จหรือยัง |
| `callback_status_code` | `int` | `NULLABLE` | HTTP Status ที่ตอบกลับจาก `redirect_url` |
| `expires_at` | `timestamptz` | `NOT NULL` | วันเวลาหมดอายุของ QR (`created_at + 5 นาที`) |
| `paid_at` | `timestamptz` | `NULLABLE` | วันเวลาที่รับแจ้งโอนเงินสำเร็จจาก LINE Webhook |
| `created_at` | `timestamptz` | `DEFAULT now()` | วันเวลาที่สร้างรายการ |
| `updated_at` | `timestamptz` | `DEFAULT now()` | วันเวลาที่อัปเดตล่าสุด |

#### ตารางที่ 5: `webhook_logs`
| Column | Type | Constraints | คำอธิบาย |
|---|---|---|---|
| `id` | `uuid` | `PK`, Default `uuid_generate_v4()` | รหัส Log |
| `line_message_id` | `varchar(100)` | `UNIQUE, NOT NULL` | Message ID จาก LINE ป้องกันการประมวลผลซ้ำ |
| `matched_order_id` | `varchar(64)` | `FK -> payment_orders.id, NULLABLE` | Order ที่จับคู่ได้ |
| `parsed_amount` | `numeric(12,2)` | `NULLABLE` | ยอดเงินทศนิยม 2 ตำแหน่งที่ดึงได้จากข้อความ |
| `parsed_datetime` | `varchar(30)` | `NULLABLE` | วันเวลาที่ดึงได้จากข้อความ |
| `raw_payload` | `jsonb` | `NOT NULL` | ข้อมูลดิบจาก LINE Webhook |
| `process_status` | `varchar(30)` | `NOT NULL` | `'MATCHED'`, `'NO_MATCH'`, `'DUPLICATE'`, `'IGNORED'` |
| `created_at` | `timestamptz` | `DEFAULT now()` | เวลาที่บันทึก |

> **หมายเหตุเรื่องการออกแบบ `id` และ `lookup_key` ใน `payment_orders`**:
> - เวลาที่ร้านค้าสร้าง QR (เช่น `14:00:10`) กับเวลาที่ลูกค้าสแกนจ่ายจริงซึ่งปรากฏในข้อความแจ้งเตือน KBank บน LINE (เช่น `14:02:00`) **จะมีเวลา (นาที/วินาที) ต่างกันได้ไม่เกิน 5 นาที**
> - ดังนั้น:
>   - `id` ของ Order จะถูกสร้างจาก **`YYYYMMDDHHmmss_<total_amount>`** (วันที่+เวลาที่สร้าง+ยอดเงินทศนิยม 2 ตำแหน่ง เช่น `20261018140010_100.25`)
>   - `lookup_key` จะถูกสร้างจาก **`YYYYMMDD_<total_amount>`** (วันที่ตามเวลาไทย `Asia/Bangkok` + ยอดเงินทศนิยม 2 ตำแหน่ง เช่น `20261018_100.25`)
>   - เมื่อ LINE Webhook ส่งข้อความแจ้งเตือนเข้ามา ระบบจะดึง **วันที่ (`YYYYMMDD`), เวลาที่โอน (`HH:mm`), และยอดเงินที่มีทศนิยม 2 ตำแหน่ง (`100.25`)** มาสร้าง `lookup_key = 20261018_100.25` แล้วค้นหาใน DB โดยเช็คว่า `lookup_key` ตรงกัน, `status = 'UNVERIFIED'`, และเวลาที่โอนอยู่ในช่วง `created_at <= transfer_time <= expires_at` (5 นาที)

---

## 3. ระบบ Database Seeding (Seed Roles & Admin User จาก `.env`)

สร้าง `DatabaseSeederService` (`src/database/database-seeder.service.ts`) ที่ทำงานอัตโนมัติใน Lifecycle `OnApplicationBootstrap`:

1. **Seed ตาราง `roles`**:
   - ตรวจสอบว่าในตาราง `roles` มีชื่อ `'admin'` และ `'business'` หรือยัง หากยังไม่มีให้ Insert ทั้งคู่ลงฐานข้อมูลทันที
2. **Seed ผู้ใช้ `admin` เริ่มต้นจาก `.env`**:
   - อ่านค่าจาก `.env` ผ่าน `ConfigService`:
     - `ADMIN_USERNAME` (เช่น `admin`)
     - `ADMIN_PASSWORD` (เช่น `SuperSecretAdmin123!`)
   - ตรวจสอบว่าในตาราง `users` มีผู้ใช้ที่ `username = ADMIN_USERNAME` หรือยัง:
     - หากยังไม่มี: นำ `ADMIN_PASSWORD` มา Hash ด้วย `bcrypt.hash(password, 10)` แล้วสร้าง User ใหม่โดยผูก `role_id` เป็น Role `'admin'`
     - หากมีอยู่แล้ว: ข้ามการทำงาน (Idempotent) หรืออัปเดต Role ให้เป็น `'admin'` เสมอ

---

## 4. ระบบ Authentication, JWT Payload และ `GuardRole` (`RoleGuard`)

### 4.1 โครงสร้าง JWT Payload
เมื่อออก Access Token (ทั้งจากการ Login ด้วย `username/password` หรือการขอด้วย `api_key`) จะมี Payload ดังนี้:
```json
{
  "sub": "user-uuid",
  "username": "admin_or_business_username",
  "role": "admin | business",
  "business_id": "business-uuid-or-null",
  "type": "access"
}
```
และใน `JwtStrategy.validate(payload)` (`src/auth/strategies/jwt.strategy.ts`) จะคืนค่าเข้าสู่ `req.user`:
```ts
return {
  userId: payload.sub,
  username: payload.username,
  role: payload.role,
  businessId: payload.business_id ?? null,
};
```

### 4.2 การทำงานของ `GuardRole` (`src/auth/guards/role.guard.ts`)
- สร้าง Custom Decorator `@Roles(...roles: ('admin' | 'business')[])` (`src/auth/decorators/roles.decorator.ts`)
- สร้าง `RoleGuard` (`CanActivate`):
  1. อ่านค่า Roles ที่ต้องการจาก `Reflector` (เช่น `['admin']`)
  2. ดึง `userId = req.user?.userId` ที่ได้จากการถอดรหัส JWT Token
  3. นำ `userId` ไป Query ในตาราง `users` พร้อม `relations: ['role']` (ตรวจทั้ง `user.is_active === true` และ `user.role.name`)
  4. หาก `user.role.name` ไม่ตรงกับสิทธิ์ที่กำหนด (เช่นไม่ใช่ `'admin'`) ให้โยน `ForbiddenException('Insufficient role permissions')`

---

## 5. รายละเอียด API Specification & Business Logic

ทุก Endpoint อยู่ภายใต้ Global Prefix `/api/v1`

---

### 5.1 Module 1: Auth, Users & Business (`src/auth/`, `src/users/`, `src/business/`)

#### 5.1.1 `POST /api/v1/auth/login`
สำหรับเข้าสู่ระบบของทั้ง **`admin`** และ **`business`** ด้วย `username` และ `password` เพื่อรับ `access_token` และ `refresh_token`

- **Authentication**: Public
- **Request Body (`LoginDto`)**:
  ```json
  {
    "username": "admin",
    "password": "SuperSecretAdmin123!"
  }
  ```
- **Step การทำงาน**:
  1. ค้นหา `User` จาก `username` พร้อม Join ตาราง `role` และ `business` (ถ้ามี)
  2. ตรวจสอบว่าพบผู้ใช้, `is_active === true`, และ `await bcrypt.compare(dto.password, user.password_hash)` เป็น `true` (หากไม่ผ่านโยน `UnauthorizedException('Invalid username or password')`)
  3. หากผู้ใช้มี Role เป็น `'business'` ให้ดึง `business.id` มาใส่ใน JWT Payload (`business_id: business.id`) หากเป็น `'admin'` ให้ `business_id: null`
  4. สร้าง `access_token` (`sub: user.id`, `role: user.role.name`, `business_id`) และ `refresh_token`
  5. บันทึก `sha256(refresh_token)` ลงใน `user.refresh_token_hash`
- **Response (`200 OK`)**:
  ```json
  {
    "ok": true,
    "status": 200,
    "correlation_id": "...",
    "data": {
      "access_token": "eyJhbGciOiJIUzI1NiIs...",
      "refresh_token": "eyJhbGciOiJIUzI1NiIs...",
      "token_type": "Bearer",
      "expires_in": 900,
      "user": {
        "user_id": "111e8400-e29b-41d4-a716-446655440000",
        "username": "admin",
        "role": "admin",
        "business_id": null
      }
    }
  }
  ```

---

#### 5.1.2 `POST /api/v1/auth/register-business`
สำหรับลงทะเบียนร้านค้าใหม่ สร้างบัญชีผู้ใช้ระดับ `business` ผูกเบอร์พร้อมเพย์ และสร้าง `api_key` **(อนุญาตเฉพาะ Role `admin` เท่านั้น)**

- **Authentication & Authorization**:
  - `@UseGuards(JwtAuthGuard, RoleGuard)`
  - `@Roles('admin')`
  - ตรวจสอบ `userId` จาก JWT Token ว่ามี Role ในฐานข้อมูลเป็น `'admin'` เท่านั้น
- **Request Body (`RegisterBusinessDto`)**:
  ```json
  {
    "username": "coffee_shop_01",
    "password": "ShopPassword123!",
    "business_name": "APay Coffee Shop",
    "promptpay_id": "0812345678",
    "line_destination": "Uxxxxxxxxxxxx"
  }
  ```
  - Validation:
    - `username`: `@IsString()`, `@IsNotEmpty()`, `@MaxLength(100)`
    - `password`: `@IsString()`, `@MinLength(8)`
    - `business_name`: `@IsString()`, `@IsNotEmpty()`, `@MaxLength(150)`
    - `promptpay_id`: `@IsString()`, `@Matches(/^(\d{10}|\d{13})$/)` (เบอร์มือถือ 10 หลัก หรือเลขบัตร/นิติบุคคล 13 หลัก)
    - `line_destination`: `@IsOptional()`, `@IsString()`
- **Step การทำงาน (ภายใต้ Database Transaction)**:
  1. `RoleGuard` ดึง `userId` จาก JWT Token ไปตรวจสอบกับตาราง `users` + `roles` ว่าเป็น `'admin'`
  2. ตรวจว่า `username` ซ้ำในตาราง `users` หรือไม่ ถ้าซ้ำโยน `ConflictException('Username already exists')`
  3. ดึง Role `'business'` จากตาราง `roles`
  4. สร้าง `User` ใหม่สำหรับร้านค้า (`username`, `password_hash = bcrypt.hash(password, 10)`, `role = businessRole`)
  5. สุ่มสร้าง `rawApiKey` รูปแบบ `apay_live_<8_hex_prefix>_<32_hex_secret>`
  6. แยก `api_key_prefix` (เช่น `apay_live_1a2b3c4d`) และคำนวณ `api_key_hash = sha256(rawApiKey)`
  7. บันทึกข้อมูลลงตาราง `businesses` โดยผูก `user_id = newUser.id`
  8. ส่งคืน `user_id`, `business_id`, `username`, และ `api_key` (แสดงเฉพาะครั้งแรกครั้งเดียว)
- **Response (`201 Created`)**:
  ```json
  {
    "ok": true,
    "status": 201,
    "correlation_id": "...",
    "data": {
      "user_id": "222e8400-e29b-41d4-a716-446655440000",
      "username": "coffee_shop_01",
      "role": "business",
      "business_id": "550e8400-e29b-41d4-a716-446655440000",
      "business_name": "APay Coffee Shop",
      "promptpay_id": "0812345678",
      "api_key": "apay_live_1a2b3c4d_9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c"
    }
  }
  ```

---

#### 5.1.3 `POST /api/v1/auth/token`
แลก `api_key` เป็น `access_token` และ `refresh_token` (สำหรับ Server-to-Server ของร้านค้า)

- **Authentication**: Public (ใช้ `api_key`)
- **Request Body (`GetTokenDto`)**:
  ```json
  {
    "api_key": "apay_live_1a2b3c4d_9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c"
  }
  ```
  *(หมายเหตุ: รองรับการส่งผ่าน Header `x-api-key` หรือใน Body `api_key`)*
- **Step การทำงาน**:
  1. ตัดเอา `api_key_prefix` จาก `api_key` เพื่อค้นหา `Business` (พร้อม Join `user` และ `user.role`) ที่ `is_active = true`
  2. นำ `api_key` ทั้งเส้นมาทำ `sha256` แล้วเปรียบเทียบกับ `business.api_key_hash` ด้วย `crypto.timingSafeEqual`
  3. หากถูกต้อง สร้าง JWT 2 ตัว:
     - **Access Token**: Payload `{ sub: business.user_id, username: business.user.username, role: 'business', business_id: business.id, type: 'access' }`, อายุ `15m`
     - **Refresh Token**: Payload `{ sub: business.user_id, business_id: business.id, role: 'business', type: 'refresh', jti: randomUUID() }`, อายุ `7d`
  4. นำ `refresh_token` มาทำ `sha256` แล้วอัปเดตลง `business.refresh_token_hash` และ `user.refresh_token_hash`
- **Response (`200 OK`)**:
  ```json
  {
    "ok": true,
    "status": 200,
    "correlation_id": "...",
    "data": {
      "access_token": "eyJhbGciOiJIUzI1NiIs...",
      "refresh_token": "eyJhbGciOiJIUzI1NiIs...",
      "token_type": "Bearer",
      "expires_in": 900
    }
  }
  ```

---

#### 5.1.4 `POST /api/v1/auth/refresh`
ต่ออายุ Token ด้วย `refresh_token` (ใช้ได้ทั้ง `admin` และ `business`)

- **Authentication**: Public (ตรวจสอบ `refresh_token`)
- **Request Body (`RefreshTokenDto`)**:
  ```json
  {
    "refresh_token": "eyJhbGciOiJIUzI1NiIs..."
  }
  ```
- **Step การทำงาน**:
  1. Verify JWT ด้วย `JWT_REFRESH_SECRET` และตรวจว่า `payload.type === 'refresh'`
  2. ค้นหา `User` จาก `payload.sub` (`userId`) พร้อม `role` และ `business`
  3. ตรวจว่า `sha256(refresh_token)` ตรงกับ `user.refresh_token_hash` (หรือ `business.refresh_token_hash`)
  4. ออก `access_token` ใหม่ และ `refresh_token` ใหม่ (Token Rotation) พร้อมบันทึก `refresh_token_hash` ใหม่ลง DB
- **Response (`200 OK`)**: เหมือน `/api/v1/auth/token`

---

### 5.2 Module 2: Payments / QR Code Generation (`src/payment/`)

#### 5.2.1 `POST /api/v1/payments/qr`
สร้าง QR Code พร้อมเพย์จาก `business_id` ใน JWT Token โดยบวกเศษสตางค์ `.01`–`.99` อัตโนมัติเพื่อใช้อ้างอิงการโอน และมีอายุ 5 นาที

- **Authentication**: `Bearer <access_token>` (`@UseGuards(JwtAuthGuard, RoleGuard)`, `@Roles('business', 'admin')`)
- **Request Body (`CreateQrDto`)**:
  ```json
  {
    "amount": 100,
    "redirect_url": "https://merchant.example.com/api/payment/callback"
  }
  ```
  - Validation:
    - `amount`: `@IsNumber()`, `@Min(1)`
    - `redirect_url`: `@IsUrl({ require_tld: false })`, `@IsNotEmpty()`
- **Step การทำงาน (Business Logic สำคัญ)**:
  1. **ดึง `business_id` จาก JWT Token**:
     - จาก `req.user.businessId` (หรือค้นหา `Business` จาก `req.user.userId`)
     - ค้นหาข้อมูลร้านค้าในตาราง `businesses` เพื่อดึง `promptpay_id` หากไม่พบหรือ `is_active = false` ให้โยน `UnauthorizedException` / `NotFoundException`
  2. **เคลียร์ Order ที่หมดอายุ**:
     - อัปเดต Order ที่ `status = 'UNVERIFIED'` และ `expires_at <= NOW()` ให้กลายเป็น `status = 'EXPIRED'`
  3. **คำนวณยอดเงินทศนิยม 2 ตำแหน่ง (`.01` ถึง `.99`) ที่ไม่ซ้ำ**:
     - นำ `baseAmount = Math.floor(dto.amount)` (หรือยอดจำนวนเต็มที่ส่งมา)
     - Query หารายการ `decimal_ref` ทั้งหมดของ Order ที่ยัง `status = 'UNVERIFIED'` และ `expires_at > NOW()` และมี `base_amount = baseAmount`
     - เลือกค่าทศนิยมจาก `0.01` ถึง `0.99` ที่ยังว่างอยู่
     - หาก `.01`–`.99` ของยอด `baseAmount` นั้นถูกใช้งานเต็มทั้งหมด 99 รายการพร้อมกันภายใน 5 นาที ให้โยน `ConflictException('No available decimal reference slot for this amount, please retry shortly')`
     - คำนวณ `totalAmount = Number((baseAmount + decimalRef).toFixed(2))` (เช่น `100 + 0.25 = 100.25`)
  4. **สร้าง Key และ ID จากวันที่ เวลา และยอดทศนิยม 2 ตำแหน่ง**:
     - ใช้เวลาโซน `Asia/Bangkok` (`UTC+7`)
     - `dateStr` = `YYYYMMDD` (เช่น `20261018`)
     - `timeStr` = `HHmmss` (เช่น `143025`)
     - `amountStr` = `totalAmount.toFixed(2)` (เช่น `100.25`)
     - `id` = `${dateStr}${timeStr}_${amountStr}` (เช่น `20261018143025_100.25`)
     - `lookup_key` = `${dateStr}_${amountStr}` (เช่น `20261018_100.25`)
     - `expires_at` = `new Date(now.getTime() + 5 * 60 * 1000)` (5 นาที)
  5. **สร้าง PromptPay QR Code**:
     - ใช้ `generatePayload(business.promptpay_id, { amount: totalAmount })` จากไลบรารี `promptpay-qr`
     - ใช้ `QRCode.toDataURL(payload)` จากไลบรารี `qrcode` เพื่อสร้าง Base64 PNG Data URL
  6. **บันทึกลงตาราง `payment_orders`** ด้วย `status = 'UNVERIFIED'`
- **Response (`201 Created`)**:
  ```json
  {
    "ok": true,
    "status": 201,
    "correlation_id": "...",
    "data": {
      "order_id": "20261018143025_100.25",
      "lookup_key": "20261018_100.25",
      "base_amount": 100,
      "decimal_ref": 0.25,
      "total_amount": 100.25,
      "qr_payload": "00020101021229370016A000000677010111011300668123456785802TH53037645406100.256304XXXX",
      "qr_image": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...",
      "status": "UNVERIFIED",
      "redirect_url": "https://merchant.example.com/api/payment/callback",
      "expires_at": "2026-10-18T07:35:25.000Z"
    }
  }
  ```

---

#### 5.2.2 `GET /api/v1/payments/orders/:id` (เสริมสำหรับเช็คสถานะ Order)
- **Authentication**: `Bearer <access_token>` (`@UseGuards(JwtAuthGuard)`)
- **หน้าที่**: ให้ร้านค้าหรือหน้าชำระเงินสามารถตรวจสอบสถานะของ Order (`UNVERIFIED` / `PAID` / `EXPIRED`) ได้ตลอดเวลา

---

### 5.3 Module 3: Webhook / Callback Endpoint สำหรับ LINE OA KBank (`src/webhook/`)

#### 5.3.1 `POST /api/v1/webhooks/kbank/line`
รับ Webhook จาก LINE Messaging API เมื่อมีข้อความแจ้งเตือนเงินเข้าจาก KBank Parse ยอดเงินและวันเวลา สร้าง Key ค้นหา Order ใน DB ปรับสถานะเป็น `PAID` และยิงแจ้งไปยัง `redirect_url` ของร้านค้า

- **Authentication / Security**:
  - ตรวจสอบ Header `x-line-signature` ด้วย HMAC-SHA256 กับ `LINE_CHANNEL_SECRET` (สามารถเปิด/ปิดการตรวจ Signature ในโหมด `development` ผ่าน Env `VERIFY_LINE_SIGNATURE=false` เพื่อความสะดวกในการยิง `curl` ทดสอบ)
- **ตัวอย่าง Request Body จาก LINE Messaging API**:
  ```json
  {
    "destination": "Uxxxxxxxxxxxx",
    "events": [
      {
        "type": "message",
        "message": {
          "type": "text",
          "id": "468789012345678901",
          "text": "รายการเงินเข้า\nบัญชี xxx-x-x1234-x\nจำนวน 100.25 บาท\nวันที่ 18/10/69 เวลา 14:32 น."
        },
        "timestamp": 1792308720000,
        "source": {
          "type": "user",
          "userId": "Uyyyyyyyyyyyy"
        }
      }
    ]
  }
  ```
- **Step การทำงาน (Business Logic สำคัญ)**:
  1. **วนลูปประมวลผล `events` เฉพาะ `event.type === 'message'` และ `event.message.type === 'text'`**:
  2. **Idempotency Check**:
     - ตรวจว่า `event.message.id` เคยถูกบันทึกใน `webhook_logs` แล้วหรือยัง ถ้ามีแล้วให้ข้ามเพื่อป้องกัน LINE ส่งซ้ำ
  3. **การแกะข้อความแจ้งเตือน KBank (KBank Text Parser)**:
     - **ดึงยอดเงินทศนิยม 2 ตำแหน่ง (`total_amount`)**:
       - รองรับแพทเทิร์นข้อความ KBank เช่น:
         - `(?:จำนวน|เงินเข้า|รับโอนเงิน|จำนวนเงิน)\s*([0-9,]+\.\d{2})\s*(?:บาท|THB)?`
         - Fallback: ดึงตัวเลขที่มีทศนิยม 2 ตำแหน่ง `([0-9,]+\.\d{2})` จากข้อความที่มีคำว่า `"เงินเข้า"` หรือ `"รับโอน"`
       - ลบลูกน้ำ `,` ออกและแปลงเป็นทศนิยม 2 ตำแหน่ง เช่น `"100.25"`
     - **ดึงวันที่และเวลา (`date`, `time`)**:
       - พยายามแกะจากข้อความ เช่น `วันที่ 18/10/69 เวลา 14:32` (แปลง พ.ศ. 2 หลัก/4 หลัก เป็น ค.ศ. `YYYYMMDD`)
       - หากในข้อความไม่มีวันที่หรือแกะไม่ได้ ให้ใช้ `event.timestamp` (จาก LINE Event) แปลงเป็นเวลาไทย (`Asia/Bangkok`) ในรูปแบบ `YYYYMMDD` และ `HH:mm`
  4. **การสร้าง Key และค้นหา Order ใน DB**:
     - สร้าง `lookupKey = "${dateStr}_${amountStr}"` เช่น `"20261018_100.25"`
     - ค้นหาในตาราง `payment_orders` ด้วยเงื่อนไข:
       ```sql
       WHERE lookup_key = :lookupKey
         AND status = 'UNVERIFIED'
         AND expires_at >= :transferTimestamp
       ORDER BY created_at DESC
       LIMIT 1
       ```
       *(ใช้ Pessimistic Write Lock `FOR UPDATE` ภายใน Database Transaction เพื่อป้องกัน Race Condition)*
  5. **การอัปเดตสถานะเป็น `PAID`**:
     - หากพบ Order:
       - อัปเดต `order.status = 'PAID'`
       - อัปเดต `order.paid_at = new Date()`
       - บันทึก `webhook_logs` โดยผูก `matched_order_id = order.id` และ `process_status = 'MATCHED'`
     - หากไม่พบ Order (หรือหมดอายุไปแล้วเกิน 5 นาที):
       - บันทึก `webhook_logs` ด้วย `process_status = 'NO_MATCH'`
  6. **การยิงกลับไปยัง `redirect_url` ของร้านค้า**:
     - นำ `order.redirect_url` ที่บันทึกไว้ใน Order มายิง HTTP POST (ผ่าน `@nestjs/axios` / `HttpService`) พร้อมแนบ Payload แจ้งผลการชำระเงิน:
       ```json
       {
         "ok": true,
         "event": "payment.paid",
         "order_id": "20261018143025_100.25",
         "lookup_key": "20261018_100.25",
         "business_id": "550e8400-e29b-41d4-a716-446655440000",
         "base_amount": 100,
         "decimal_ref": 0.25,
         "total_amount": 100.25,
         "status": "PAID",
         "paid_at": "2026-10-18T07:32:00.000Z"
       }
       ```
     - อัปเดต `order.callback_sent = true` และ `order.callback_status_code = response.status`
     - ใช้ `try/catch` และกำหนด Timeout (เช่น `5000ms`) เพื่อไม่ให้กรณีเซิร์ฟเวอร์ร้านค้าล่มทำให้การตอบกลับ `200 OK` ไปหา LINE Webhook ล้มเหลว

---

## 6. โครงสร้างไฟล์ที่จะสร้าง/แก้ไข (Target Directory Structure)

```text
src/
├── main.ts                                         # เพิ่ม ValidationPipe + Global HttpErrorFilter
├── app.module.ts                                   # Import UsersModule, BusinessModule, PaymentModule, WebhookModule, DatabaseSeederModule
├── common/
│   ├── filters/
│   │   └── exception.filter.ts                     # (มีอยู่แล้ว)
│   ├── interceptor/
│   │   ├── logger.interceptor.ts                   # (มีอยู่แล้ว)
│   │   └── response.interceptor.ts                 # (มีอยู่แล้ว)
│   └── middleware/
│       └── correlation-id.middleware.ts            # (มีอยู่แล้ว)
├── database/
│   ├── database.module.ts                          # Module สำหรับรัน Seeder ตอน Bootstrap
│   └── database-seeder.service.ts                  # Seed ตาราง roles ('admin', 'business') + Seed Admin User จาก .env
├── users/
│   ├── users.module.ts                             # Module จัดการผู้ใช้และสิทธิ์
│   ├── users.service.ts                            # ค้นหา/สร้าง User, ตรวจสอบ Role จาก userId
│   └── entities/
│       ├── role.entity.ts                          # TypeORM Entity: roles
│       └── user.entity.ts                          # TypeORM Entity: users
├── business/
│   ├── business.module.ts                          # Module จัดการข้อมูลร้านค้า
│   ├── business.service.ts                         # CRUD & ค้นหาร้านค้าด้วย api_key_prefix / id / user_id
│   └── entities/
│       └── business.entity.ts                      # TypeORM Entity: businesses
├── auth/
│   ├── auth.module.ts                              # (อัปเดต) ใช้ JwtModule.registerAsync + import UsersModule, BusinessModule
│   ├── auth.controller.ts                          # POST /login, POST /register-business, POST /token, POST /refresh
│   ├── auth.service.ts                             # Logic Login (admin/business), สร้าง API Key, ออก JWT, Refresh Token
│   ├── decorators/
│   │   └── roles.decorator.ts                      # @Roles('admin', 'business')
│   ├── dto/
│   │   ├── login.dto.ts
│   │   ├── register-business.dto.ts
│   │   ├── get-token.dto.ts
│   │   └── refresh-token.dto.ts
│   ├── guards/
│   │   ├── jwt-auth.guard.ts                       # (มีอยู่แล้ว)
│   │   └── role.guard.ts                           # GuardRole ตรวจสอบ userId จาก JWT Token กับตาราง users/roles
│   └── strategies/
│       └── jwt.strategy.ts                         # (อัปเดต) คืนค่า { userId, username, role, businessId }
├── payment/
│   ├── payment.module.ts                           # Module สร้าง QR และจัดการ Payment Orders
│   ├── payment.controller.ts                       # POST /payments/qr, GET /payments/orders/:id
│   ├── payment.service.ts                          # Logic สุ่มทศนิยม .01-.99, สร้าง PromptPay QR, เช็ควันหมดอายุ 5 นาที
│   ├── dto/
│   │   └── create-qr.dto.ts
│   └── entities/
│       └── payment-order.entity.ts                 # TypeORM Entity: payment_orders
└── webhook/
    ├── webhook.module.ts                           # Module รับ LINE Webhook (KBank)
    ├── webhook.controller.ts                       # POST /webhooks/kbank/line
    ├── webhook.service.ts                          # แกะข้อความ KBank, ค้นหา Order, ปรับ status=PAID, ยิง redirect_url
    ├── utils/
    │   └── kbank-message.parser.ts                 # Regex Parser แยกยอดเงินและวันเวลาจากข้อความ LINE KBank
    └── entities/
        └── webhook-log.entity.ts                   # TypeORM Entity: webhook_logs
```

---

## 7. แผนการ Implement แบบ Step-by-Step (Implementation Sprints)

### Phase 1: พื้นฐานระบบ, Dependencies, และ Environment Config
1. **Task 1.1**: ติดตั้ง Dependencies (`pg`, `bcrypt`, `promptpay-qr`, `qrcode`, `class-validator`, `class-transformer`, `@nestjs/axios`, `axios`, `@types/bcrypt`, `@types/qrcode`)
2. **Task 1.2**: กำหนดตัวแปรใน `.env` และ `.env.example`:
   ```env
   ENV=development
   PORT=3000
   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/apay
   JWT_SECRET=super-secret-access-key
   JWT_EXPIRES_IN=15m
   JWT_REFRESH_SECRET=super-secret-refresh-key
   JWT_REFRESH_EXPIRES_IN=7d
   ADMIN_USERNAME=admin
   ADMIN_PASSWORD=SuperSecretAdmin123!
   LINE_CHANNEL_SECRET=your-line-channel-secret
   VERIFY_LINE_SIGNATURE=false
   ```
3. **Task 1.3**: อัปเดต `src/main.ts`:
   - ลงทะเบียน `app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))`
   - ลงทะเบียน `app.useGlobalFilters(new HttpErrorFilter())` เพื่อให้ Error Response มีรูปแบบ `{ ok: false, status, correlation_id, message }`

### Phase 2: Database Entities & Seeder (`roles`, `users`, `businesses`, `payment_orders`, `webhook_logs`)
1. **Task 2.1**: สร้าง `src/users/entities/role.entity.ts` และ `src/users/entities/user.entity.ts`
2. **Task 2.2**: สร้าง `src/business/entities/business.entity.ts` (ผูก `OneToOne` กับ `User`)
3. **Task 2.3**: สร้าง `src/payment/entities/payment-order.entity.ts` พร้อม Index บน `(lookup_key, status, expires_at)` และ `(business_id, status, expires_at)`
4. **Task 2.4**: สร้าง `src/webhook/entities/webhook-log.entity.ts`
5. **Task 2.5**: สร้าง `DatabaseSeederService` (`OnApplicationBootstrap`) เพื่อ Seed Role `'admin'`, `'business'` และสร้างผู้ใช้ Admin เริ่มต้นจาก `ADMIN_USERNAME` และ `ADMIN_PASSWORD` ใน `.env`
6. **Task 2.6**: อัปเดต `TypeOrmModule.forRootAsync` ใน `src/app.module.ts` ให้ใช้ `autoLoadEntities: true`

### Phase 3: ระบบ Auth, Login (Admin/Business), `RoleGuard` & Business Registration
1. **Task 3.1**: สร้าง `UsersModule`, `UsersService`, `BusinessModule`, และ `BusinessService`
2. **Task 3.2**: อัปเดต `src/auth/strategies/jwt.strategy.ts` ให้ส่งคืน `{ userId: payload.sub, username: payload.username, role: payload.role, businessId: payload.business_id }`
3. **Task 3.3**: สร้าง `@Roles()` Decorator และ `RoleGuard` (`src/auth/guards/role.guard.ts`) ที่นำ `req.user.userId` ไปเช็ค Role จาก DB
4. **Task 3.4**: สร้าง `AuthService` และ `AuthController` (`version: '1'`, `path: 'auth'`):
   - `POST /api/v1/auth/login` — Login ด้วย `username` & `password` สำหรับทั้ง `admin` และ `business`
   - `POST /api/v1/auth/register-business` — ป้องกันด้วย `@UseGuards(JwtAuthGuard, RoleGuard)` และ `@Roles('admin')`
   - `POST /api/v1/auth/token` — ขอ Token ด้วย `api_key`
   - `POST /api/v1/auth/refresh` — ต่ออายุ Token ด้วย `refresh_token`

### Phase 4: ระบบสร้าง PromptPay QR Code & Decimal Reference
1. **Task 4.1**: สร้าง `PaymentService`:
   - ฟังก์ชัน `allocateDecimalRef(businessId, baseAmount)`: ค้นหาเศษทศนิยม `.01`–`.99` ที่ยังไม่ถูกใช้ใน Order ที่ `status = 'UNVERIFIED'` และยังไม่หมดอายุ (`expires_at > NOW()`)
   - ฟังก์ชัน `createQrOrder(businessId, dto)`:
     - ดึง `promptpay_id` ของ `businessId`
     - คำนวณ `totalAmount = baseAmount + decimalRef`
     - สร้าง `id` (`YYYYMMDDHHmmss_<totalAmount>`) และ `lookup_key` (`YYYYMMDD_<totalAmount>`)
     - สร้าง EMVCo QR Payload ด้วย `promptpay-qr` และแปลงเป็น Base64 PNG ด้วย `qrcode`
     - ตั้งเวลาหมดอายุ `expires_at = now + 5 minutes`
     - บันทึก Order ด้วย `status = 'UNVERIFIED'`
2. **Task 4.2**: สร้าง `PaymentController` (`version: '1'`, `path: 'payments'`):
   - `POST /api/v1/payments/qr` (ป้องกันด้วย `@UseGuards(JwtAuthGuard)`)
   - `GET /api/v1/payments/orders/:id` (ป้องกันด้วย `@UseGuards(JwtAuthGuard)`)

### Phase 5: ระบบรับ LINE KBank Webhook & Callback Redirect
1. **Task 5.1**: สร้าง `src/webhook/utils/kbank-message.parser.ts`:
   - ฟังก์ชัน `parseKBankMessage(text: string, fallbackTimestamp?: number)` คืนค่า `{ amount: string, dateStr: string, transferTime: Date } | null`
   - เขียน Unit Test ทดสอบข้อความแจ้งเตือน KBank หลายรูปแบบ
2. **Task 5.2**: สร้าง `WebhookService`:
   - ตรวจสอบ `line_message_id` ซ้ำ
   - สร้าง `lookup_key = "${dateStr}_${amount}"`
   - ค้นหา Order ที่ `lookup_key` ตรงกัน, `status = 'UNVERIFIED'`, และยังไม่หมดอายุ (`expires_at >= transferTime`)
   - อัปเดต `status = 'PAID'`, `paid_at = NOW()`
   - ยิง HTTP POST ไปที่ `order.redirect_url` พร้อมข้อมูล Order และบันทึก `callback_sent`, `callback_status_code`
3. **Task 5.3**: สร้าง `WebhookController` (`version: '1'`, `path: 'webhooks'`):
   - `POST /api/v1/webhooks/kbank/line`

---

## 8. ตัวอย่าง `curl` สำหรับทดสอบครบทุก Flow (End-to-End Verification)

### ขั้นที่ 1: Admin Login (ใช้ Username/Password ที่ถูก Seed จาก `.env`)
```bash
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "username": "admin",
    "password": "SuperSecretAdmin123!"
  }'
```
*(จะได้ `ADMIN_ACCESS_TOKEN` กลับมา)*

### ขั้นที่ 2: Admin ลงทะเบียนธุรกิจใหม่ (ตรวจสิทธิ์เฉพาะ `admin` ด้วย `RoleGuard`)
```bash
curl -X POST http://localhost:3000/api/v1/auth/register-business \
  -H "Authorization: Bearer <ADMIN_ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "coffee_shop_01",
    "password": "ShopPassword123!",
    "business_name": "APay Demo Store",
    "promptpay_id": "0812345678"
  }'
```
*(จะได้ `api_key` และบัญชี `coffee_shop_01` ที่มี Role `business` กลับมา)*

### ขั้นที่ 3: ร้านค้าขอ Token (เลือกได้ 2 วิธี: Login ด้วยรหัสผ่าน หรือใช้ `api_key`)

**วิธีที่ 3A — Login ด้วย Username/Password ของร้านค้า**:
```bash
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "username": "coffee_shop_01",
    "password": "ShopPassword123!"
  }'
```

**วิธีที่ 3B — ขอ Token ด้วย `api_key`**:
```bash
curl -X POST http://localhost:3000/api/v1/auth/token \
  -H "Content-Type: application/json" \
  -d '{
    "api_key": "apay_live_xxxxxxxx_yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"
  }'
```

### ขั้นที่ 4: ต่ออายุ Token ด้วย `refresh_token`
```bash
curl -X POST http://localhost:3000/api/v1/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{
    "refresh_token": "<REFRESH_TOKEN>"
  }'
```

### ขั้นที่ 5: ขอสร้าง QR Code พร้อมเพย์ (กำหนดอายุ 5 นาที + สุ่มทศนิยม 2 ตำแหน่ง)
```bash
curl -X POST http://localhost:3000/api/v1/payments/qr \
  -H "Authorization: Bearer <BUSINESS_ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 100,
    "redirect_url": "https://webhook.site/your-merchant-endpoint"
  }'
```
*(สมมติระบบคืนค่า `total_amount: 100.25` และ `lookup_key: "20261018_100.25"`)*

### ขั้นที่ 6: จำลอง LINE Webhook จาก KBank แจ้งเตือนเงินเข้า `100.25` บาท
```bash
curl -X POST http://localhost:3000/api/v1/webhooks/kbank/line \
  -H "Content-Type: application/json" \
  -d '{
    "destination": "U1234567890abcdef",
    "events": [
      {
        "type": "message",
        "message": {
          "type": "text",
          "id": "msg-0001",
          "text": "รายการเงินเข้า บัญชี xxx-x-x1234-x จำนวน 100.25 บาท วันที่ 18/10/69 เวลา 14:32 น."
        },
        "timestamp": 1792308720000
      }
    ]
  }'
```
*(เมื่อยิงเสร็จ ระบบจะเปลี่ยนสถานะ Order เป็น `PAID` และยิง HTTP POST ไปยัง `redirect_url` ทันที)*
