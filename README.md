# AIRE Operations Platform

Multi-tenant POS and operations management platform for car wash and automotive service businesses. AIRE provides end-to-end operational tools: point-of-sale, queue management, membership programs, automated license plate recognition, IoT device integration, AI-powered automation, and consolidated reporting — all behind a single-tenant-isolated architecture.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         NGINX (Reverse Proxy)                   │
├────────────────────────────┬────────────────────────────────────┤
│   Frontend (Next.js 15)    │     Backend (NestJS + Fastify)     │
│   React 19 / Zustand       │     REST + WebSocket APIs          │
├────────────────────────────┴────────────────────────────────────┤
│   ALPR Service   │  IoT Gateway  │  AI Service  │  Worker      │
│   (Python/Flask) │  (MQTT Bridge)│  (LLM Agent) │  (BullMQ)    │
├─────────────────────────────────────────────────────────────────┤
│   PostgreSQL  │  Redis  │  MinIO (S3)  │  Mosquitto (MQTT)      │
└─────────────────────────────────────────────────────────────────┘
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15, React 19, Zustand, TypeScript |
| Backend API | NestJS 10, Fastify, Socket.IO, TypeScript |
| Database | PostgreSQL 16 with Row-Level Security (RLS) |
| Cache/Queue | Redis 7, BullMQ |
| Object Storage | MinIO (S3-compatible) |
| IoT | Eclipse Mosquitto (MQTT), Custom Gateway |
| ALPR | Python, Flask, OpenCV |
| AI/LLM | OpenRouter / Ollama (Hermes AI) |
| Infra | Docker Compose, NGINX |
| Testing | Vitest, fast-check (property-based), Testing Library |

## Monorepo Structure

```
aire/
├── apps/
│   ├── backend/        # NestJS API server (port 4000)
│   ├── frontend/       # Next.js web app (port 3000)
│   ├── alpr/           # License plate recognition service (port 5000)
│   ├── iot-gateway/    # MQTT → WebSocket bridge (port 4002)
│   └── ai-service/     # AI/LLM orchestration service (port 4003)
├── packages/
│   └── shared/         # Shared types, constants, utilities
├── database/           # Migrations and seed scripts
├── infrastructure/     # NGINX, Mosquitto configs, SSL
├── docker-compose.yml  # Full-stack orchestration
└── package.json        # Workspace root
```

## Prerequisites

- **Node.js** >= 20.0.0
- **pnpm** >= 9.x (`npm install -g pnpm`)
- **Docker** & **Docker Compose** (for infrastructure services)
- **Python 3.11+** (for ALPR service, optional)

## Getting Started

### 1. Clone and Install

```bash
git clone <repository-url> aire
cd aire
pnpm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your configuration. At minimum, set:
- `JWT_SECRET` — a strong random string for production
- `POSTGRES_PASSWORD` — database password
- Payment gateway keys (Xendit/Midtrans/Stripe) if needed
- `WHATSAPP_API_URL` and `WHATSAPP_API_TOKEN` for notifications
- `LLM_API_KEY` if using OpenRouter for AI features

### 3. Start Infrastructure

```bash
docker compose up -d postgres redis minio mosquitto
```

### 4. Run Migrations

```bash
pnpm db:migrate
pnpm db:seed    # Optional: seed demo data
```

### 5. Start Development

```bash
# Start all apps
pnpm dev

# Or individually
pnpm --filter @aire/backend dev     # API on http://localhost:4000
pnpm --filter @aire/frontend dev    # Web on http://localhost:3000
```

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start backend + frontend in development mode |
| `pnpm build` | Build all packages for production |
| `pnpm test` | Run all test suites |
| `pnpm lint` | Lint all packages |
| `pnpm format` | Format all files with Prettier |
| `pnpm db:migrate` | Run pending database migrations |
| `pnpm db:seed` | Seed database with demo data |
| `pnpm db:reset` | Reset database (destructive) |

## Running with Docker (Production-like)

```bash
# Build and start everything
docker compose up --build -d

# View logs
docker compose logs -f backend frontend

# Stop all services
docker compose down
```

Services are available at:
- **Web App**: http://localhost (via NGINX)
- **API**: http://localhost/api
- **MinIO Console**: http://localhost:9001

## Testing

```bash
# Run all tests
pnpm test

# Run backend tests only
pnpm --filter @aire/backend test

# Run frontend tests only
pnpm --filter @aire/frontend test

# Watch mode
pnpm --filter @aire/backend test:watch
```

The test suite includes:
- **Unit tests** — Service logic, controllers, components
- **Property-based tests** — Correctness properties via fast-check (encryption, validation, state machines)
- **Integration tests** — Multi-module flows with mocked infrastructure

## Key Features

### Multi-Tenant Operations
- Tenant-isolated data via PostgreSQL RLS
- Per-tenant settings with JSON Schema validation
- Role-based access control (Platform Admin, Tenant Owner, Outlet Agent)

### Point of Sale
- Service menu with configurable pricing
- Cart management with voucher redemption
- Multi-gateway payments (Xendit, Midtrans, Stripe)
- Receipt generation and order state machine

### Membership & Loyalty
- Configurable membership plans with vehicle plate linking
- Voucher packs with auto-generated codes
- Campaign management with bonus rewards
- Expiry reminders via WhatsApp

### Queue Management
- Real-time queue board with bay assignments
- Customer self-service kiosk (queue status)
- Estimated wait time calculations

### CCTV & ALPR
- Automatic license plate recognition from CCTV feeds
- Confidence-based plate matching
- RTSP stream integration

### IoT Integration
- MQTT-based device communication
- Bay occupancy sensors
- Automatic device discovery (ONVIF, SSDP/mDNS)

### Smart Automation (AI Agent)
- Toggle-driven automation capabilities (campaigns, retention, pricing, anomaly detection)
- Human-in-the-loop approval or autonomous execution modes
- Scheduled AI analysis with LLM-powered insights
- Per-tenant LLM provider selection (OpenRouter or self-hosted Hermes AI)

### Notifications
- WhatsApp Business API integration
- Tenant-scoped credentials with global fallback
- Template-based messaging with retry logic

## Environment Variables

See [`.env.example`](.env.example) for the full list of configurable environment variables with descriptions.

## Deployment

### Production Checklist

- [ ] Set strong `JWT_SECRET` (min 32 characters)
- [ ] Set strong `POSTGRES_PASSWORD`
- [ ] Configure SSL certificates in `infrastructure/nginx/ssl/`
- [ ] Set `NODE_ENV=production`
- [ ] Configure `SETTINGS_ENCRYPTION_KEY` (32 bytes, hex-encoded) for tenant secrets
- [ ] Set up payment gateway credentials
- [ ] Configure WhatsApp Business API credentials
- [ ] Set `NEXT_PUBLIC_API_URL` to your production domain
- [ ] Enable PostgreSQL connection pooling for production load
- [ ] Set up database backups

### Infrastructure Requirements (Production)

| Service | Minimum | Recommended |
|---------|---------|-------------|
| CPU | 2 cores | 4 cores |
| RAM | 4 GB | 8 GB |
| Storage | 20 GB SSD | 50 GB SSD |
| PostgreSQL | 16.x | 16.x managed (RDS/Cloud SQL) |
| Redis | 7.x | 7.x with persistence |

## License

Proprietary. All rights reserved.
