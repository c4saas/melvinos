import fs from 'fs/promises';
import path from 'path';
import type { IStorage } from '../../storage';
import type { PipelineState, PipelineOptions, NormalizedDocument, TopicCluster, ConsolidatedPage } from './types';
import { extractQdrantCollections, extractPostgresMemories, extractDriveFiles, extractNotionPages, extractRecallTranscripts, extractWorkspaceFiles } from './extractors';
import { clusterDocuments } from './clusterer';
import { consolidateAllClusters, consolidateCluster } from './consolidator';
import { writeToNotion, writeToNotionIncremental, findOrCreateParentPage, listExistingTopicPages, fetchPageTextContent } from './output';

const WORKSPACE_PATH = '/app/workspace';
// Checkpoints go under uploads/ so they survive restarts and are never processed
// by the workspace extractor
const CHECKPOINT_DIR = '/app/uploads/consolidation-checkpoints';

export interface PipelineContext {
  storage: IStorage;
  userId: string;
  openaiKey: string;
  anthropicKey: string;
  googleAccessToken?: string;
  googleRefreshToken?: string;
  googleClientId?: string;
  googleClientSecret?: string;
  updateGoogleTokens?: (at: string, rt?: string | null, exp?: number | null) => Promise<void>;
  recallApiKey?: string;
  recallRegion?: string;
}

// ── Checkpoint helpers ────────────────────────────────────────────────────────

interface Phase1Checkpoint {
  phase: 'phase1';
  taskId: string;
  timestamp: string;
  docs: NormalizedDocument[];
  errors: string[];
}

interface Phase2Checkpoint {
  phase: 'phase2';
  taskId: string;
  timestamp: string;
  docs: NormalizedDocument[];
  clusters: TopicCluster[];
  errors: string[];
}

interface Phase3Checkpoint {
  phase: 'phase3';
  taskId: string;
  timestamp: string;
  totalDocuments: number;
  clusters: number;
  pages: ConsolidatedPage[];
  errors: string[];
}

type Checkpoint = Phase1Checkpoint | Phase2Checkpoint | Phase3Checkpoint;

function checkpointPath(taskId: string, phase: 'phase1' | 'phase2' | 'phase3'): string {
  return path.join(CHECKPOINT_DIR, `checkpoint-${taskId}-${phase}.json`);
}

async function loadCheckpoint(taskId: string): Promise<Checkpoint | null> {
  // Try the most advanced phase first
  for (const phase of ['phase3', 'phase2', 'phase1'] as const) {
    try {
      const raw = await fs.readFile(checkpointPath(taskId, phase), 'utf-8');
      const data = JSON.parse(raw) as Checkpoint;
      if (phase === 'phase3') {
        const p3 = data as Phase3Checkpoint;
        console.log(`[consolidation] Checkpoint found (phase3): ${p3.pages.length} consolidated pages ready for Notion`);
      } else if (phase === 'phase2') {
        const p2 = data as Phase2Checkpoint;
        console.log(`[consolidation] Checkpoint found (phase2): ${p2.docs.length} docs, ${p2.clusters.length} clusters`);
      } else {
        const p1 = data as Phase1Checkpoint;
        console.log(`[consolidation] Checkpoint found (phase1): ${p1.docs.length} docs`);
      }
      return data;
    } catch {
      // File missing or malformed — try next
    }
  }
  return null;
}

async function saveCheckpoint(data: Checkpoint): Promise<void> {
  await fs.mkdir(CHECKPOINT_DIR, { recursive: true });
  const tmpPath = checkpointPath(data.taskId, data.phase) + '.tmp';
  const finalPath = checkpointPath(data.taskId, data.phase);
  // Write to temp file first, then rename — prevents partial-write corruption
  await fs.writeFile(tmpPath, JSON.stringify(data), 'utf-8');
  await fs.rename(tmpPath, finalPath);
  console.log(`[consolidation] Checkpoint saved (${data.phase})`);
}

async function deleteCheckpoints(taskId: string): Promise<void> {
  for (const phase of ['phase1', 'phase2', 'phase3'] as const) {
    try {
      await fs.unlink(checkpointPath(taskId, phase));
    } catch { /* already gone */ }
    try {
      await fs.unlink(checkpointPath(taskId, phase) + '.tmp');
    } catch { /* already gone */ }
  }
}

// ── Topic matching helpers (incremental mode) ─────────────────────────────────

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'are', 'was',
  'has', 'have', 'will', 'can', 'all', 'not', 'been', 'its', 'our',
  'your', 'their', 'into', 'more', 'also', 'about', 'data', 'notes',
  'new', 'list', 'view', 'page', 'doc', 'file', 'item', 'update',
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

/**
 * For each new doc, find the best matching existing Notion topic page by keyword overlap.
 * Returns a map of pageId → docs assigned to that topic, plus unmatched docs.
 */
function assignDocsToTopics(
  docs: NormalizedDocument[],
  existingTopics: { title: string; pageId: string }[],
): { existing: Map<string, { title: string; docs: NormalizedDocument[] }>; newTopics: NormalizedDocument[] } {
  const existing = new Map<string, { title: string; docs: NormalizedDocument[] }>();
  const newTopics: NormalizedDocument[] = [];

  // Pre-tokenize topic titles once
  const tokenizedTopics = existingTopics.map((t) => ({
    ...t,
    tokens: new Set(tokenize(t.title)),
  }));

  for (const doc of docs) {
    const docTokens = new Set([
      ...tokenize(doc.title),
      ...tokenize(doc.category || ''),
    ]);

    let bestScore = 0;
    let bestTopic: { title: string; pageId: string } | null = null;

    for (const topic of tokenizedTopics) {
      let overlap = 0;
      for (const token of docTokens) {
        if (topic.tokens.has(token)) overlap++;
      }
      // Jaccard-style score: overlap / union
      const union = new Set([...docTokens, ...topic.tokens]).size;
      const score = union > 0 ? overlap / union : 0;

      if (score > bestScore && score >= 0.15) {
        bestScore = score;
        bestTopic = topic;
      }
    }

    if (bestTopic) {
      const bucket = existing.get(bestTopic.pageId) ?? { title: bestTopic.title, docs: [] };
      bucket.docs.push(doc);
      existing.set(bestTopic.pageId, bucket);
    } else {
      newTopics.push(doc);
    }
  }

  return { existing, newTopics };
}

// ── Persist lastConsolidationAt ───────────────────────────────────────────────

async function saveLastConsolidationAt(storage: IStorage): Promise<void> {
  try {
    const current = await storage.getPlatformSettings();
    await storage.upsertPlatformSettings(
      { ...current.data, lastConsolidationAt: new Date().toISOString() },
      'system',
    );
    console.log('[consolidation] Saved lastConsolidationAt to platform settings');
  } catch (err) {
    console.warn('[consolidation] Failed to save lastConsolidationAt:', err instanceof Error ? err.message : err);
  }
}

// ── Main pipeline ─────────────────────────────────────────────────────────────

export async function runConsolidationPipeline(
  ctx: PipelineContext,
  options: PipelineOptions = {},
  updateProgress?: (percent: number) => Promise<void>,
): Promise<PipelineState> {
  const { taskId } = options;

  const state: PipelineState = {
    phase: 'extract',
    totalDocuments: 0,
    clusters: 0,
    pagesCreated: 0,
    errors: [],
  };

  // ── Mode detection ────────────────────────────────────────────────────────
  const platformSettings = await ctx.storage.getPlatformSettings();
  const lastConsolidationAt = (platformSettings?.data as any)?.lastConsolidationAt as string | null | undefined;
  const lastRun = lastConsolidationAt ? new Date(lastConsolidationAt) : null;

  const isIncremental = options.mode !== 'full' && lastRun !== null;
  const since = isIncremental ? lastRun : undefined;

  if (isIncremental) {
    console.log(`[consolidation] Incremental mode — processing documents since ${lastRun!.toISOString()}`);
  } else {
    console.log(`[consolidation] Full mode — processing all documents`);
  }

  const sources = new Set(options.sources ?? ['qdrant', 'postgres', 'drive', 'notion', 'recall', 'workspace']);

  // ── Checkpoint Recovery (full mode only) ──────────────────────────────────
  let allDocs: NormalizedDocument[] = [];
  let cachedClusters: TopicCluster[] | null = null;
  let cachedPages: ConsolidatedPage[] | null = null;

  if (!isIncremental && taskId) {
    const checkpoint = await loadCheckpoint(taskId).catch(() => null);
    if (checkpoint) {
      state.errors = [...checkpoint.errors];

      if (checkpoint.phase === 'phase3') {
        cachedPages = checkpoint.pages;
        state.totalDocuments = checkpoint.totalDocuments;
        state.clusters = checkpoint.clusters;
        state.phase = 'output';
        await updateProgress?.(85);
      } else if (checkpoint.phase === 'phase2') {
        allDocs = checkpoint.docs;
        state.totalDocuments = allDocs.length;
        cachedClusters = checkpoint.clusters;
        state.clusters = cachedClusters.length;
        state.phase = 'consolidate';
        await updateProgress?.(50);
      } else {
        allDocs = checkpoint.docs;
        state.totalDocuments = allDocs.length;
        state.phase = 'cluster';
        await updateProgress?.(30);
      }
    }
  }

  // ── INCREMENTAL PATH ──────────────────────────────────────────────────────
  if (isIncremental) {
    await updateProgress?.(5);
    console.log('[consolidation] Phase 1: Extracting new documents...');
    state.phase = 'extract';

    // Extract only new/modified docs from each source
    if (sources.has('qdrant')) {
      try {
        const docs = await extractQdrantCollections(since);
        allDocs.push(...docs);
        console.log(`[consolidation]   Qdrant: ${docs.length} new documents`);
      } catch (err) {
        state.errors.push(`Qdrant: ${err instanceof Error ? err.message : err}`);
      }
    }

    if (sources.has('postgres')) {
      try {
        const docs = await extractPostgresMemories(ctx.storage, since);
        allDocs.push(...docs);
        console.log(`[consolidation]   PostgreSQL: ${docs.length} new documents`);
      } catch (err) {
        state.errors.push(`PostgreSQL: ${err instanceof Error ? err.message : err}`);
      }
    }

    if (sources.has('drive')) {
      try {
        const docs = await extractDriveFiles({
          googleAccessToken: ctx.googleAccessToken,
          googleRefreshToken: ctx.googleRefreshToken,
          googleClientId: ctx.googleClientId,
          googleClientSecret: ctx.googleClientSecret,
          updateGoogleTokens: ctx.updateGoogleTokens,
        }, since);
        allDocs.push(...docs);
        console.log(`[consolidation]   Google Drive: ${docs.length} new documents`);
      } catch (err) {
        state.errors.push(`Drive: ${err instanceof Error ? err.message : err}`);
      }
    }

    if (sources.has('notion')) {
      try {
        const docs = await extractNotionPages(ctx.userId, since);
        allDocs.push(...docs);
        console.log(`[consolidation]   Notion: ${docs.length} new documents`);
      } catch (err) {
        state.errors.push(`Notion: ${err instanceof Error ? err.message : err}`);
      }
    }

    if (sources.has('recall')) {
      try {
        const docs = await extractRecallTranscripts(ctx.recallApiKey, ctx.recallRegion, since);
        allDocs.push(...docs);
        console.log(`[consolidation]   Recall: ${docs.length} new documents`);
      } catch (err) {
        state.errors.push(`Recall: ${err instanceof Error ? err.message : err}`);
      }
    }

    if (sources.has('workspace')) {
      try {
        const docs = await extractWorkspaceFiles(WORKSPACE_PATH, since);
        allDocs.push(...docs);
        console.log(`[consolidation]   Workspace: ${docs.length} new documents`);
      } catch (err) {
        state.errors.push(`Workspace: ${err instanceof Error ? err.message : err}`);
      }
    }

    state.totalDocuments = allDocs.length;
    console.log(`[consolidation] New documents found: ${allDocs.length}`);

    if (allDocs.length === 0) {
      console.log(`[consolidation] Nothing new since ${lastRun!.toISOString()} — skipping`);
      state.phase = 'done';
      await updateProgress?.(100);
      await saveLastConsolidationAt(ctx.storage);
      return state;
    }

    await updateProgress?.(30);

    // ── Cluster new docs ───────────────────────────────────────────────────
    console.log('[consolidation] Clustering new documents...');
    state.phase = 'cluster';
    const newClusters = await clusterDocuments(allDocs, ctx.openaiKey, ctx.anthropicKey);
    state.clusters = newClusters.length;
    console.log(`[consolidation] Found ${newClusters.length} clusters from new documents`);
    await updateProgress?.(45);

    // ── Match clusters to existing Notion topics ───────────────────────────
    console.log('[consolidation] Matching clusters to existing Notion topics...');
    state.phase = 'consolidate';

    const { getUncachableNotionClient } = await import('../../notion-service');
    const notionClient = await getUncachableNotionClient(ctx.userId);
    const parentPageId = await findOrCreateParentPage(notionClient);
    state.notionParentId = parentPageId;

    const existingTopics = await listExistingTopicPages(notionClient, parentPageId);
    console.log(`[consolidation] Found ${existingTopics.length} existing topic pages`);

    // Each cluster is represented by its label — assign cluster label as the "doc" for matching
    const clusterDocs: NormalizedDocument[] = newClusters.map((c) => ({
      id: `cluster-${c.label}`,
      source: 'qdrant' as const,
      sourceId: c.label,
      title: c.label,
      content: c.documents.map((d) => d.content).join('\n').slice(0, 500),
      category: c.category,
      metadata: {},
    }));

    const { existing: matchedClusters, newTopics: unmatchedClusterDocs } = assignDocsToTopics(clusterDocs, existingTopics);

    // Resolve matched clusters back to full TopicCluster objects
    const matchedTopics: { pageId: string; title: string; cluster: TopicCluster }[] = [];
    for (const [pageId, { title, docs: matchDocs }] of matchedClusters) {
      for (const matchDoc of matchDocs) {
        const cluster = newClusters.find((c) => c.label === matchDoc.sourceId);
        if (cluster) matchedTopics.push({ pageId, title, cluster });
      }
    }

    const unmatchedClusters = unmatchedClusterDocs
      .map((d) => newClusters.find((c) => c.label === d.sourceId))
      .filter((c): c is TopicCluster => c !== undefined);

    console.log(`[consolidation] ${matchedTopics.length} clusters matched to existing topics, ${unmatchedClusters.length} will become new pages`);
    await updateProgress?.(55);

    // ── Consolidate matched clusters (merge with existing content) ─────────
    const updates: { pageId: string; title: string; content: string }[] = [];

    for (let i = 0; i < matchedTopics.length; i++) {
      const { pageId, title, cluster } = matchedTopics[i];
      console.log(`[consolidation] Merging into "${title}" (${i + 1}/${matchedTopics.length})`);

      // Fetch existing page content as a synthetic document
      const existingText = await fetchPageTextContent(notionClient, pageId);
      if (existingText) {
        cluster.documents.unshift({
          id: `existing-notion-${pageId}`,
          source: 'notion',
          sourceId: pageId,
          title: `Existing: ${title}`,
          content: existingText.slice(0, 10000),
          category: cluster.category,
          metadata: { isExistingContent: true },
        });
      }

      const consolidated = await consolidateCluster(cluster, ctx.anthropicKey);
      updates.push({ pageId, title, content: consolidated.content });

      const pct = 55 + Math.round(((i + 1) / matchedTopics.length) * 20);
      await updateProgress?.(pct);
    }

    // ── Consolidate unmatched clusters → new pages ─────────────────────────
    const newPages: ConsolidatedPage[] = [];

    for (let i = 0; i < unmatchedClusters.length; i++) {
      const cluster = unmatchedClusters[i];
      console.log(`[consolidation] Consolidating new topic "${cluster.label}" (${i + 1}/${unmatchedClusters.length})`);
      const page = await consolidateCluster(cluster, ctx.anthropicKey);
      newPages.push(page);

      const pct = 75 + Math.round(((i + 1) / Math.max(unmatchedClusters.length, 1)) * 10);
      await updateProgress?.(pct);
    }

    await updateProgress?.(85);

    if (!options.dryRun) {
      console.log(`[consolidation] Phase 4: Writing incremental updates to Notion...`);
      console.log(`[consolidation]   ${updates.length} pages to update, ${newPages.length} new pages to create`);
      state.phase = 'output';

      await writeToNotionIncremental(updates, newPages, parentPageId, ctx.userId, state);
    } else {
      console.log('[consolidation] Dry run — skipping Notion output');
      state.pagesCreated = updates.length + newPages.length;
    }

    state.phase = 'done';
    await updateProgress?.(100);
    if (taskId) await deleteCheckpoints(taskId).catch(() => {});
    await saveLastConsolidationAt(ctx.storage);

    console.log(`[consolidation] Incremental update complete. ${allDocs.length} new docs → ${newClusters.length} clusters → ${state.pagesCreated} pages updated/created`);
    return state;
  }

  // ── FULL MODE PATH (unchanged from before) ────────────────────────────────

  // ── Phase 1: Extract (0-30%) — skip if checkpointed ─────────────────────
  if (allDocs.length === 0) {
    console.log('[consolidation] Phase 1: Extracting documents...');
    state.phase = 'extract';
    await updateProgress?.(5);

    if (sources.has('qdrant')) {
      try {
        const docs = await extractQdrantCollections();
        allDocs.push(...docs);
        console.log(`[consolidation]   Qdrant: ${docs.length} documents`);
      } catch (err) {
        const msg = `Qdrant extraction failed: ${err instanceof Error ? err.message : err}`;
        state.errors.push(msg);
        console.error(`[consolidation]   ${msg}`);
      }
    }
    await updateProgress?.(10);

    if (sources.has('postgres')) {
      try {
        const docs = await extractPostgresMemories(ctx.storage);
        allDocs.push(...docs);
        console.log(`[consolidation]   PostgreSQL: ${docs.length} documents`);
      } catch (err) {
        const msg = `PostgreSQL extraction failed: ${err instanceof Error ? err.message : err}`;
        state.errors.push(msg);
        console.error(`[consolidation]   ${msg}`);
      }
    }
    await updateProgress?.(14);

    if (sources.has('drive')) {
      try {
        const docs = await extractDriveFiles({
          googleAccessToken: ctx.googleAccessToken,
          googleRefreshToken: ctx.googleRefreshToken,
          googleClientId: ctx.googleClientId,
          googleClientSecret: ctx.googleClientSecret,
          updateGoogleTokens: ctx.updateGoogleTokens,
        });
        allDocs.push(...docs);
        console.log(`[consolidation]   Google Drive: ${docs.length} documents`);
      } catch (err) {
        const msg = `Drive extraction failed: ${err instanceof Error ? err.message : err}`;
        state.errors.push(msg);
        console.error(`[consolidation]   ${msg}`);
      }
    }
    await updateProgress?.(18);

    if (sources.has('notion')) {
      try {
        const docs = await extractNotionPages(ctx.userId);
        allDocs.push(...docs);
        console.log(`[consolidation]   Notion: ${docs.length} documents`);
      } catch (err) {
        const msg = `Notion extraction failed: ${err instanceof Error ? err.message : err}`;
        state.errors.push(msg);
        console.error(`[consolidation]   ${msg}`);
      }
    }
    await updateProgress?.(22);

    if (sources.has('recall')) {
      try {
        const docs = await extractRecallTranscripts(ctx.recallApiKey, ctx.recallRegion);
        allDocs.push(...docs);
        console.log(`[consolidation]   Recall: ${docs.length} documents`);
      } catch (err) {
        const msg = `Recall extraction failed: ${err instanceof Error ? err.message : err}`;
        state.errors.push(msg);
        console.error(`[consolidation]   ${msg}`);
      }
    }
    await updateProgress?.(26);

    if (sources.has('workspace')) {
      try {
        const docs = await extractWorkspaceFiles(WORKSPACE_PATH);
        allDocs.push(...docs);
        console.log(`[consolidation]   Workspace: ${docs.length} documents`);
      } catch (err) {
        const msg = `Workspace extraction failed: ${err instanceof Error ? err.message : err}`;
        state.errors.push(msg);
        console.error(`[consolidation]   ${msg}`);
      }
    }

    state.totalDocuments = allDocs.length;
    console.log(`[consolidation] Total documents extracted: ${allDocs.length}`);

    if (allDocs.length === 0) {
      state.phase = 'done';
      state.errors.push('No documents extracted from any source');
      return state;
    }

    if (taskId) {
      await saveCheckpoint({
        phase: 'phase1',
        taskId,
        timestamp: new Date().toISOString(),
        docs: allDocs,
        errors: [...state.errors],
      }).catch(err => console.warn('[consolidation] Failed to save phase1 checkpoint:', err));
    }

    await updateProgress?.(30);
  }

  // ── Phase 2: Cluster (30-50%) — skip if checkpointed ────────────────────
  let clusters: TopicCluster[];

  if (cachedClusters) {
    clusters = cachedClusters;
    console.log(`[consolidation] Phase 2 skipped (checkpoint): ${clusters.length} clusters`);
  } else {
    console.log('[consolidation] Phase 2: Clustering documents...');
    state.phase = 'cluster';
    await updateProgress?.(35);

    clusters = await clusterDocuments(allDocs, ctx.openaiKey, ctx.anthropicKey);
    state.clusters = clusters.length;
    console.log(`[consolidation] Found ${clusters.length} topic clusters`);

    if (taskId) {
      await saveCheckpoint({
        phase: 'phase2',
        taskId,
        timestamp: new Date().toISOString(),
        docs: allDocs,
        clusters,
        errors: [...state.errors],
      }).catch(err => console.warn('[consolidation] Failed to save phase2 checkpoint:', err));
    }

    await updateProgress?.(50);
  }

  state.clusters = clusters.length;

  // ── Phase 3: Consolidate (50-85%) — skip if checkpointed ────────────────
  let pages: ConsolidatedPage[];

  if (cachedPages) {
    pages = cachedPages;
    console.log(`[consolidation] Phase 3 skipped (checkpoint): ${pages.length} pages ready`);
    await updateProgress?.(85);
  } else {
    console.log('[consolidation] Phase 3: Consolidating clusters...');
    state.phase = 'consolidate';

    pages = await consolidateAllClusters(
      clusters,
      ctx.anthropicKey,
      async (completed, total) => {
        const pct = 50 + Math.round((completed / total) * 35);
        await updateProgress?.(pct);
      },
    );
    console.log(`[consolidation] Consolidated into ${pages.length} pages`);

    if (taskId) {
      await saveCheckpoint({
        phase: 'phase3',
        taskId,
        timestamp: new Date().toISOString(),
        totalDocuments: state.totalDocuments,
        clusters: state.clusters,
        pages,
        errors: [...state.errors],
      }).catch(err => console.warn('[consolidation] Failed to save phase3 checkpoint:', err));
    }

    await updateProgress?.(85);
  }

  // ── Phase 4: Output to Notion (85-100%) ──────────────────────────────────
  if (options.dryRun) {
    console.log('[consolidation] Dry run — skipping Notion output');
    state.phase = 'done';
    state.pagesCreated = pages.length;
    await updateProgress?.(100);
    if (taskId) await deleteCheckpoints(taskId).catch(() => {});
    await saveLastConsolidationAt(ctx.storage);
    return state;
  }

  console.log('[consolidation] Phase 4: Writing to Notion...');
  state.phase = 'output';
  await updateProgress?.(88);

  await writeToNotion(pages, ctx.userId, state);
  console.log(`[consolidation] Wrote ${state.pagesCreated} pages to Notion`);

  state.phase = 'done';
  await updateProgress?.(100);

  // Clean up checkpoints and save timestamp on successful completion
  if (taskId) await deleteCheckpoints(taskId).catch(() => {});
  await saveLastConsolidationAt(ctx.storage);

  console.log(`[consolidation] Pipeline complete. ${state.totalDocuments} docs → ${state.clusters} clusters → ${state.pagesCreated} pages`);
  if (state.errors.length > 0) {
    console.warn(`[consolidation] ${state.errors.length} errors occurred:`, state.errors);
  }

  return state;
}
