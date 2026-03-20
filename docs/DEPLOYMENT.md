# MelvinOS — Deployment Guide

Complete guide for deploying a new MelvinOS instance (whitelabel or standard).

---

## Prerequisites

- **Docker** 24+ and **Docker Compose** v2
- **Git** (to clone the repo)
- A server with at least **2 GB RAM** and **20 GB disk**
- A domain name pointed at the server (A record)
- A reverse proxy for SSL (Nginx Proxy Manager, Caddy, etc.)

---

## Quick Start

```bash
# 1. Clone the repo
git clone git@github.com:c4saas/melvinos.git /opt/melvinos-<name>
cd /opt/melvinos-<name>

# 2. Create environment file
cp .env.example .env
# Edit .env — see "Environment Variables" section below

# 3. Customize docker-compose.yml volume names (for multi-tenant servers)
#    Replace all "melvinos_" prefixed volume names with "<name>_melvinos_"
#    Replace network name "melvinos_net" with "<name>_melvinos_net"

# 4. Create external Docker volumes
docker volume create <name>_melvinos_postgres_data
docker volume create <name>_melvinos_uploads
docker volume create <name>_melvinos_agent_workspace
docker volume create <name>_melvinos_claude_auth
docker volume create <name>_melvinos_claude_ssh

# 5. Build and start
docker compose build
docker compose up -d

# 6. Verify health
docker ps  # All containers should show "healthy" within 60 seconds
```

---

## Environment Variables

Generate all secrets before starting. Never reuse secrets across instances.

```bash
# Generate unique secrets
openssl rand -hex 32  # SESSION_SECRET
openssl rand -hex 32  # API_KEY_ENCRYPTION_KEY
openssl rand -hex 16  # POSTGRES_PASSWORD
```

### Required

| Variable | Description |
|---|---|
| `COMPOSE_PROJECT_NAME` | Unique prefix for container names (e.g. `john_melvinos`) |
| `SESSION_SECRET` | 64-char hex string — signs session cookies |
| `API_KEY_ENCRYPTION_KEY` | 64-char hex string — encrypts API keys at rest in DB |
| `POSTGRES_PASSWORD` | Database password (must match DATABASE_URL) |
| `DATABASE_URL` | `postgres://melvinos:<POSTGRES_PASSWORD>@postgres:5432/melvinos` |
| `HOST_PORT` | Host port to expose the app (e.g. `3001`, `3003`, `3004`) |
| `APP_URL` | Public URL (e.g. `https://john.melvinos.com`) |

### Whitelabel Branding

| Variable | Default | Description |
|---|---|---|
| `PLATFORM_NAME` | MelvinOS | Name shown in UI, page title, emails |
| `AGENT_NAME` | MelvinOS | Agent name in chat and welcome screen |

### Optional

| Variable | Default | Description |
|---|---|---|
| `CLAUDE_SSH_PORT` | 2222 | Host port for Claude Code sidecar SSH |
| `COOKIE_SECURE` | true | Set to true when behind HTTPS |
| `ADMIN_ENROLLMENT_SECRET` | — | Temporary code for admin account setup |
| `PRO_ACCESS_CODE` | — | Temporary pro-plan access code |
| `SKIP_DB_MIGRATIONS` | false | Skip auto-migrations on startup |

> **Important:** Do NOT put API keys (Groq, OpenAI, Anthropic, etc.) in `.env` for production.
> Add them through the **Settings → API Keys** panel in the admin UI instead.
> Keys added via the UI are encrypted at rest using your `API_KEY_ENCRYPTION_KEY`.
> If you ever change `API_KEY_ENCRYPTION_KEY`, all stored keys become unreadable and must be re-entered.

---

## Multi-Tenant Deployment (Same Server)

When running multiple instances on one server, each instance must be fully isolated:

| Resource | Must be unique per instance |
|---|---|
| `COMPOSE_PROJECT_NAME` | Container name prefix |
| `HOST_PORT` | App port (3001, 3002, 3003, ...) |
| `CLAUDE_SSH_PORT` | SSH port (2222, 2223, 2224, ...) |
| `SESSION_SECRET` | Session signing key |
| `API_KEY_ENCRYPTION_KEY` | API key encryption key |
| `POSTGRES_PASSWORD` | Database password |
| Docker volume names | Prefixed per instance |
| Docker network name | Prefixed per instance |

Instances share the host OS and Docker daemon but have:
- Separate Docker networks (no cross-container communication)
- Separate PostgreSQL databases (each instance has its own postgres container)
- Separate Docker volumes (data never shared)
- Separate encryption keys (one instance cannot decrypt another's API keys)

### Port Allocation Example

| Instance | App Port | Claude SSH Port | Codebase |
|---|---|---|---|
| Austin (primary) | 3002 | 2223 | /opt/melvinos |
| John | 3003 | 2224 | /opt/melvinos-john |
| Paul | 3004 | 2225 | /opt/melvinos-paul |
| Shireen | 3005 | 2226 | /opt/melvinos-shireen |

---

## Creating the Admin Account

### Option A: Via the seed script (requires tsx in container)

```bash
docker exec <container> npx tsx scripts/seed-super-admin.ts
```

Set `SUPER_ADMIN_EMAIL` and `SUPER_ADMIN_PASSWORD` env vars, or it will generate a random password.

### Option B: Direct SQL (recommended for production containers)

```bash
# Hash the password inside the app container
HASHED=$(docker exec <app_container> node -e "
const bcrypt = require('bcryptjs');
console.log(bcrypt.hashSync('ThePassword!', 10));
")

# Insert the user
docker exec <postgres_container> psql -U melvinos -d melvinos -c "
INSERT INTO users (email, username, password, role, status, plan, created_at, updated_at)
VALUES ('user@example.com', 'Display Name', '$HASHED', 'super_admin', 'active', 'pro', NOW(), NOW());
"
```

---

## AI Provider Setup

### Where to Add API Keys

**Always use the admin UI: Settings → API Keys**

Keys entered via the UI are encrypted at rest with AES-256-GCM using your `API_KEY_ENCRYPTION_KEY`. Never hardcode keys in `.env` for production.

### Available Models

| Model | Display Name | Provider | API Key Required |
|---|---|---|---|
| `gpt-5.4` | GPT-5.4 | OpenAI | `OPENAI_API_KEY` |
| `claude-sonnet-4-6` | Claude Sonnet 4.6 | Anthropic | `ANTHROPIC_API_KEY` |
| `claude-opus-4-6` | Claude Opus 4.6 | Anthropic | `ANTHROPIC_API_KEY` |
| `claude-haiku-4-5-20251001` | Claude Haiku 4.5 | Anthropic | `ANTHROPIC_API_KEY` |
| `compound` | Titan-V | Groq | `GROQ_API_KEY` |
| `os-120b` | GPT OS 120B | Groq | `GROQ_API_KEY` |
| `gemini-3.1-pro` | Gemini 3.1 Pro | Google | `GOOGLE_API_KEY` |
| `gemini-2.5-flash` | Gemini 2.5 Flash | Google | `GOOGLE_API_KEY` |
| `qwen3.5-397b` | Qwen 3.5 397B | Ollama Cloud | `OLLAMA_API_KEY` |
| `sonar-pro` | Sonar Pro | Perplexity | `PERPLEXITY_API_KEY` |
| `sonar-deep-research` | Sonar Deep Research | Perplexity | `PERPLEXITY_API_KEY` |

### Provider `enabled` Flag

The `enabled` toggle in Settings → API Keys controls whether a provider's models appear in the **model selector dropdown**. It does NOT control tool access:

- **enabled: true** → Models show in dropdown, API key is used for both chat and tools
- **enabled: false** → Models hidden from dropdown, but API key is still available to tools (web search, deep research)

This is intentional — you can hide Perplexity from the model selector while still using it as the web search backend.

---

## Web Search Architecture

MelvinOS uses a tiered approach to web search:

### Tier 1: Native Search (built into the model's API)

These models have web search built into their provider APIs and do NOT need Perplexity:

| Model | Provider | Native Search Method |
|---|---|---|
| `gpt-5.4` | OpenAI | `web_search_preview` tool |
| `claude-sonnet-4-6` | Anthropic | `web_search_20250305` tool |
| `claude-opus-4-6` | Anthropic | `web_search_20250305` tool |
| `gemini-3.1-pro` | Google | `google_search` tool |
| `gemini-2.5-flash` | Google | `google_search` tool |
| `compound` | Groq | Built-in compound search |

### Tier 2: Perplexity Fallback (sonar-pro)

Models without native search use **Perplexity sonar-pro** as the web search backend:

| Model | Why Perplexity? |
|---|---|
| `qwen3.5-397b` | Ollama Cloud has no built-in search |
| `os-120b` | Groq model without compound search |
| `llama-3.1-8b-instant` | Legacy model, no native search |

If a Tier 1 native search **fails**, it also falls back to Perplexity sonar-pro.

### Tier 3: Deep Research / Thor Mode (sonar-deep-research)

**Always uses Perplexity `sonar-deep-research`**, regardless of which model is selected. Triggered by:
- User enables **Thor mode** toggle in the chat input
- Agent explicitly passes `deep_research: true` to the web search tool

### Key Takeaway

> **A Perplexity API key is required for full functionality** even if you never select a Perplexity model.
> Without it, web search will fail on Qwen/os-120b/Vega-3, and deep research/Thor mode won't work on any model.
>
> You can set `enabled: false` for Perplexity (to hide it from the model dropdown) while still providing the API key.
> The web search and deep research tools will use the key regardless of the enabled flag.

---

## Reverse Proxy / SSL

### Nginx Proxy Manager

1. Create a new Proxy Host:
   - **Domain:** `yourdomain.com`
   - **Forward Hostname:** `172.17.0.1` (Docker bridge gateway)
   - **Forward Port:** Your `HOST_PORT` value
   - **Websockets:** Enabled
   - **Block Exploits:** Enabled

2. Custom Nginx Config (Advanced tab):
   ```
   proxy_read_timeout 300s;
   proxy_send_timeout 300s;
   client_max_body_size 50M;
   ```

3. SSL tab → Request Let's Encrypt certificate → Force SSL

### DNS

Create an A record: `yourdomain.com` → `<server IP>`

---

## Database

### Migrations

Migrations run automatically on startup (unless `SKIP_DB_MIGRATIONS=true`).

Migration files live in `/migrations/` and are tracked in the `melvinos_migrations` table.

### Manual Table: daily_routine_entries

The Daily Routine feature requires a table that is NOT included in the migration system. Create it manually after first deployment:

```sql
CREATE TABLE IF NOT EXISTS daily_routine_entries (
    id character varying DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    user_id character varying NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date date NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS daily_routine_user_date_idx
    ON daily_routine_entries (user_id, date);
```

Run via:
```bash
docker exec <postgres_container> psql -U melvinos -d melvinos -c "<SQL above>"
```

---

## MCP Servers

MCP (Model Context Protocol) servers give the agent access to external tools (CRM, project management, etc.).

### Adding via Admin UI

Settings → MCP Servers → Add Server

### Adding via Database

```sql
UPDATE platform_settings SET data = jsonb_set(
  data,
  '{mcpServers}',
  '[{
    "id": "unique-id",
    "name": "Display Name",
    "transport": "streamable-http",
    "url": "https://service.example.com/mcp/",
    "headers": {
      "Authorization": "Bearer <token>"
    },
    "enabled": true
  }]'::jsonb
)
WHERE id = 'global';
```

Restart the app container after adding via SQL so the MCP connection is established.

---

## Updating

To update an instance to the latest code:

```bash
cd /opt/melvinos-<name>
git pull origin main
docker compose build melvinos
docker compose up -d melvinos
```

Migrations run automatically on startup. The Claude Code sidecar rarely changes — rebuild it only when its Dockerfile changes:

```bash
docker compose build claude-code
docker compose up -d claude-code
```

---

## Troubleshooting

### "LLM call failed: 401 unauthorized"

The API key for the selected model's provider is missing, invalid, or was encrypted with a different `API_KEY_ENCRYPTION_KEY`.

**Fix:** Go to Settings → API Keys, clear the key, and re-enter it. If `API_KEY_ENCRYPTION_KEY` was changed, all stored keys must be re-entered.

### Web search fails on Qwen / os-120b

These models require a **Perplexity API key** for web search (they don't have native search). Add a Perplexity key in Settings → API Keys. The provider can be `enabled: false` — only the key matters.

### Daily Routine page is empty

The `daily_routine_entries` table may be missing. See the "Database" section above to create it manually.

### Session cookies not setting (can't stay logged in)

If `COOKIE_SECURE=true` but you're accessing via HTTP (not HTTPS), cookies won't be set. Either:
- Set up SSL/HTTPS (recommended), or
- Temporarily set `COOKIE_SECURE=false` in `.env` for testing

### Container healthy but app unreachable

Check your reverse proxy configuration. The app listens on container port 3001, mapped to `HOST_PORT` on the host. Your reverse proxy should point to `<host-ip>:<HOST_PORT>`.
