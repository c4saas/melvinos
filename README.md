# Atlas AI Security Hardening

## Overview
This branch focuses on SEV-1 mitigations for Atlas AI by securing file workflows and tightening access to premium features. Key updates include authenticated file access with per-user ownership checks, rate-limited upload/download endpoints, a guarded file storage abstraction, and removal of hard-coded Pro plan fallbacks. It now also introduces release management so administrators can bundle and publish coordinated updates across system prompts, assistants, templates, output templates, and tool policies.

Recent changes add webhook-aware assistants end to end. The `/api/assistants` response now surfaces assistant `type`, prompt content, and sanitized webhook configuration so the client can group prompt-based assistants separately from webhook-powered automations. Chat requests persist the selected assistant metadata, invoke external webhooks with SSRF-safe guards, and stream the resulting output (including success/error telemetry) back to the UI so follow-up messages clearly indicate which automation generated each response.

## Prerequisites
- Node.js 18+
- PostgreSQL 14+

## Environment Variables
Copy `.env.example` to `.env` and provide real values:

| Variable | Description |
| --- | --- |
| `DATABASE_URL` | Connection string for PostgreSQL. |
| `SESSION_SECRET` | Secret used to sign Express sessions. |
| `API_KEY_ENCRYPTION_KEY` | 32+ byte secret used to encrypt user provided API keys. |
| `ADMIN_ENROLLMENT_SECRET` | One-time secret required to create or reset administrator accounts once one exists. Leave empty to allow the first admin to enroll without a temporary password. |
| `PRO_ACCESS_CODE` | Optional temporary Pro upgrade code (will be replaced by Stripe webhooks). Leave empty to disable the manual upgrade flow. |
| `GROQ_API_KEY` | Optional platform-managed Groq API key used when users have not provided their own. |
| `OPENAI_API_KEY` | Primary OpenAI key for text, vision, and default voice usage. Required unless users supply their own. |
| `OPENAI_VOICE_API_KEY` | Optional dedicated key for realtime voice; leave blank to reuse `OPENAI_API_KEY`. |
| `OPENAI_VOICE_MODEL`, `OPENAI_VOICE_NAME`, `OPENAI_VOICE_FORMAT` | Override the default OpenAI realtime voice model, name, and audio container. Defaults to `gpt-4o-mini-tts`/`alloy`/`mp3`. |
| `OPENAI_VOICE_REALTIME_ENABLED` | Set to `true` to enable realtime WebSocket streaming when the client requests voice playback (defaults to `false`). |
| `OPENAI_VOICE_REALTIME_URL` | Optional custom Realtime API base URL. Leave blank to use `wss://api.openai.com/v1/realtime`. |
| `KNOWLEDGE_FETCH_HOST_ALLOWLIST` | Optional comma-separated list of hostnames or wildcard patterns (e.g. `*.example.com`) allowed for URL ingestion. |
| `N8N_BASE_URL` | Base URL for the shared n8n workspace (defaults to `https://zap.c4saas.com`). |
| `FILE_STORAGE_TTL_MS` | (Optional) Time-to-live for in-memory file storage fallback. |
| `FILE_STORAGE_QUOTA_BYTES` | (Optional) Per-user quota for file storage fallback. |
| `S3_BUCKET`, `S3_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | Reserved for future S3/R2 adapter wiring. |

## Setup
```bash
npm install

# Configure DATABASE_URL for your local Postgres instance, then run migrations
# (Drizzle will apply the SQL files in ./migrations)
DATABASE_URL="postgresql://user:pass@localhost:5432/atlas" npm run db:push
```

If you prefer to apply migrations manually, execute the SQL files in `./migrations` against a clean database in order. This ensures the session store and other tables stay in sync with the Drizzle schema.

## Development
Start the API locally:
```bash
npm run dev
```

The server automatically runs pending Drizzle migrations on startup. Set `SKIP_DB_MIGRATIONS=true` in your environment if you need
to disable this behaviour for ephemeral environments (after running the migrations manually).

## Usage aggregation scheduler
- Atlas persists per-user usage summaries to the `usage_summary_snapshots` table every 15 minutes by default. The scheduler runs
  immediately on boot and then on the configured cadence.
- Tune the cadence or aggregation window by setting `USAGE_SNAPSHOT_INTERVAL_MINUTES` (default `15`) and
  `USAGE_SNAPSHOT_LOOKBACK_HOURS` (default `24`) in your environment before starting the server. Values must be positive numbers.
- Monitor recent snapshots with a query such as `SELECT * FROM usage_summary_snapshots ORDER BY generated_at DESC LIMIT 20;`.
  Scheduler errors are emitted with the `[usage-scheduler]` prefix in the server logs.
- The chat header fetches `/api/usage/user/latest` so operators see the most recent aggregated totals (tokens, cost, model mix).
  The endpoint returns the latest stored snapshot when one exists, otherwise it computes the window on demand, persists it, and
  the React Query hook refreshes the UI at least every 15 minutes to match the scheduler cadence.

## Authentication
- Existing users can sign in with either their email address or their legacy username; both identifiers now resolve to the same login endpoint.
- To create the first administrator, submit the admin enrollment form without configuring `ADMIN_ENROLLMENT_SECRET`. Configure the secret afterwards to require the temporary password for future admin enrollment or password resets.

## Testing
Run unit tests covering the security and assistant-routing changes:
```bash
npm test
```

End-to-end checks validate prompt vs webhook assistant routing, SSE metadata, and UI grouping. Install Playwright browsers once (`npx playwright install --with-deps`) and run:

```bash
npm run test:playwright
```

If your environment blocks access to the npm registry, install dependencies in an allowed environment first (or use an internal mirror) before running the test suites locally.

## Notes
- File uploads and downloads require an authenticated session, validate ownership before serving content, and now enforce tighter file-size limits to protect memory.
- Upload-heavy routes are protected by rate limiting, per-user quotas, and CSRF validation to reduce abuse and cross-site attacks.
- The Pro upgrade flow reads its access code from `PRO_ACCESS_CODE` and uses constant-time comparisons to avoid timing leaks; leave the variable blank to disable manual upgrades entirely.
- Atlas will fall back to deriving the encryption key from `SESSION_SECRET` if `API_KEY_ENCRYPTION_KEY` is missing, but you should configure a dedicated 32+ character secret in production and rotate it separately from session cookies.
- Administrators can create, update, and revoke Pro access coupons from the admin portal; redemptions are tracked per user and automatically enforce expiration, activation state, and redemption limits.
- The Atlas AI Control Center now includes System Prompt and Release managers so admins can version global instructions, bundle compatible assistants/templates/tools, review activation history, and promote or roll back releases without redeploying the service.
- Knowledge URL ingestion resolves DNS, blocks private networks (including redirects), optionally enforces an allowlist to mitigate SSRF, and now rejects responses that exceed safe size thresholds.
- Project knowledge file uploads now share the same size caps as personal knowledge uploads—10MB for Free plans, 25MB for Pro plans, and 50MB for Enterprise plans—and respond with a 413 error when exceeded so teams see consistent limits across the product.
- The AI Assistants accordion in the chat sidebar now lists connected N8N assistants and includes a CTA to Settings → Integrations so teammates know where to manage API keys and webhook imports.
- Admins configure assistant availability exclusively through the Assistant Library page—legacy AI Agents settings were removed to keep routing, quotas, and publishing flows in one place.
- Administrator accounts are provisioned through the `/api/auth/admin/enroll` endpoint using `ADMIN_ENROLLMENT_SECRET`; no admin email is hard-coded in the repository.
- Users can connect their Notion workspace by providing a Notion API key from either the chat integrations menu or Settings → Integrations. Atlas verifies credentials on save and reuses the encrypted key across the app for database/page lookups.
- The usage dashboard now includes a manual refresh action so admins can invalidate cached analytics and pull the latest usage stats without reloading the page.
- Chat UX improvements: the Atlas logo acts as a "scroll to top" shortcut, code blocks always render on a dark theme, the message pane retains a fixed viewport that auto-scrolls, and a floating new-chat button appears whenever the sidebar is collapsed.
- OCR processing now bundles `server/tessdata/eng.traineddata`; ensure this directory (and file) is deployed alongside the server so the worker can load languages without reaching external CDNs.
- Assistants can now be configured as prompt-based or webhook-based. Webhook assistants receive sanitized payloads (message text, attachment metadata, chat context) over HTTP POST with Atlas-specific headers, enforce configurable timeouts, and persist webhook telemetry so the chat history highlights automation runs.
