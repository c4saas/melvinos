#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
#  Atlas AI — VPS Deployment Script
#  Run once on a fresh Ubuntu 22.04/24.04 VPS to bootstrap Atlas.
#  Usage: bash deploy.sh
# ─────────────────────────────────────────────────────────────────
set -euo pipefail

ATLAS_DIR="${ATLAS_DIR:-/opt/atlas}"
REPO_URL="${REPO_URL:-}"   # set via env or prompted below
BRANCH="${BRANCH:-main}"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'

log()  { echo -e "${GREEN}[Atlas]${NC} $*"; }
warn() { echo -e "${YELLOW}[Warn]${NC}  $*"; }
err()  { echo -e "${RED}[Error]${NC} $*" >&2; exit 1; }
step() { echo -e "\n${CYAN}━━━  $*  ━━━${NC}"; }

# ── Must run as root (or with sudo) ──────────────────────────────
if [[ $EUID -ne 0 ]]; then
  err "Please run as root: sudo bash deploy.sh"
fi

step "1 / 6  Install Docker"
if command -v docker &>/dev/null; then
  log "Docker already installed: $(docker --version)"
else
  log "Installing Docker via official script..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
  log "Docker installed: $(docker --version)"
fi

if ! command -v docker compose &>/dev/null 2>&1; then
  log "Installing Docker Compose plugin..."
  apt-get install -y docker-compose-plugin
fi

step "2 / 6  Clone / update repository"
if [[ -z "$REPO_URL" ]]; then
  read -rp "  Enter your Git repo URL (e.g. https://github.com/you/atlas.git): " REPO_URL
fi

if [[ -d "$ATLAS_DIR/.git" ]]; then
  log "Repository found — pulling latest changes..."
  git -C "$ATLAS_DIR" fetch origin "$BRANCH"
  git -C "$ATLAS_DIR" reset --hard "origin/$BRANCH"
else
  log "Cloning repository to $ATLAS_DIR..."
  git clone --branch "$BRANCH" "$REPO_URL" "$ATLAS_DIR"
fi

cd "$ATLAS_DIR"

step "3 / 6  Configure environment"
if [[ ! -f .env ]]; then
  log "Creating .env from .env.example..."
  cp .env.example .env

  # Auto-generate secrets
  SESSION_SECRET=$(openssl rand -hex 32)
  ENCRYPTION_KEY=$(openssl rand -hex 32)
  POSTGRES_PASSWORD=$(openssl rand -hex 16)

  sed -i "s|SESSION_SECRET=.*|SESSION_SECRET=${SESSION_SECRET}|" .env
  sed -i "s|API_KEY_ENCRYPTION_KEY=.*|API_KEY_ENCRYPTION_KEY=${ENCRYPTION_KEY}|" .env
  sed -i "s|POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${POSTGRES_PASSWORD}|" .env
  # Update DATABASE_URL to use the generated password
  sed -i "s|DATABASE_URL=.*|DATABASE_URL=postgres://atlas:${POSTGRES_PASSWORD}@postgres:5432/atlasai|" .env

  warn "Secrets generated automatically. Edit $ATLAS_DIR/.env to add API keys."
  echo ""
  echo "  Generated POSTGRES_PASSWORD=${POSTGRES_PASSWORD}"
  echo "  (already written to .env — keep this safe)"
else
  log ".env already exists — skipping generation."
fi

step "4 / 6  Build and start services"
docker compose pull postgres --quiet || true
docker compose build --pull
docker compose up -d

step "5 / 6  Wait for services to become healthy"
log "Waiting for PostgreSQL to be ready..."
for i in $(seq 1 30); do
  if docker compose exec -T postgres pg_isready -U atlas -d atlasai &>/dev/null; then
    log "PostgreSQL is ready."
    break
  fi
  sleep 2
  if [[ $i -eq 30 ]]; then
    err "PostgreSQL did not become ready in time. Check: docker compose logs postgres"
  fi
done

log "Waiting for Atlas to pass health check..."
for i in $(seq 1 30); do
  if curl -sf "http://localhost:${HOST_PORT:-3001}/api/auth/csrf-token" &>/dev/null; then
    log "Atlas is healthy."
    break
  fi
  sleep 3
  if [[ $i -eq 30 ]]; then
    warn "Atlas health check timed out. Check: docker compose logs atlas"
  fi
done

step "6 / 6  Done"
HOST_PORT=$(grep '^HOST_PORT=' .env | cut -d= -f2 || echo 3001)
echo ""
echo -e "  ${GREEN}Atlas is running!${NC}"
echo ""
echo "  Local:   http://localhost:${HOST_PORT}"
echo "  Public:  http://$(curl -sf https://checkip.amazonaws.com || echo '<your-server-ip>'):${HOST_PORT}"
echo ""
echo "  Logs:    docker compose -f $ATLAS_DIR/docker-compose.yml logs -f atlas"
echo "  Shell:   docker compose -f $ATLAS_DIR/docker-compose.yml exec atlas sh"
echo "  Stop:    docker compose -f $ATLAS_DIR/docker-compose.yml down"
echo ""
warn "For production: set up nginx + SSL (see DEPLOY.md)"
