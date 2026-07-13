# =============================================================================
# AIRE Branch Bridge Agent - Node.js + ffmpeg (standalone, own lockfile)
# Runs on the tenant LAN; holds one outbound Socket.IO connection to the cloud.
# =============================================================================

# --- Build stage ---
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# --- Production stage ---
FROM node:24-alpine AS production
WORKDIR /app
ENV NODE_ENV=production

# ffmpeg is a SYSTEM binary invoked via spawn (not an npm dependency).
RUN apk add --no-cache ffmpeg

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY --from=build /app/dist ./dist

EXPOSE 4010
CMD ["node", "dist/index.js"]
