/**
 * Auto-Memory: Post-conversation memory extraction
 *
 * After each conversation turn completes, this runs a lightweight LLM pass
 * over the recent messages to identify facts, preferences, and procedures
 * worth persisting across future conversations. Fires and forgets — never
 * blocks the main response path.
 */

import type { IStorage } from '../storage';
import { createFallbackAwareProvider } from './index';
import { getDefaultModel } from '../ai-models';

/**
 * Simple word-overlap similarity (Jaccard on word sets).
 * Returns 0..1 where 1 = identical word sets.
 */
function computeSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean));
  const wordsB = new Set(b.replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let intersection = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection++;
  }
  return intersection / (wordsA.size + wordsB.size - intersection);
}

const EXTRACTION_PROMPT = `You extract long-term memories from conversations. Be HIGHLY selective — most conversations yield 0 memories.

Only extract a memory if ALL of these are true:
1. It will be useful across many future conversations (not just this one)
2. It is specific and actionable (not vague like "user is helpful")
3. It would change how you assist the user in a future session
4. It is NOT already obvious or universally true

Categories:
- **preference**: Strong, repeated preferences (communication style, formatting, tool choices)
- **fact**: Role, ongoing projects, key context — only if durable across weeks
- **procedure**: Established workflows, conventions the user always follows
- **context**: Background knowledge critical for future assistance

DO NOT extract: one-time tasks, things only relevant to this exchange, small talk, generic observations, implementation details, anything with relevanceScore below 70.

Respond with ONLY a JSON array (no preamble, no markdown fences):
[{"category":"fact|preference|procedure|context","content":"concise one-sentence memory","relevanceScore":70-95}]

Extract at most 2 memories. If nothing clearly meets the bar, respond with exactly: []`;

/**
 * Fire-and-forget: schedule memory extraction without blocking the caller.
 */
export function scheduleAutoMemory(
  userId: string,
  chatId: string,
  messages: Array<{ role: string; content: string }>,
  storage: IStorage,
): void {
  extractAndSaveMemories(userId, chatId, messages, storage).catch((err) => {
    console.error('[auto-memory] Unhandled error:', err instanceof Error ? err.message : err);
  });
}

async function extractAndSaveMemories(
  userId: string,
  chatId: string,
  messages: Array<{ role: string; content: string }>,
  storage: IStorage,
): Promise<void> {
  const hasUser = messages.some((m) => m.role === 'user');
  const hasAssistant = messages.some((m) => m.role === 'assistant');
  if (!hasUser || !hasAssistant) return;

  // Skip heartbeat chats — they are automated scans, not real conversations
  if (messages.some((m) => m.content?.includes('[Heartbeat]'))) return;

  try {
    const platformSettings = await storage.getPlatformSettings();
    const fallbackModel = (platformSettings.data as any)?.fallbackModel as string | null;

    // Use qwen for memory extraction — fast, capable, cost-effective for this lightweight task
    const model = 'qwen3.5-397b';
    const provider = createFallbackAwareProvider(storage, model, fallbackModel ?? getDefaultModel());

    // Compact view: last 8 turns, content trimmed to 600 chars each
    const recent = messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .slice(-8)
      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.slice(0, 600)}`)
      .join('\n\n');

    const result = await provider.complete(
      [
        { role: 'system', content: EXTRACTION_PROMPT },
        { role: 'user', content: recent },
      ],
      [], // no tools needed
      {
        model,
        maxIterations: 1,
        userId,
        conversationId: chatId,
        maxTokens: 400,
      },
    );

    const text = result.content.trim();
    if (!text || text === '[]') return;

    // Strip accidental markdown fences
    const jsonText = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/m, '').trim();
    const extracted = JSON.parse(jsonText);
    if (!Array.isArray(extracted) || extracted.length === 0) return;

    let saved = 0;
    for (const item of extracted) {
      if (typeof item.content !== 'string' || !item.content.trim()) continue;

      // Enforce minimum relevance gate — skip low-confidence extractions
      const rawScore = typeof item.relevanceScore === 'number' ? item.relevanceScore : 0;
      if (rawScore < 70) continue;

      const category = ['preference', 'fact', 'procedure', 'context'].includes(item.category)
        ? item.category
        : 'fact';

      const content = item.content.trim();

      // Deduplication: fire all 3 keyword searches in parallel, then check combined results
      const keywords = content
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .split(/\s+/)
        .filter((w: string) => w.length > 3)
        .slice(0, 3);

      const results = await Promise.all(keywords.map((kw) => storage.searchAgentMemories(kw, 20)));
      const contentLower = content.toLowerCase();
      const checkedIds = new Set<string>();
      let isDuplicate = false;
      for (const batch of results) {
        if (isDuplicate) break;
        for (const mem of batch) {
          if (checkedIds.has(mem.id)) continue;
          checkedIds.add(mem.id);
          if (computeSimilarity(contentLower, mem.content.toLowerCase()) > 0.5) {
            isDuplicate = true;
            break;
          }
        }
      }

      if (isDuplicate) continue;

      await storage.createAgentMemory({
        content,
        category,
        source: `auto:${chatId}`,
        relevanceScore: Math.min(95, Math.max(70, Math.round(rawScore))),
      });
      saved++;
    }

    if (saved > 0) {
      console.log(`[auto-memory] Saved ${saved} memor${saved === 1 ? 'y' : 'ies'} from chat ${chatId}`);

      // Auto-cleanse: when total memories exceed the threshold, run a background cleanse pass
      // to remove duplicates and contradictions before the store grows too large.
      const CLEANSE_THRESHOLD = 40;
      try {
        const total = (await storage.listAgentMemories()).length;
        if (total >= CLEANSE_THRESHOLD && total % 10 === 0) {
          // Only trigger every 10 memories above threshold (not on every save) to avoid spam
          console.log(`[auto-memory] Memory count ${total} hit cleanse interval — scheduling cleanse`);
          const { runMemoryCleanse } = await import('./memory-cleanse');
          runMemoryCleanse(storage).catch((err) => {
            console.error('[auto-memory] Background cleanse failed:', err instanceof Error ? err.message : err);
          });
        }
      } catch { /* non-critical — ignore */ }
    }
  } catch (err) {
    console.error('[auto-memory] Failed:', err instanceof Error ? err.message : String(err));
  }
}
