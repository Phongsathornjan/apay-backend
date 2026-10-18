-- =============================================================================
-- ย้ายตารางของ APay จาก public ไป schema `apay` (private) + เปิด RLS
-- ไฟล์นี้ idempotent: รันซ้ำได้โดยไม่เกิดข้อผิดพลาด
--
-- ทำไมต้องย้าย: schema `public` ถูก expose ผ่าน PostgREST ของ Supabase ทำให้
-- role `anon`/`authenticated` เข้าถึงตารางได้ (ซึ่งเป็นช่องโหว่ RLS Disabled in Public)
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS apay;

-- 1) ย้ายตารางทั้งหมดจาก public -> apay (ทำตามลำดับ parent -> child)
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'roles',
    'users',
    'businesses',
    'payment_orders',
    'webhook_logs'
  ]
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = tbl
    ) THEN
      EXECUTE format('ALTER TABLE public.%I SET SCHEMA apay', tbl);
      RAISE NOTICE 'moved public.% -> apay.%', tbl, tbl;
    END IF;
  END LOOP;
END $$;

-- 2) เปิด RLS แบบ deny-by-default ให้ทุกตารางใน apay (ไม่สร้าง policy ให้ anon/authenticated)
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'roles',
    'users',
    'businesses',
    'payment_orders',
    'webhook_logs'
  ]
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'apay' AND table_name = tbl
    ) THEN
      EXECUTE format('ALTER TABLE apay.%I ENABLE ROW LEVEL SECURITY', tbl);
    END IF;
  END LOOP;
END $$;

-- 3) ตัดสิทธิ์ anon/authenticated ออกจาก schema และ object ทั้งหมด (defense in depth)
REVOKE ALL ON SCHEMA apay FROM anon, authenticated, public;
REVOKE ALL ON ALL TABLES    IN SCHEMA apay FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA apay FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA apay FROM anon, authenticated;

-- 4) กันไม่ให้ object ที่สร้างใหม่ในอนาคตได้สิทธิ์กลับไปโดยอัตโนมัติ
ALTER DEFAULT PRIVILEGES IN SCHEMA apay REVOKE ALL ON TABLES    FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA apay REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA apay REVOKE ALL ON FUNCTIONS FROM anon, authenticated;

-- 5) ตรวจสอบผลลัพธ์
-- SELECT relname AS table_name, relrowsecurity AS rls_enabled
-- FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
-- WHERE n.nspname = 'apay' AND c.relkind = 'r' ORDER BY relname;
