# =============================================================================
# AIRE AI Service - Node.js + LLM Integration
# =============================================================================

# --- Base stage ---
FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
WORKDIR /app

# --- Dependencies stage ---
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/ai-service/package.json ./apps/ai-service/
COPY packages/shared/package.json ./packages/shared/
RUN pnpm install --frozen-lockfile

# --- Development stage ---
FROM base AS development
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/ai-service/node_modules ./apps/ai-service/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY . .
WORKDIR /app/apps/ai-service
EXPOSE 4003
CMD ["pnpm", "dev"]

# --- Build stage ---
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/ai-service/node_modules ./apps/ai-service/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY . .
RUN pnpm --filter @aire/shared build && pnpm --filter @aire/ai-service build

# --- Production stage ---
FROM node:20-alpine AS production
WORKDIR /app

ENV NODE_ENV=production

COPY --from=build /app/apps/ai-service/dist ./dist
COPY --from=build /app/apps/ai-service/package.json ./
COPY --from=build /app/apps/ai-service/node_modules ./node_modules

EXPOSE 4003
CMD ["node", "dist/main.js"]
