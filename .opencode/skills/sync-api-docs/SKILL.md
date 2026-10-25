---
name: Sync API Docs
description: Mirror api-docs.html from apay-backend (source of truth) into the apay-backoffice repo and push it. Use whenever api-docs.html changes — new/changed endpoints, request/response DTOs, enums, schemas, or webhook callbacks.
---

# Sync API Docs → `apay-backoffice`

`api-docs.html` ของ repo นี้ (`apay-backend`) เป็น **source of truth** เพียงที่เดียว และต้องถูก mirror ไปยัง repo
[`Phongsathornjan/apay-backoffice`](https://github.com/Phongsathornjan/apay-backoffice) ทุกครั้งที่เปลี่ยน

## Trigger

ใช้ skill นี้เมื่อ `api-docs.html` ของ repo นี้ถูกแก้ไข ไม่ว่าจะเป็นการ:

- เพิ่ม / ลบ / แก้ endpoint
- เปลี่ยน request/response DTO, field, validation หรือ enum
- แก้ OpenAPI schema, example, หรือ webhook callback
- อัปเดตเอกสารตามกฎใน `AGENTS.md` (mandatory maintenance rule)

ต้อง sync ในงานเดียวกันทันที — ห้ามปล่อยให้เอกสารสอง repo ไม่ตรงกัน

## Target

- Repo: `https://github.com/Phongsathornjan/apay-backoffice`
- ไฟล์: `api-docs.html` ที่ repo root
- Local clone บนเครื่อง developer: `../backoffice/api-docs.html` (เทียบกับ repo นี้)

## วิธี sync

1. แก้ `api-docs.html` ใน repo นี้ให้เสร็จและตรวจเนื้อหาแล้ว (OpenAPI 3.0.3 ต้อง valid, ไม่มี endpoint/schema ตกหล่น)
2. Copy ทับไฟล์ของ `apay-backoffice` ให้เนื้อหาเหมือนกันทุกไบต์
   - PowerShell: `Copy-Item ..\apay-backend\api-docs.html ..\backoffice\api-docs.html -Force`
   - bash: `cp api-docs.html ../backoffice/api-docs.html`
3. ตรวจใน repo backoffice ด้วย `git status --short` และ `git diff --stat` ว่าเปลี่ยนเฉพาะ `api-docs.html`
   - ถ้ามีไฟล์อื่นค้างอยู่ ต้องแจ้งผู้ใช้และห้าม commit รวมโดยพลการ
4. Commit + push repo backoffice **ด้วย skill `push-github` เท่านั้น** (ลำดับ: `git status --short` → `git log --oneline -5` → รัน unit test/lint ถ้ามี → ขอ confirm จากผู้ใช้ → commit → `git pull --rebase origin <branch>` → `git push`)
5. Commit message เป็น Conventional Commits เช่น `docs: sync api-docs.html from apay-backend`

## ข้อห้าม

- ห้าม commit ไฟล์ `.env*` หรือ secrets ของ backoffice
- ห้าม `git push --force` (หรือ `--force-with-lease`) ทุกกรณี
- ห้ามแก้เนื้อหา API ใน backoffice แล้วย้อนกลับมาเขียน repo นี้ — ทิศทาง sync คือ **backend → backoffice เท่านั้น**
- ห้ามแก้ `api-docs.html` ของ backoffice ด้วยมือ ให้ copy จาก repo นี้เสมอ

## Fallback (ต้องหยุดและรายงานผู้ใช้)

หยุดทันทีและรายงานผู้ใช้ พร้อมระบุไฟล์ที่ค้าง/สาเหตุ ห้ามข้ามขั้นตอนนี้แบบเงียบๆ เมื่อ:

- ไม่มี local clone ของ `apay-backoffice`
- ไม่มีสิทธิ์ push (auth/permission error)
- เกิด conflict ตอน `git pull --rebase`
- พบว่า working tree ของ backoffice มีการแก้ไขอื่นค้างอยู่ก่อนแล้ว

## Checklist ก่อนจบงาน

- [ ] `api-docs.html` ของ repo นี้ valid และตรงกับโค้ด/DTO ล่าสุด
- [ ] copy ไป backoffice แล้วเนื้อหาเหมือนกันทุกไบต์
- [ ] `git diff --stat` ของ backoffice เปลี่ยนเฉพาะ `api-docs.html`
- [ ] commit + push ผ่าน skill `push-github` สำเร็จ (ไม่ force push)
- [ ] `AGENTS.md` ของ repo นี้ยังตรงกับโค้ดล่าสุด
