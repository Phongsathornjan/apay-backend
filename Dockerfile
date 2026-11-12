# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# APay Backend (NestJS 12 + TypeORM/PostgreSQL) — multi-stage production image
# build:  docker build -t apay-backend .
# run:    docker run --rm -p 3000:3000 --env-file .env apay-backend
# ---------------------------------------------------------------------------

# ---------- base: Node + pnpm (เวอร์ชันเดียวกับที่ใช้ dev) ----------
FROM node:26-bookworm-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=true
RUN npm install -g pnpm@11.24.0
WORKDIR /app

# ---------- deps: ติดตั้ง dependency ทั้งหมด (รวม devDependencies สำหรับ build) ----------
FROM base AS deps
# bcrypt เป็น native module (postinstall) จึงต้องมี toolchain ไว้ compile ถ้าไม่มี prebuild
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

# pnpm-workspace.yaml จำเป็นเพราะเก็บ allowBuilds (bcrypt: true) ของ pnpm 11
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir=/pnpm/store

# ---------- build: compile TypeScript -> dist/ แล้วตัด devDependencies ----------
FROM deps AS build
COPY . .
RUN pnpm build && pnpm prune --prod

# ---------- runtime: image จิ๋ว ไม่มี source/toolchain/secret ----------
FROM node:26-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=3000
WORKDIR /app

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/package.json ./package.json

# รันด้วย user ที่ไม่ใช่ root (มีอยู่ใน official image)
USER node

EXPOSE 3000

# healthcheck ใช้ fetch ของ Node เอง (image slim ไม่มี curl/wget)
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/v1/app/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/main.js"]
