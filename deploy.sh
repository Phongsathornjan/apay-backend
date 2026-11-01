#!/bin/bash

set -Eeuo pipefail

# ==================================
# Configuration
# ==================================
APP_DIR="/var/www/apay-backend"
BRANCH="main"
PM2_NAME="apay-backend"
ENVIRONMENT="PROD"

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
# Deployment
# ==================================
echo "================================"
echo " Starting APay Backend Deploy"
echo " Environment: $ENVIRONMENT"
echo "================================"

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

trap - ERR