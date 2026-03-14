# Atlas — Autonomous AI Agent Platform

Atlas is a self-hosted, single-user autonomous AI agent platform. It connects to your tools (Gmail, Calendar, Drive, Notion, GoHighLevel, n8n, SSH servers, and more) and executes multi-step tasks end-to-end using the AI model of your choice.

## Features

- **Multi-model AI** — Anthropic Claude, OpenAI GPT, Groq, Google Gemini, Perplexity, Ollama
- **Autonomous agent loop** — chains tool calls across 50+ steps per turn without stopping
- **Full tool suite** — web search, deep research, code execution, file I/O, SSH, email, calendar, Notion, GHL CRM, image/video generation
- **Voice I/O** — speech-to-text input, text-to-speech output, realtime voice streaming
- **Memory system** — auto-extracts and injects persistent memories across conversations
- **Knowledge base** — upload docs/URLs and attach them to conversations or projects
- **Assistants** — create prompt-based or webhook-based assistant personas
- **Skills** — injectable prompt overlays that extend agent behavior
- **Heartbeat scanner** — scheduled autonomous scan tasks with Telegram/SMS delivery
- **Claude Code integration** — delegate complex coding tasks to a dedicated Claude Code container
- **n8n integration** — route specialized agent tasks to n8n workflows
- **MCP server support** — connect any Model Context Protocol tool server
- **Release management** — version and promote system prompt + assistant bundles
- **Single-user, self-hosted** — full control, no SaaS dependencies

## Quick Start (Docker)

```bash
git clone https://github.com/your-org/atlas.git
cd atlas
cp .env.example .env
# Edit .env — add your API keys and set POSTGRES_PASSWORD, SESSION_SECRET, API_KEY_ENCRYPTION_KEY
docker compose up -d
```

Navigate to `http://localhost:3001` to complete setup.

For full deployment instructions, see [DEPLOY.md](DEPLOY.md).

## Prerequisites

- Docker + Docker Compose
- A domain with SSL (recommended for production)
- At least one AI provider API key (Anthropic, OpenAI, Groq, or Google)

## Environment Variables

Copy `.env.example` to `.env` and fill in real values:

| Variable | Description |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string. Auto-set by docker-compose. |
| `SESSION_SECRET` | Secret used to sign Express sessions. Generate with `openssl rand -hex 32`. |
| `API_KEY_ENCRYPTION_KEY` | 32+ byte secret for encrypting user API keys. Generate with `openssl rand -hex 32`. |
| `ADMIN_ENROLLMENT_SECRET` | One-time secret required to create admin accounts after the first one exists. Leave empty to allow the first admin to enroll freely. |
| `ANTHROPIC_API_KEY` | Anthropic API key. |
| `OPENAI_API_KEY` | OpenAI API key (also used for voice and image generation). |
| `GROQ_API_KEY` | Groq API key. |
| `OPENAI_VOICE_MODEL`, `OPENAI_VOICE_NAME`, `OPENAI_VOICE_FORMAT` | Voice model config. Defaults: `gpt-4o-mini-tts` / `alloy` / `mp3`. |
| `OPENAI_VOICE_REALTIME_ENABLED` | Set `true` to enable realtime WebSocket voice streaming. |
| `N8N_BASE_URL` | Your n8n instance URL (e.g. `https://n8n.yourdomain.com`). Leave blank to disable. |
| `N8N_API_KEY` | n8n API key for workflow management. |
| `GHL_FROM_EMAIL` | Default sender email for GoHighLevel transactional emails. |
| `PLATFORM_NAME` | Display name for the platform (default: `Atlas`). |
| `AGENT_NAME` | Display name for the AI agent (default: `Atlas`). |
| `APP_URL` | Public URL of the app, used in email links (e.g. `https://atlas.yourdomain.com`). |
| `KNOWLEDGE_FETCH_HOST_ALLOWLIST` | Comma-separated hostnames allowed for URL knowledge ingestion. |
| `FILE_STORAGE_TTL_MS` | In-memory file storage TTL in ms (default: `86400000`). |
| `FILE_STORAGE_QUOTA_BYTES` | Per-user file storage quota in bytes (default: `52428800`). |
| `S3_BUCKET`, `S3_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | S3/R2 storage (optional). |
| `QDRANT_URL` | Qdrant vector DB URL for semantic memory (default: `http://localhost:6333`). |
| `SKIP_DB_MIGRATIONS` | Set `true` to skip automatic migrations on startup. |

## Architecture

- **Single-user** — designed for one primary operator. Multi-tenancy is not implemented.
- **Server**: Express.js + TypeScript
- **Database**: PostgreSQL with Drizzle ORM
- **Frontend**: React + Vite + Tailwind + shadcn/ui
- **Agent loop**: streaming SSE with tool chaining (up to 50 iterations standard, 100 in Thor mode)
- **Memory**: Qdrant vector store + PostgreSQL agent memories table
- **Claude Code**: separate container with relay for coding task delegation

## Development

```bash
npm install
npm run dev
```

The server runs migrations automatically on startup. To skip: `SKIP_DB_MIGRATIONS=true npm run dev`.

## Testing

```bash
npm test                    # unit tests
npm run test:playwright     # end-to-end (requires: npx playwright install --with-deps)
```

## License

See [LICENSE](LICENSE).
