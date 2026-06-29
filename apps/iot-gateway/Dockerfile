# =============================================================================
# AIRE IoT Gateway - Node.js + MQTT Client
# =============================================================================

# --- Base stage ---
FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
WORKDIR /app

# --- Dependencies stage ---
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/iot-gateway/package.json ./apps/iot-gateway/
COPY packages/shared/package.json ./packages/shared/
RUN pnpm install --frozen-lockfile

# --- Development stage ---
FROM base AS development
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/iot-gateway/node_modules ./apps/iot-gateway/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY . .
WORKDIR /app/apps/iot-gateway
EXPOSE 4002
CMD ["pnpm", "dev"]

# --- Build stage ---
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/iot-gateway/node_modules ./apps/iot-gateway/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY . .
RUN pnpm --filter @aire/shared build && pnpm --filter @aire/iot-gateway build

# --- Production stage ---
FROM node:20-alpine AS production
WORKDIR /app

ENV NODE_ENV=production

COPY --from=build /app/apps/iot-gateway/dist ./dist
COPY --from=build /app/apps/iot-gateway/package.json ./

# Install production dependency directly (mqtt is the only runtime dep)
RUN npm install --omit=dev --ignore-scripts 2>/dev/null

EXPOSE 4002
CMD ["node", "dist/index.js"]
