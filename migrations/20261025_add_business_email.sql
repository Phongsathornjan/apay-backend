-- =============================================================================
-- เพิ่มอีเมลติดต่อของธุรกิจ (บังคับกรอกตอนสมัครผ่าน POST /api/v1/auth/register-business)
-- ไฟล์นี้ idempotent: รันซ้ำได้โดยไม่เกิดข้อผิดพลาด
--
-- คอลัมน์เป็น nullable เพื่อรองรับธุรกิจเดิมที่สร้างไว้ก่อนมีฟิลด์นี้
-- =============================================================================

ALTER TABLE apay.businesses
  ADD COLUMN IF NOT EXISTS email varchar(255);

-- ตรวจสอบผลลัพธ์
-- SELECT id, business_name, email FROM apay.businesses LIMIT 10;
