# =============================================================================
# AIRE Backend - Multi-stage Dockerfile
# =============================================================================

# --- Base stage ---
FROM node:24-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
WORKDIR /app

# --- Dependencies stage ---
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/backend/package.json ./apps/backend/
COPY packages/shared/package.json ./packages/shared/
RUN pnpm install --frozen-lockfile

# --- Development stage ---
FROM base AS development
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/backend/node_modules ./apps/backend/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY . .
WORKDIR /app/apps/backend
EXPOSE 4000
CMD ["pnpm", "dev"]

# --- Build stage ---
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/backend/node_modules ./apps/backend/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY . .
RUN pnpm --filter @aire/shared build && pnpm --filter @aire/backend build

# --- Production stage ---
FROM node:24-alpine AS production
WORKDIR /app

ENV NODE_ENV=production

# Copy all build artifacts with workspace structure intact
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/backend/node_modules ./apps/backend/node_modules
COPY --from=build /app/apps/backend/dist ./apps/backend/dist
COPY --from=build /app/apps/backend/package.json ./apps/backend/
COPY --from=build /app/packages/shared ./packages/shared
COPY --from=build /app/package.json ./

# Replace workspace symlink with actual content for @aire/shared
RUN rm -rf /app/apps/backend/node_modules/@aire/shared 2>/dev/null; \
    rm -rf /app/node_modules/@aire/shared 2>/dev/null; \
    mkdir -p /app/node_modules/@aire && \
    cp -r /app/packages/shared /app/node_modules/@aire/shared && \
    mkdir -p /app/apps/backend/node_modules/@aire && \
    cp -r /app/packages/shared /app/apps/backend/node_modules/@aire/shared

WORKDIR /app/apps/backend
EXPOSE 4000
CMD ["node", "dist/main.js"]
