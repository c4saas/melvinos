import Anthropic from '@anthropic-ai/sdk';
import type { TopicCluster, ConsolidatedPage } from './types';

const MODEL = 'claude-sonnet-4-6';
const MAX_INPUT_TOKENS = 40000; // stay well within 200K context

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

const CONSOLIDATION_PROMPT = `You are a data consolidation specialist. You are given a set of documents on a single topic from multiple sources (Google Drive, Notion, Qdrant vector DB, PostgreSQL memories, meeting transcripts, workspace files).

Your job:
1. Merge all facts into a single, clean document. Remove duplicates — keep the most complete version.
2. If two sources contradict, note both versions with their source.
3. Organize by subtopic with clear markdown headers (##, ###).
4. Include source attribution inline: [from Drive: filename], [from Notion: page], [from Memory: category], [from Meeting: id], etc.
5. Output clean markdown. Be thorough but not verbose — keep every unique fact, remove only true duplicates.
6. Do NOT add commentary, preamble, or explanation. Output ONLY the consolidated content.`;

async function consolidateChunk(
  documents: Array<{ title: string; content: string; source: string; sourceId: string }>,
  topicLabel: string,
  client: Anthropic,
): Promise<string> {
  const docsText = documents.map((d, i) =>
    `--- Document ${i + 1}: "${d.title}" [${d.source}: ${d.sourceId}] ---\n${d.content}`
  ).join('\n\n');

  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    system: CONSOLIDATION_PROMPT,
    messages: [{
      role: 'user',
      content: `Topic: ${topicLabel}\n\nConsolidate these ${documents.length} documents:\n\n${docsText}`,
    }],
  });

  return res.content[0]?.type === 'text' ? res.content[0].text : '';
}

export async function consolidateCluster(
  cluster: TopicCluster,
  anthropicKey: string,
): Promise<ConsolidatedPage> {
  const client = new Anthropic({ apiKey: anthropicKey });
  const docs = cluster.documents;

  // Prepare document payloads
  const prepared = docs.map((d) => ({
    title: d.title,
    content: d.content,
    source: d.source + (d.sourceCollection ? `/${d.sourceCollection}` : ''),
    sourceId: d.sourceId,
  }));

  const totalTokens = prepared.reduce((sum, d) => sum + estimateTokens(d.content), 0);

  let finalContent: string;

  if (totalTokens < MAX_INPUT_TOKENS) {
    // Single pass — everything fits
    finalContent = await consolidateChunk(prepared, cluster.label, client);
  } else {
    // Map-reduce: batch documents, consolidate each batch, then merge summaries
    const batchSize = 6;
    const summaries: string[] = [];
    const totalBatches = Math.ceil(prepared.length / batchSize);

    for (let i = 0; i < prepared.length; i += batchSize) {
      const batchNum = Math.floor(i / batchSize) + 1;
      console.log(`[consolidation]   map-reduce batch ${batchNum}/${totalBatches} for "${cluster.label}"`);
      const batch = prepared.slice(i, i + batchSize);
      const summary = await consolidateChunk(batch, cluster.label, client);
      summaries.push(summary);
      await new Promise((r) => setTimeout(r, 300)); // Rate limit
    }

    // Reduce: merge all batch summaries into one
    if (summaries.length === 1) {
      finalContent = summaries[0];
    } else {
      const mergeDocs = summaries.map((s, i) => ({
        title: `Batch ${i + 1} Summary`,
        content: s,
        source: 'consolidation',
        sourceId: `batch-${i + 1}`,
      }));
      finalContent = await consolidateChunk(mergeDocs, cluster.label, client);
    }
  }

  return {
    title: cluster.label,
    category: cluster.category,
    content: finalContent,
    sourceCount: docs.length,
    documentIds: docs.map((d) => d.id),
  };
}

export async function consolidateAllClusters(
  clusters: TopicCluster[],
  anthropicKey: string,
  onProgress?: (completed: number, total: number) => void,
): Promise<ConsolidatedPage[]> {
  const pages: ConsolidatedPage[] = [];

  for (let i = 0; i < clusters.length; i++) {
    const cluster = clusters[i];
    console.log(`[consolidation] Consolidating "${cluster.label}" (${cluster.documents.length} docs, ${i + 1}/${clusters.length})`);

    try {
      const page = await consolidateCluster(cluster, anthropicKey);
      pages.push(page);
    } catch (err) {
      console.error(`[consolidation] Failed to consolidate "${cluster.label}":`, err instanceof Error ? err.message : err);
      // Create a raw dump as fallback
      pages.push({
        title: cluster.label,
        category: cluster.category,
        content: cluster.documents.map((d) =>
          `## ${d.title} [${d.source}]\n\n${d.content}`
        ).join('\n\n---\n\n'),
        sourceCount: cluster.documents.length,
        documentIds: cluster.documents.map((d) => d.id),
      });
    }

    onProgress?.(i + 1, clusters.length);
    await new Promise((r) => setTimeout(r, 300)); // Rate limit between clusters
  }

  return pages;
}
