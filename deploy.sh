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
    local status="$1"
    local title="$2"
    local description="$3"
    local color="$4"
    local branch="$5"
    local process="$6"
    local details="${7:-}"

    if [[ -z "${DISCORD_WEBHOOK_URL:-}" ]]; then
        echo "WARNING: DISCORD_WEBHOOK_URL is not configured"
        return 0
    fi

    local payload

    payload=$(python3 -c '
    import json
    import sys
    from datetime import datetime, timezone

    status, title, description, color, branch, process, details = sys.argv[1:]

    embed = {
        "title": title,
        "description": description,
        "color": int(color, 16),
        "fields": [
            {"name": "Environment", "value": "PRODUCTION", "inline": True},
            {"name": "Branch", "value": f"`{branch}`", "inline": True},
            {"name": "PM2 Process", "value": f"`{process}`", "inline": True},
        ],
        "footer": {
            "text": "APay CI/CD Deployment Monitor"
        },
        "timestamp": datetime.now(timezone.utc).isoformat()
    }

    if details:
        embed["fields"].append({
            "name": "Details",
            "value": details[:1024],
            "inline": False
        })

    print(json.dumps({
        "username": "APay Deployment Monitor",
        "embeds": [embed]
    }))
    ' "$status" "$title" "$description" "$color" \
    "$branch" "$process" "$details")

    local http_code

    http_code=$(curl -sS \
        --max-time 15 \
        -o /tmp/apay-discord-response \
        -w '%{http_code}' \
        -X POST "$DISCORD_WEBHOOK_URL" \
        -H "Content-Type: application/json" \
        -d "$payload") || {
            echo "WARNING: Discord webhook request failed"
            return 0
        }

    if [[ "$http_code" =~ ^2[0-9][0-9]$ ]]; then
        echo "Discord notification sent (HTTP $http_code)"
    else
        echo "WARNING: Discord webhook returned HTTP $http_code"
        cat /tmp/apay-discord-response
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

    send_webhook \
        "FAILED" \
        "❌ Deployment Failed" \
        "APay Backend deployment encountered an error." \
        "E74C3C" \
        "$BRANCH" \
        "$PM2_NAME" \
        "Line: ${line_number}\nExit Code: ${exit_code}"

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

send_webhook \
    "STARTED" \
    "🚀 Deployment Started" \
    "APay Backend deployment is starting..." \
    "3498DB" \
    "$BRANCH" \
    "$PM2_NAME"

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

send_webhook \
    "SUCCESS" \
    "✅ Deployment Successful" \
    "APay Backend has been successfully deployed!" \
    "2ECC71" \
    "$BRANCH" \
    "$PM2_NAME"

trap - ERR