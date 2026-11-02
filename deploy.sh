#!/bin/bash

set -Eeuo pipefail

# ==================================
# Configuration
# ==================================
APP_DIR="/var/www/apay-backend"
BRANCH="main"
PM2_NAME="apay-backend"
ENVIRONMENT="PROD"

# Health check หลัง restart (ใช้ยืนยันว่าโค้ดใหม่ขึ้นจริง)
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/api/v1/app/health}"
HEALTH_RETRIES=15
HEALTH_INTERVAL=2

# ฉุกเฉินเท่านั้น: SKIP_MIGRATIONS=1 ./deploy.sh
SKIP_MIGRATIONS="${SKIP_MIGRATIONS:-0}"

# ==================================
# Error Handler
# ==================================
on_error() {
    local exit_code=$?
    local line_number=$1

    trap - ERR

    echo "Deployment failed at line $line_number"
    exit "$exit_code"
}

trap 'on_error $LINENO' ERR

# ==================================
# Health check
# ==================================
wait_for_health() {
    local attempt

    for attempt in $(seq 1 "$HEALTH_RETRIES"); do
        if command -v curl >/dev/null 2>&1; then
            if curl -fsS --max-time 5 "$HEALTH_URL" >/dev/null 2>&1; then
                return 0
            fi
        elif node -e "fetch(process.argv[1]).then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))" "$HEALTH_URL"; then
            return 0
        fi

        sleep "$HEALTH_INTERVAL"
    done

    return 1
}

# ==================================
# Deployment
# ==================================
echo "================================"
echo " Starting APay Backend Deploy"
echo " Environment: $ENVIRONMENT"
echo "================================"

cd "$APP_DIR"

echo "[1/6] Switching to branch: $BRANCH"
git checkout "$BRANCH"

echo "[2/6] Pulling latest changes"
git pull origin "$BRANCH"

echo "[3/6] Installing dependencies"
pnpm install --frozen-lockfile

echo "[4/6] Building application"
pnpm build

# สำคัญ: ต้อง apply migration ให้ schema ตรงกับ entity ก่อน start โค้ดใหม่
# (production ไม่มี TypeORM synchronize — ถ้าข้ามขั้นนี้จะเกิด error เช่น
#  column "message_id" does not exist และ webhook/payment จะล้มทั้งเส้น)
echo "[5/6] Running database migrations"
if [ "$SKIP_MIGRATIONS" = "1" ]; then
    echo "  WARNING: SKIP_MIGRATIONS=1 — skipped database migrations"
else
    if [ ! -f .env ]; then
        echo "  ERROR: .env not found in $APP_DIR (migrations need DATABASE_URL)"
        exit 1
    fi

    if ! pnpm migrate; then
        echo "  ERROR: database migrations failed"
        echo "  - ตรวจสอบ DATABASE_URL ใน .env (Supabase ต้องใช้ host ของ Supavisor pooler)"
        echo "  - script ต้องใช้ Node >= 22.18 (TypeScript type stripping) — repo/Docker ใช้ Node 24"
        exit 1
    fi
fi

echo "[6/6] Restarting PM2 process: $PM2_NAME"
pm2 restart "$PM2_NAME"

echo "Checking health: $HEALTH_URL"
if ! wait_for_health; then
    echo "Health check failed after $((HEALTH_RETRIES * HEALTH_INTERVAL))s"
    pm2 logs "$PM2_NAME" --nostream --lines 50 || true
    exit 1
fi

echo "================================"
echo " Deploy completed successfully!"
echo "================================"

pm2 status "$PM2_NAME"

trap - ERR
