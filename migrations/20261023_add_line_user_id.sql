-- =============================================================================
-- ผูก LINE User ID เข้ากับ Business และจับคู่ Webhook ด้วย line_user_id
-- ไฟล์นี้ idempotent: รันซ้ำได้โดยไม่เกิดข้อผิดพลาด
--
-- Business ที่ยังไม่มี line_user_id จะสร้าง QR รับเงินไม่ได้ จนกว่าจะผูกสำเร็จ
-- ผ่าน QR ยืนยัน (payment_orders.is_line_link = true, ยอด 0.01 - 0.99)
-- =============================================================================

-- 1) businesses.line_user_id (nullable, 1 LINE User ผูกได้กับ 1 Business)
ALTER TABLE apay.businesses
  ADD COLUMN IF NOT EXISTS line_user_id varchar(64);

CREATE UNIQUE INDEX IF NOT EXISTS idx_businesses_line_user_id
  ON apay.businesses (line_user_id);

-- 2) payment_orders.line_user_id + is_line_link
ALTER TABLE apay.payment_orders
  ADD COLUMN IF NOT EXISTS line_user_id varchar(64);

ALTER TABLE apay.payment_orders
  ADD COLUMN IF NOT EXISTS is_line_link boolean NOT NULL DEFAULT false;

-- Order สำหรับผูก LINE ไม่มี redirect_url (ไม่ต้องยิง callback)
ALTER TABLE apay.payment_orders
  ALTER COLUMN redirect_url DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payment_orders_line_lookup
  ON apay.payment_orders (line_user_id, lookup_key, status, expires_at);

-- 3) ตรวจสอบผลลัพธ์
-- SELECT id, business_name, line_user_id FROM apay.businesses LIMIT 10;
-- SELECT id, lookup_key, line_user_id, is_line_link, status
-- FROM apay.payment_orders ORDER BY created_at DESC LIMIT 20;
