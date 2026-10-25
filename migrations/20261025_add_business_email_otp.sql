-- =============================================================================
-- สมัครบัญชีธุรกิจด้วยตัวเอง + ยืนยันอีเมลด้วย OTP
-- ไฟล์นี้ idempotent: รันซ้ำได้โดยไม่เกิดข้อผิดพลาด
--
-- 1) ตาราง apay.business_email_otps เก็บ SHA-256 hash ของ OTP (ไม่เก็บรหัสจริง)
-- 2) unique index บน businesses.email (1 อีเมลผูกได้กับ 1 ธุรกิจ)
--    NULL หลายแถวได้ตามปกติของ PostgreSQL จึงไม่กระทบธุรกิจเดิมที่ยังไม่มีอีเมล
-- =============================================================================

CREATE TABLE IF NOT EXISTS apay.business_email_otps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email varchar(255) NOT NULL,
  otp_hash varchar(128) NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_business_email_otps_email_created
  ON apay.business_email_otps (email, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_businesses_email
  ON apay.businesses (email);

-- ตรวจสอบผลลัพธ์
-- SELECT id, email, attempts, expires_at, consumed_at
-- FROM apay.business_email_otps ORDER BY created_at DESC LIMIT 10;
