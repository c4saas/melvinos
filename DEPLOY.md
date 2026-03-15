# MelvinOS AI — VPS Deployment Guide

Deploy MelvinOS on any VPS (Hostinger, DigitalOcean, Linode, Hetzner, etc.) running Ubuntu 22.04 or 24.04.

---

## Quick Start (automated)

```bash
# On your VPS, as root or with sudo:
export REPO_URL=https://github.com/your-username/melvinos.git
bash <(curl -fsSL https://raw.githubusercontent.com/your-username/melvinos/main/deploy.sh)
```

The script handles Docker installation, cloning, secret generation, and service startup automatically. For a first-time manual walkthrough, follow the steps below.

---

## Manual Deployment

### 1. Install Docker

```bash
# Install Docker (official script — works on Ubuntu/Debian)
curl -fsSL https://get.docker.com | sh
sudo systemctl enable --now docker

# Add your user to the docker group (avoid needing sudo for every command)
sudo usermod -aG docker $USER
newgrp docker

# Verify
docker --version
docker compose version
```

---

### 2. Get the code

```bash
git clone https://github.com/your-username/melvinos.git /opt/melvinos
cd /opt/melvinos
```

---

### 3. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and fill in **at minimum** the following:

| Variable | Description | Generate with |
|---|---|---|
| `SESSION_SECRET` | Express session signing key | `openssl rand -hex 32` |
| `API_KEY_ENCRYPTION_KEY` | Encrypt stored API keys at rest | `openssl rand -hex 32` |
| `POSTGRES_PASSWORD` | PostgreSQL container password | `openssl rand -hex 16` |
| `DATABASE_URL` | Must match POSTGRES_PASSWORD | See note below |

**Important:** `DATABASE_URL` must use `postgres` (the Docker service name) as the host:

```
DATABASE_URL=postgres://melvinos:YOUR_POSTGRES_PASSWORD@postgres:5432/melvinos
```

Add AI provider keys as needed:

```env
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GROQ_API_KEY=gsk_...
```

---

### 4. Build and start

```bash
cd /opt/melvinos

# Build the MelvinOS image and start all services
docker compose up -d --build

# Tail logs
docker compose logs -f
```

On first start MelvinOS automatically runs database migrations (`drizzle-kit push` equivalent via the startup script). You'll see log lines like:

```
melvinos  | [db] Running migrations…
melvinos  | [db] Migrations complete.
melvinos  | [server] Listening on port 3001
```

---

### 5. Create the super-admin account

```bash
docker compose exec melvinos node dist/scripts/seed-super-admin.js
# or via npm script:
docker compose exec melvinos npm run seed:super-admin
```

Follow the prompts to set the admin email and password.

---

### 6. nginx reverse proxy (recommended)

Install nginx on the host and proxy traffic to the MelvinOS container.

```bash
sudo apt install -y nginx
```

Create `/etc/nginx/sites-available/melvinos`:

```nginx
server {
    listen 80;
    server_name your-domain.com;

    # Increase body size for file uploads
    client_max_body_size 50M;

    location / {
        proxy_pass         http://127.0.0.1:3001;
        proxy_http_version 1.1;

        # WebSocket support (required for streaming + realtime voice)
        proxy_set_header   Upgrade    $http_upgrade;
        proxy_set_header   Connection "upgrade";

        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;

        proxy_read_timeout  300s;
        proxy_send_timeout  300s;
    }
}
```

Enable the site:

```bash
sudo ln -s /etc/nginx/sites-available/melvinos /etc/nginx/sites-enabled/melvinos
sudo nginx -t && sudo systemctl reload nginx
```

---

### 7. SSL with Let's Encrypt

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
# Certbot auto-patches the nginx config and sets up auto-renewal
```

---

### 8. Auto-start on reboot

Docker Compose services already restart automatically (`restart: unless-stopped`). Ensure Docker itself starts on boot:

```bash
sudo systemctl enable docker
```

---

## Updating MelvinOS

```bash
cd /opt/melvinos
git pull origin main
docker compose up -d --build
```

Database migrations run automatically on startup.

---

## Useful Commands

```bash
# View live logs
docker compose logs -f melvinos

# Open a shell inside the running container
docker compose exec melvinos sh

# Restart just the app (not the database)
docker compose restart melvinos

# Stop everything
docker compose down

# Stop and delete all data (irreversible!)
docker compose down -v

# Check service health
docker compose ps
```

---

## Troubleshooting

### Port 3001 already in use
Change `HOST_PORT` in `.env`:
```env
HOST_PORT=8080
```
Then `docker compose up -d`.

### Database connection refused
Make sure `DATABASE_URL` uses `postgres` (the service name), not `localhost`:
```env
DATABASE_URL=postgres://melvinos:YOUR_PW@postgres:5432/melvinos
```

### Build fails on `sharp` / native addons
The Dockerfile installs `python3`, `make`, and `g++` in the builder stage and rebuilds `sharp` for the correct platform. If you see build errors on ARM (e.g., Ampere / Oracle Free Tier), ensure you are using `node:20-bookworm-slim` — it includes ARM64 binaries.

### Migrations fail / tables missing
```bash
docker compose exec melvinos npm run db:push
```

---

## Directory Layout (inside container)

```
/app/
  dist/          # compiled server + client bundle
  uploads/       # user file uploads (volume-mounted)
  migrations/    # drizzle migration files
```

Persistent data lives in Docker named volumes:
- `melvinos_postgres_data` — PostgreSQL data directory
- `melvinos_uploads` — user uploaded files
