/**
 * Qdrant Vector Memory — semantic search layer for Melvin's long-term memory.
 *
 * Architecture:
 *   - PostgreSQL remains the source of truth (IDs, CRUD, full records)
 *   - Qdrant stores vector embeddings keyed by the same PostgreSQL UUID
 *   - On save: embed content → upsert to Qdrant (fire-and-forget, non-blocking)
 *   - On search: embed query → Qdrant cosine similarity → return PG IDs + scores
 *   - On delete: remove vector from Qdrant
 *
 * Embedding model: text-embedding-3-small (1536-dim, ~$0.00002/1K tokens)
 * Qdrant collection: melvin-memories
 */

import OpenAI from 'openai';

const COLLECTION = 'melvin-memories';
const VECTOR_SIZE = 1536;
const EMBEDDING_MODEL = 'text-embedding-3-small';

function getQdrantUrl(): string {
  return process.env.QDRANT_URL || 'http://localhost:6333';
}

/** Ping Qdrant — returns true if reachable */
export async function isQdrantAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${getQdrantUrl()}/collections/${COLLECTION}`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Generate a 1536-dim embedding via OpenAI text-embedding-3-small */
async function embed(text: string, apiKey: string): Promise<number[]> {
  const client = new OpenAI({ apiKey });
  const response = await client.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text.slice(0, 2000), // cap to avoid token limits
  });
  return response.data[0].embedding;
}

/**
 * Index a memory in Qdrant. The Qdrant point ID matches the PostgreSQL UUID.
 * Fire-and-forget safe — errors are logged, never thrown to the caller.
 */
export async function indexMemory(
  id: string,
  content: string,
  category: string,
  apiKey: string,
): Promise<void> {
  try {
    const vector = await embed(content, apiKey);
    const url = `${getQdrantUrl()}/collections/${COLLECTION}/points`;
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        points: [{
          id,
          vector,
          payload: { content, category },
        }],
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error('[qdrant-memory] Upsert failed:', res.status, body);
    }
  } catch (err) {
    console.error('[qdrant-memory] indexMemory error:', err instanceof Error ? err.message : err);
  }
}

/**
 * Remove a memory vector from Qdrant when the PostgreSQL record is deleted.
 */
export async function deleteMemoryVector(id: string): Promise<void> {
  try {
    const url = `${getQdrantUrl()}/collections/${COLLECTION}/points/delete`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ points: [id] }),
    });
  } catch (err) {
    console.error('[qdrant-memory] deleteMemoryVector error:', err instanceof Error ? err.message : err);
  }
}

export interface QdrantSearchHit {
  id: string;
  score: number;
  content: string;
  category: string;
}

/**
 * Semantic search across memories.
 * Returns results ordered by cosine similarity (most relevant first).
 */
export async function semanticSearchMemories(
  query: string,
  limit: number,
  apiKey: string,
): Promise<QdrantSearchHit[]> {
  const vector = await embed(query, apiKey);

  const url = `${getQdrantUrl()}/collections/${COLLECTION}/points/search`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      vector,
      limit,
      with_payload: true,
      score_threshold: 0.35, // only return meaningfully similar results
    }),
  });

  if (!res.ok) {
    throw new Error(`Qdrant search failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json() as { result: Array<{ id: string; score: number; payload: { content: string; category: string } }> };
  return data.result.map((hit) => ({
    id: hit.id,
    score: hit.score,
    content: hit.payload.content,
    category: hit.payload.category,
  }));
}

/**
 * Index all existing PostgreSQL memories into Qdrant (one-time backfill).
 * Skips memories that are already indexed.
 */
export async function backfillMemories(
  memories: Array<{ id: string; content: string; category: string }>,
  apiKey: string,
): Promise<{ indexed: number; skipped: number }> {
  // Get existing IDs in Qdrant
  const scrollRes = await fetch(`${getQdrantUrl()}/collections/${COLLECTION}/points/scroll`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ limit: 1000, with_payload: false, with_vector: false }),
  });
  const scrollData = await scrollRes.json() as { result: { points: Array<{ id: string }> } };
  const existingIds = new Set(scrollData.result.points.map((p) => p.id));

  const toIndex = memories.filter((m) => !existingIds.has(m.id));
  let indexed = 0;

  for (const memory of toIndex) {
    try {
      await indexMemory(memory.id, memory.content, memory.category, apiKey);
      indexed++;
      // Small delay to avoid rate-limiting the embeddings API
      await new Promise((r) => setTimeout(r, 50));
    } catch (err) {
      console.error('[qdrant-memory] Backfill failed for', memory.id, ':', err instanceof Error ? err.message : err);
    }
  }

  return { indexed, skipped: existingIds.size };
}
