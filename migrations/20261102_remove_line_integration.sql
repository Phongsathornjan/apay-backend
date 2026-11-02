-- =============================================================================
-- ลบฟีเจอร์ LINE integration ทั้งหมด
-- ไฟล์นี้ idempotent: รันซ้ำได้โดยไม่เกิดข้อผิดพลาด
--
-- ระบบเหลือเพียงการจับคู่รายการเงินเข้าด้วยยอดเงิน + วันเวลา (iOS Shortcut)
--
-- สิ่งที่ถูกลบ:
-- 1) businesses.line_user_id / businesses.line_destination
-- 2) payment_orders.line_user_id / payment_orders.is_line_link
-- 3) index ที่เกี่ยวข้องกับ LINE
-- 4) เปลี่ยนชื่อ webhook_logs.line_message_id -> webhook_logs.message_id
--
-- หมายเหตุ: เก็บ migrations/20261023_add_line_user_id.sql ไว้เป็นประวัติ
-- (ถ้ารัน migration ทั้งหมดจากศูนย์ ไฟล์นี้จะ drop คอลัมน์ให้เอง)
-- =============================================================================

BEGIN;

-- 1) businesses: ลบ index ก่อนแล้วจึงลบคอลัมน์
DROP INDEX IF EXISTS apay.idx_businesses_line_user_id;
DROP INDEX IF EXISTS apay.idx_businesses_line_destination;

ALTER TABLE apay.businesses
  DROP COLUMN IF EXISTS line_user_id,
  DROP COLUMN IF EXISTS line_destination;

-- 2) payment_orders: ลบ order ที่เป็น QR ยืนยันการผูก LINE ออก
--    (เป็นรายการยืนยันตัวตน ไม่ใช่รายได้จริง) ก่อนลบคอลัมน์ที่ใช้แยกประเภท
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'apay'
      AND table_name = 'payment_orders'
      AND column_name = 'is_line_link'
  ) THEN
    DELETE FROM apay.payment_orders WHERE is_line_link = true;
  END IF;
END $$;

-- 3) payment_orders: ลบ index แล้วจึงลบคอลัมน์
DROP INDEX IF EXISTS apay.idx_payment_orders_line_lookup;

ALTER TABLE apay.payment_orders
  DROP COLUMN IF EXISTS line_user_id,
  DROP COLUMN IF EXISTS is_line_link;

-- 4) webhook_logs: เปลี่ยนชื่อคอลัมน์ให้ไม่ผูกกับ LINE
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'apay'
      AND table_name = 'webhook_logs'
      AND column_name = 'line_message_id'
  ) THEN
    ALTER TABLE apay.webhook_logs
      RENAME COLUMN line_message_id TO message_id;
  END IF;
END $$;

COMMIT;
