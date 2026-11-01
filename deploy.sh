#!/bin/bash

set -Eeuo pipefail

# ==================================
# Configuration
# ==================================
APP_DIR="/var/www/apay-backend"
BRANCH="main"
PM2_NAME="apay-backend"
ENVIRONMENT="PROD"

# Set DISCORD_WEBHOOK_URL as environment variable

# ==================================
# Discord Webhook Notification
# ==================================
send_webhook() {
    local message="$1"

    if [[ -z "${DISCORD_WEBHOOK_URL:-}" ]]; then
        echo "WARNING: DISCORD_WEBHOOK_URL is not configured"
        return 0
    fi

    local payload
    payload=$(python3 -c \
        'import json,sys; print(json.dumps({"content":sys.argv[1]}))' \
        "$message")

    local response
    response=$(curl -sS \
        --max-time 15 \
        -X POST "$DISCORD_WEBHOOK_URL" \
        -H "Content-Type: application/json" \
        -d "$payload" \
        -w '\n%{http_code}') || {
            echo "WARNING: Discord webhook request failed"
            return 0
        }

    local http_code="${response##*$'\n'}"

    if [[ "$http_code" =~ ^2[0-9][0-9]$ ]]; then
        echo "Discord notification sent (HTTP $http_code)"
    else
        echo "WARNING: Discord webhook returned HTTP $http_code"
        echo "$response"
    fi

    return 0
}

# ==================================
# Error Handler
# ==================================
on_error() {
    local exit_code=$?
    local line_number=$1

    trap - ERR

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