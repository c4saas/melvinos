/**
 * Memory Cleanse — LLM-powered deduplication, contradiction resolution, and consolidation.
 *
 * Runs over the full memory store and identifies:
 *   - Duplicates / near-duplicates (same fact stated in different words)
 *   - Contradictions (two memories that conflict — keep the most recent)
 *   - Redundant fragments (a memory fully subsumed by a more complete one)
 *
 * Fires conservatively — only deletes when clearly redundant. Preserves nuance.
 */

import type { IStorage } from '../storage';
import { createFallbackAwareProvider } from './index';
import { getDefaultModel } from '../ai-models';

export interface CleanseResult {
  totalBefore: number;
  deleted: number;
  updated: number;
  durationMs: number;
}

const CLEANSE_PROMPT = `You are a memory curator for an AI assistant.

You will receive a list of long-term memories in the format:
  ID | [category] content

Your job is to identify:
1. **DUPLICATES** — two or more memories that express the same fact in different words. Keep the most specific and complete phrasing. Delete the rest.
2. **CONTRADICTIONS** — memories that directly conflict (e.g., "user prefers dark mode" vs "user prefers light mode"). Keep the MOST RECENT one (higher in the list = older; lower = newer). Delete older conflicting ones.
3. **SUBSUMED** — a memory that is entirely captured by another more complete memory. Delete the redundant fragment.

Be conservative. Only delete when clearly redundant or contradictory. If two memories are related but each adds unique nuance, keep both.

For survivors where merging two versions improves clarity, you may suggest an updated content string.

Return ONLY a valid JSON object with no preamble or markdown fences:
{
  "delete": ["id1", "id2"],
  "update": [{"id": "id3", "content": "improved canonical content"}]
}

If nothing needs to be changed, return: {"delete":[],"update":[]}`;

const BATCH_SIZE = 80; // memories per LLM call — keeps prompt manageable

/**
 * Run a full memory cleanse pass. Returns stats on what was changed.
 */
export async function runMemoryCleanse(storage: IStorage): Promise<CleanseResult> {
  const start = Date.now();

  const platformSettings = await storage.getPlatformSettings();
  const fallbackModel = (platformSettings.data as any)?.fallbackModel as string | null;

  // Use qwen for memory curation — consistent with extraction model
  const model = 'qwen3.5-397b';
  const provider = createFallbackAwareProvider(storage, model, fallbackModel ?? getDefaultModel());

  const all = await storage.listAgentMemories(undefined, 500);
  const totalBefore = all.length;

  if (totalBefore < 5) {
    // Not enough memories to bother cleansing
    return { totalBefore, deleted: 0, updated: 0, durationMs: Date.now() - start };
  }

  let totalDeleted = 0;
  let totalUpdated = 0;

  // Process in batches so we don't exceed the model's context window
  for (let i = 0; i < all.length; i += BATCH_SIZE) {
    const batch = all.slice(i, i + BATCH_SIZE);

    const memoryList = batch
      .map((m) => `${m.id} | [${m.category}] ${m.content}`)
      .join('\n');

    let result: { delete: string[]; update: Array<{ id: string; content: string }> };

    try {
      const response = await provider.complete(
        [
          { role: 'system', content: CLEANSE_PROMPT },
          { role: 'user', content: memoryList },
        ],
        [],
        {
          model,
          maxIterations: 1,
          userId: 'system',
          conversationId: 'memory-cleanse',
          maxTokens: 800,
        },
      );

      const text = response.content
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/m, '')
        .trim();

      result = JSON.parse(text);
    } catch (err) {
      console.error('[memory-cleanse] LLM call or parse failed for batch starting at', i, ':', err instanceof Error ? err.message : err);
      continue;
    }

    // Validate IDs belong to this batch (prevent hallucinated IDs affecting other records)
    const batchIds = new Set(batch.map((m) => m.id));

    const toDelete = (result.delete ?? []).filter((id) => batchIds.has(id));
    const toUpdate = (result.update ?? []).filter(
      (u) => batchIds.has(u.id) && typeof u.content === 'string' && u.content.trim(),
    );

    // Apply updates first (so we don't update something about to be deleted)
    const deletedSet = new Set(toDelete);
    for (const u of toUpdate) {
      if (deletedSet.has(u.id)) continue;
      try {
        await storage.updateAgentMemory(u.id, { content: u.content.trim() });
        totalUpdated++;
      } catch (err) {
        console.error('[memory-cleanse] Failed to update memory', u.id, ':', err instanceof Error ? err.message : err);
      }
    }

    // Apply deletions
    for (const id of toDelete) {
      try {
        await storage.deleteAgentMemory(id);
        totalDeleted++;
      } catch (err) {
        console.error('[memory-cleanse] Failed to delete memory', id, ':', err instanceof Error ? err.message : err);
      }
    }

    if (toDelete.length > 0 || toUpdate.length > 0) {
      console.log(`[memory-cleanse] Batch ${Math.floor(i / BATCH_SIZE) + 1}: deleted ${toDelete.length}, updated ${toUpdate.length}`);
    }
  }

  const durationMs = Date.now() - start;
  console.log(`[memory-cleanse] Complete — ${totalDeleted} deleted, ${totalUpdated} updated in ${durationMs}ms`);

  return { totalBefore, deleted: totalDeleted, updated: totalUpdated, durationMs };
}
