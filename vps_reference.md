
**Old VPS IP:** `43.156.118.56` (Password: `forest-38$-storm`)

## Environment Variables (`.env`)

These are the environment variables configured on the production VPS at `/home/ubuntu/zenvix/.env`.

```env
POSTGRES_USER=zenvix
POSTGRES_PASSWORD=zenvix_secure_2026!
POSTGRES_DB=zenvix_prod
DATABASE_URL="postgresql://zenvix:zenvix_secure_2026!@db:5432/zenvix_prod?schema=public"
COMPOSE_PROJECT_NAME=bfs
NODE_ENV=production
STRIPE_SECRET_KEY=sk_test_zenvix_placeholder
STRIPE_WEBHOOK_SECRET=whsec_zenvix_placeholder
FRONTEND_URL=http://150.109.15.108:3010
VITE_API_URL=http://150.109.15.108:3001
PORT=3001
RUNTIME=docker
PERSISTENCE_MODE=db
GOOGLE_MAPS_API_KEY=placeholder
VITE_GOOGLE_MAPS_API_KEY=placeholder
```

## Panel Settings (Docker Compose)
- **Frontend Port:** `3010` (mapped to `80` internally)
- **Backend API Port:** `3001`
- **Database Port:** `5433` (mapped to `5432` internally for PostgreSQL 16)
- **Network Mode:** Docker default bridge network (`bfs_default`)

## CI/CD Settings
- **Cron Job:** `*/5 * * * * /home/ubuntu/zenvix/vps-auto-deploy.sh >> /home/ubuntu/zenvix/logs/cron.log 2>&1`
- **Deploy Script:** Runs `git pull origin main`, followed by `vps-up.sh` (which triggers `docker compose up -d --build --remove-orphans`).

## Cockpit Panel Access
Cockpit is installed and uses the system's PAM authentication.
- **URL:** `http://150.109.15.108:9090`
- **Username:** `ubuntu`
- **Password:** `ocean-65%-forest`
*(Note: Cockpit login uses the standard VPS SSH user credentials)*

## SSH Access Secrets
To connect directly via terminal, the local machine uses a specific SSH private key file rather than just the password.
- **Host:** `150.109.15.108`
- **User:** `ubuntu`
- **Identity Key File (Local Machine):** `C:\Users\user\.ssh\vps_zenvix`
- **Command:** `ssh -i "C:\Users\user\.ssh\vps_zenvix" ubuntu@150.109.15.108`
