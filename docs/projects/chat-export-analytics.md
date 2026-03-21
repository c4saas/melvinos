# Project: Chat Export & Conversation Analytics

## Overview
Add the ability to export any chat as Markdown or JSON, and show per-conversation
analytics (message count, token usage, cost, model breakdown) in a summary card
on the chat list page.

No conversation export or per-chat analytics exists today. The `chats`, `messages`,
and `usage_metrics` tables already have the data — it just needs to be aggregated
and surfaced.

---

## Implementation Steps

### Step 1 — Backend: Chat stats aggregation query
**File:** `server/storage/index.ts`

Add a `getChatStats(chatId: string)` method to `IStorage` and implement it in
`DatabaseStorage`. It should join `messages` and `usage_metrics` to return:

```ts
interface ChatStats {
  messageCount: number;
  userMessages: number;
  assistantMessages: number;
  totalTokens: number;
  estimatedCost: number;
  modelsUsed: string[];
  firstMessageAt: Date | null;
  lastMessageAt: Date | null;
}
```

Add a stub returning zeroes in `MemStorage`.

---

### Step 2 — Backend: Markdown export formatter
**File:** `server/chat-export.ts` (new)

Create a function `exportChatAsMarkdown(chat, messages): string` that renders a
conversation into clean Markdown:

```markdown
# Chat: {title}
**Date:** {firstMessage} — {lastMessage}
**Messages:** {count} | **Model:** {model}

---

### User — 2025-03-21 14:30
{content}

### Assistant — 2025-03-21 14:31
{content}

---
*Exported from MelvinOS*
```

Also create `exportChatAsJSON(chat, messages): object` that returns structured
JSON with the same data.

---

### Step 3 — Backend: Export API endpoint
**File:** `server/routes.ts`

Add `GET /api/chats/:chatId/export?format=markdown|json`

- Validate `chatId` belongs to the authenticated user
- Fetch chat + messages from storage
- Call the appropriate formatter from Step 2
- Return with correct `Content-Type` and `Content-Disposition` headers
  - Markdown: `text/markdown`, attachment filename `{chat-title}.md`
  - JSON: `application/json`, attachment filename `{chat-title}.json`

---

### Step 4 — Backend: Chat stats API endpoint
**File:** `server/routes.ts`

Add `GET /api/chats/:chatId/stats`

- Return the `ChatStats` object from Step 1
- Cache for 30 seconds (in-memory) to avoid repeated aggregation queries

---

### Step 5 — Frontend: Export button on chat header
**File:** `client/src/components/chat/ChatHeader.tsx` (or wherever the chat
toolbar lives)

Add a dropdown menu with:
- "Export as Markdown" → triggers download via `/api/chats/:id/export?format=markdown`
- "Export as JSON" → triggers download via `/api/chats/:id/export?format=json`

Use the existing `Button` and `DropdownMenu` components from `@/components/ui`.

---

### Step 6 — Frontend: Stats card on chat list
**File:** `client/src/pages/` (wherever the chat list renders)

For each chat in the list, show a small stats summary:
- Message count badge
- Last activity timestamp
- Model used badge

Fetch stats lazily (on hover or expand) via the `/api/chats/:chatId/stats`
endpoint from Step 4. Use `@tanstack/react-query` with a 30-second stale time.

---

### Step 7 — Backend: Batch export endpoint
**File:** `server/routes.ts`

Add `POST /api/chats/export-batch` accepting:
```json
{ "chatIds": ["id1", "id2"], "format": "markdown" | "json" }
```

- Validate all chat IDs belong to the user
- Generate exports for each chat
- Return as a single ZIP file (use `archiver` package or `JSZip`)
- Set `Content-Disposition: attachment; filename="chats-export-{date}.zip"`

---

### Step 8 — Frontend: Bulk export UI on chat list
**File:** Chat list page component

Add checkbox selection to the chat list and a "Export Selected" button that:
- Collects selected chat IDs
- Calls the batch export endpoint from Step 7
- Downloads the resulting ZIP file
- Shows a loading indicator during generation

---

## What This Tests in the Agent Infrastructure

| Step | Infrastructure path exercised |
|------|-------------------------------|
| 1-2  | Sequential tool calls — reading schema, writing new code |
| 3-4  | Error recovery — DB query failures, auth edge cases |
| 5-6  | Context growth — by this point the conversation has 10+ tool results |
| 7    | Multi-step with dependencies — needs Steps 1-3 working first |
| 8    | Late-stage coherence — does the agent still reference early decisions? |

## Acceptance Criteria
- [ ] `GET /api/chats/:id/export?format=markdown` returns valid Markdown
- [ ] `GET /api/chats/:id/export?format=json` returns structured JSON
- [ ] `GET /api/chats/:id/stats` returns message count, tokens, cost
- [ ] Export button appears in chat UI with both format options
- [ ] Chat list shows message count and last activity
- [ ] Batch export returns a ZIP with multiple files
- [ ] All endpoints require authentication
- [ ] MemStorage stubs don't crash
