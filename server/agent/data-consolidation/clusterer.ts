import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import type { NormalizedDocument, TopicCluster } from './types';

const EMBEDDING_MODEL = 'text-embedding-3-small';
const BATCH_SIZE = 20;

// ── Embedding ───────────────────────────────────────────────────────────────

async function embedBatch(texts: string[], apiKey: string): Promise<number[][]> {
  const client = new OpenAI({ apiKey });
  const input = texts.map((t) => t.slice(0, 2000));
  const res = await client.embeddings.create({ model: EMBEDDING_MODEL, input });
  return res.data.map((d) => d.embedding);
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) || 1);
}

// ── Agglomerative clustering ────────────────────────────────────────────────

function agglomerativeCluster(
  embeddings: number[][],
  threshold: number,
): number[] {
  const n = embeddings.length;
  const labels = Array.from({ length: n }, (_, i) => i);

  // Simple single-pass: for each doc, merge into the first cluster above threshold
  for (let i = 1; i < n; i++) {
    let bestCluster = -1;
    let bestSim = threshold;

    for (let j = 0; j < i; j++) {
      const sim = cosine(embeddings[i], embeddings[j]);
      if (sim > bestSim) {
        bestSim = sim;
        bestCluster = labels[j];
      }
    }

    if (bestCluster >= 0) {
      labels[i] = bestCluster;
    }
  }

  return labels;
}

// ── LLM cluster labeling ────────────────────────────────────────────────────

async function labelClusters(
  clusters: Map<number, NormalizedDocument[]>,
  anthropicKey: string,
): Promise<Map<number, { label: string; category: string }>> {
  const client = new Anthropic({ apiKey: anthropicKey });
  const labels = new Map<number, { label: string; category: string }>();

  for (const [clusterId, docs] of clusters) {
    // Build a compact summary of the cluster for labeling
    const excerpts = docs.slice(0, 5).map((d: NormalizedDocument) => {
      const excerpt = d.content.slice(0, 300);
      return `- "${d.title}" (${d.source}): ${excerpt}`;
    }).join('\n');

    try {
      const res = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 200,
        messages: [{
          role: 'user',
          content: `Given these ${docs.length} related documents, provide a short topic label and category.

Documents:
${excerpts}

Reply in exactly this format (no other text):
LABEL: <2-5 word topic label>
CATEGORY: <one of: business, people, content, technical, meetings, personal, research, other>`,
        }],
      });

      const text = res.content[0]?.type === 'text' ? res.content[0].text : '';
      const labelMatch = text.match(/LABEL:\s*(.+)/i);
      const catMatch = text.match(/CATEGORY:\s*(.+)/i);

      labels.set(clusterId, {
        label: labelMatch?.[1]?.trim() || `Topic ${clusterId}`,
        category: catMatch?.[1]?.trim().toLowerCase() || 'other',
      });
    } catch (err) {
      console.error(`[consolidation] Label cluster ${clusterId} failed:`, err instanceof Error ? err.message : err);
      labels.set(clusterId, {
        label: `Topic Group ${clusterId}`,
        category: 'other',
      });
    }

    // Rate limit protection
    await new Promise((r) => setTimeout(r, 200));
  }

  return labels;
}

// ── Main clustering function ────────────────────────────────────────────────

export async function clusterDocuments(
  documents: NormalizedDocument[],
  openaiKey: string,
  anthropicKey: string,
): Promise<TopicCluster[]> {
  if (documents.length === 0) return [];

  console.log(`[consolidation] Clustering ${documents.length} documents...`);

  // Step 1: Generate embeddings in batches
  const allEmbeddings: number[][] = [];
  for (let i = 0; i < documents.length; i += BATCH_SIZE) {
    const batch = documents.slice(i, i + BATCH_SIZE);
    const texts = batch.map((d) => `${d.title}\n${d.content.slice(0, 500)}`);
    const embeddings = await embedBatch(texts, openaiKey);
    allEmbeddings.push(...embeddings);
    if (i + BATCH_SIZE < documents.length) {
      await new Promise((r) => setTimeout(r, 100)); // Rate limit
    }
  }

  console.log(`[consolidation] Generated ${allEmbeddings.length} embeddings`);

  // Step 2: Cluster by cosine similarity
  const labels = agglomerativeCluster(allEmbeddings, 0.55);

  // Group documents by cluster label
  const clusterMap = new Map<number, NormalizedDocument[]>();
  for (let i = 0; i < documents.length; i++) {
    const cluster = labels[i];
    if (!clusterMap.has(cluster)) clusterMap.set(cluster, []);
    clusterMap.get(cluster)!.push(documents[i]);
  }

  console.log(`[consolidation] Found ${clusterMap.size} clusters`);

  // Step 3: LLM labels each cluster
  const clusterLabels = await labelClusters(clusterMap, anthropicKey);

  // Build TopicCluster objects
  const clusters: TopicCluster[] = [];
  for (const [clusterId, docs] of clusterMap) {
    const meta = clusterLabels.get(clusterId) || { label: `Topic ${clusterId}`, category: 'other' };
    clusters.push({
      label: meta.label,
      category: meta.category,
      documents: docs,
    });
  }

  // Sort by document count descending
  clusters.sort((a, b) => b.documents.length - a.documents.length);

  return clusters;
}
