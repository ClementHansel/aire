# =============================================================================
# AIRE Frontend - Multi-stage Dockerfile
# =============================================================================

# --- Base stage ---
FROM node:24-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
WORKDIR /app

# --- Dependencies stage ---
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/frontend/package.json ./apps/frontend/
COPY packages/shared/package.json ./packages/shared/
RUN pnpm install --frozen-lockfile

# --- Development stage ---
FROM base AS development
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/frontend/node_modules ./apps/frontend/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY . .
WORKDIR /app/apps/frontend
EXPOSE 3000
CMD ["pnpm", "dev"]

# --- Build stage ---
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/frontend/node_modules ./apps/frontend/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY . .

# NEXT_PUBLIC_* values are INLINED INTO THE BUNDLE BY `next build`, not read at
# runtime. Setting NEXT_PUBLIC_N8N_URL as a container `environment:` entry (as
# docker-compose.n8n.yml does) therefore has no effect on a production build —
# it must be present HERE, before the build runs. Without it the bundle bakes
# the code's fallback host, which is not the subpath n8n is actually served on.
ARG NEXT_PUBLIC_N8N_URL
ENV NEXT_PUBLIC_N8N_URL=${NEXT_PUBLIC_N8N_URL}

RUN pnpm --filter @aire/shared build && pnpm --filter @aire/frontend build

# --- Production stage ---
FROM node:24-alpine AS production
WORKDIR /app

ENV NODE_ENV=production

COPY --from=build /app/apps/frontend/.next/standalone ./
COPY --from=build /app/apps/frontend/.next/static ./apps/frontend/.next/static
COPY --from=build /app/apps/frontend/public ./apps/frontend/public

EXPOSE 3000
CMD ["node", "apps/frontend/server.js"]
