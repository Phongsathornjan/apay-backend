#!/bin/bash

set -Ee

# ==================================
# Configuration
# ==================================
APP_DIR="/var/www/apay-backend"
BRANCH="main"
PM2_NAME="apay-backend"
ENVIRONMENT="PROD"

WEBHOOK_URL="https://discord.com/api/webhooks/1566363340253433856/I3oDNR378u-0cRZtKooS6voYT0BII1r_IZy2JCdPmx1tc2O6ZxixKVChUCxMtoKelLgQ"

# ==================================
# Webhook Notification
# ==================================
send_webhook() {
    local message="$1"

    curl -sS -X POST "$WEBHOOK_URL" \
        -H "Content-Type: application/json" \
        -d "{\"text\":\"$message\"}" \
        > /dev/null || echo "WARNING: Webhook notification failed"
}

# ==================================
# Error Handler
# ==================================
on_error() {
    local exit_code=$?
    local line_number=$1

    send_webhook "❌ [${ENVIRONMENT}] APay Backend Deployment FAILED! Branch: ${BRANCH} | Line: ${line_number} | Exit code: ${exit_code}"

    echo "Deployment failed at line $line_number"
    exit "$exit_code"
}

trap 'on_error $LINENO' ERR

# ==================================
# Deployment
# ==================================
echo "================================"
echo " Starting APay Backend Deploy"
echo " Environment: $ENVIRONMENT"
echo "================================"

send_webhook "🚀 [${ENVIRONMENT}] APay Backend deployment started. Branch: ${BRANCH}"

cd "$APP_DIR"

echo "[1/4] Switching to branch: $BRANCH"
git checkout "$BRANCH"

echo "[2/4] Pulling latest changes"
git pull origin "$BRANCH"

echo "[3/4] Installing dependencies"
pnpm install --frozen-lockfile

echo "[4/4] Building application"
pnpm build

echo "Restarting PM2 process: $PM2_NAME"
pm2 restart "$PM2_NAME"

echo "================================"
echo " Deploy completed successfully!"
echo "================================"

pm2 status "$PM2_NAME"

send_webhook "✅ [${ENVIRONMENT}] APay Backend deployment SUCCESS! Branch: ${BRANCH} | PM2: ${PM2_NAME}"

trap - ERR