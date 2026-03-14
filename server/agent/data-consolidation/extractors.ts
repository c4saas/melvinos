import type { IStorage } from '../../storage';
import type { NormalizedDocument } from './types';
import { readdir, readFile, stat } from 'fs/promises';
import { join, extname } from 'path';

const QDRANT_URL = process.env.QDRANT_URL || 'http://qdrant:6333';

// ── Qdrant extraction ───────────────────────────────────────────────────────

async function scrollCollection(
  collection: string,
  limit = 100,
): Promise<Array<{ id: string; payload: Record<string, unknown> }>> {
  const points: Array<{ id: string; payload: Record<string, unknown> }> = [];
  let offset: string | number | null = null;

  while (true) {
    const body: Record<string, unknown> = {
      limit,
      with_payload: true,
      with_vector: false,
    };
    if (offset !== null) body.offset = offset;

    const res = await fetch(`${QDRANT_URL}/collections/${collection}/points/scroll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) break;
    const data = (await res.json()) as {
      result: { points: Array<{ id: string; payload: Record<string, unknown> }>; next_page_offset?: string | number };
    };
    points.push(...data.result.points);
    if (!data.result.next_page_offset || data.result.points.length < limit) break;
    offset = data.result.next_page_offset;
  }

  return points;
}

export async function extractQdrantCollections(since?: Date): Promise<NormalizedDocument[]> {
  const docs: NormalizedDocument[] = [];

  try {
    const res = await fetch(`${QDRANT_URL}/collections`);
    if (!res.ok) return docs;

    const data = (await res.json()) as { result: { collections: Array<{ name: string }> } };
    const collections = data.result.collections.map((c) => c.name);

    // Skip melvin-memories (that's our target, not a source) and personal-rag (empty)
    const skip = new Set(['melvin-memories', 'personal-rag']);

    for (const collection of collections) {
      if (skip.has(collection)) continue;

      try {
        const points = await scrollCollection(collection);
        if (points.length === 0) continue;

        for (const point of points) {
          const payload = point.payload;

          // Incremental: skip if modified before the cutoff
          if (since && payload.modified) {
            try {
              if (new Date(payload.modified as string) < since) continue;
            } catch { /* unparseable date — include conservatively */ }
          }
          // Different collections store content differently
          const content =
            (payload.content as string) ||
            (payload.text as string) ||
            (payload.chunk as string) ||
            (payload.post_copy as string) ||
            (payload.prompt as string) ||
            '';

          if (!content.trim()) continue;

          const title =
            (payload.file_title as string) ||
            (payload.title as string) ||
            (payload.name as string) ||
            `${collection} #${String(point.id).slice(0, 8)}`;

          docs.push({
            id: `qdrant-${collection}-${point.id}`,
            source: 'qdrant',
            sourceCollection: collection,
            sourceId: String(point.id),
            title,
            content: content.slice(0, 5000), // cap per-document
            category: (payload.category as string) || collection,
            metadata: {
              collection,
              file_type: payload.file_type,
              owner: payload.owner,
              modified: payload.modified,
            },
          });
        }
      } catch (err) {
        console.error(`[consolidation] Failed to extract from Qdrant collection "${collection}":`, err instanceof Error ? err.message : err);
      }
    }
  } catch (err) {
    console.error('[consolidation] Qdrant extraction failed:', err instanceof Error ? err.message : err);
  }

  return docs;
}

// ── PostgreSQL extraction ───────────────────────────────────────────────────

export async function extractPostgresMemories(storage: IStorage, since?: Date): Promise<NormalizedDocument[]> {
  const docs: NormalizedDocument[] = [];

  try {
    const memories = await storage.listAgentMemories();
    for (const m of memories) {
      // Incremental: skip memories created before the cutoff
      if (since && m.createdAt && new Date(m.createdAt) < since) continue;
      docs.push({
        id: `pg-memory-${m.id}`,
        source: 'postgres',
        sourceId: m.id,
        title: `Memory: ${m.content.slice(0, 60)}`,
        content: m.content,
        category: m.category || 'general',
        metadata: {
          source: m.source,
          createdAt: m.createdAt,
        },
      });
    }

    // Knowledge items
    const users = await storage.listUsers();
    if (users.length > 0) {
      const knowledgeItems = await storage.getKnowledgeItems(users[0].id);
      for (const item of knowledgeItems) {
        docs.push({
          id: `pg-knowledge-${item.id}`,
          source: 'postgres',
          sourceId: item.id.toString(),
          title: item.title || `Knowledge #${item.id}`,
          content: (item as any).content || '',
          category: 'knowledge',
          metadata: { type: (item as any).type },
        });
      }
    }
  } catch (err) {
    console.error('[consolidation] PostgreSQL extraction failed:', err instanceof Error ? err.message : err);
  }

  return docs;
}

// ── Google Drive extraction ─────────────────────────────────────────────────

export async function extractDriveFiles(context: {
  googleAccessToken?: string;
  googleRefreshToken?: string;
  googleClientId?: string;
  googleClientSecret?: string;
  updateGoogleTokens?: (at: string, rt?: string | null, exp?: number | null) => Promise<void>;
}, since?: Date): Promise<NormalizedDocument[]> {
  const docs: NormalizedDocument[] = [];

  if (!context.googleAccessToken || !context.googleClientId || !context.googleClientSecret) {
    console.log('[consolidation] Google Drive: no credentials, skipping');
    return docs;
  }

  try {
    const { GoogleDriveService } = await import('../../google-drive');
    const drive = new GoogleDriveService(
      context.googleClientId,
      context.googleClientSecret,
      'postmessage',
    );
    drive.setTokens(context.googleAccessToken, context.googleRefreshToken);
    if (context.updateGoogleTokens) {
      drive.setTokenRefreshCallback(context.updateGoogleTokens);
    }

    // Search for all documents (Google Docs, Sheets, text files)
    // Incremental: filter by modifiedTime if since is provided
    const sinceClause = since ? ` and modifiedTime > '${since.toISOString()}'` : '';
    const queries = [
      `mimeType = 'application/vnd.google-apps.document'${sinceClause}`,
      `mimeType = 'application/vnd.google-apps.spreadsheet'${sinceClause}`,
    ];

    for (const query of queries) {
      try {
        const result = await drive.searchFiles(query, 50);
        const files = result.files || [];

        for (const file of files) {
          try {
            const content = await drive.getFileContent(file.id);
            if (!content || content.trim().length < 20) continue;

            docs.push({
              id: `drive-${file.id}`,
              source: 'drive',
              sourceId: file.id,
              title: file.name || `Drive File ${file.id}`,
              content: typeof content === 'string' ? content.slice(0, 10000) : '',
              category: 'drive',
              metadata: {
                mimeType: file.mimeType,
                modifiedTime: file.modifiedTime,
                webViewLink: file.webViewLink,
              },
            });
          } catch (err) {
            console.error(`[consolidation] Drive: failed to read "${file.name}":`, err instanceof Error ? err.message : err);
          }
        }
      } catch (err) {
        console.error(`[consolidation] Drive search failed for query "${query}":`, err instanceof Error ? err.message : err);
      }
    }
  } catch (err) {
    console.error('[consolidation] Google Drive extraction failed:', err instanceof Error ? err.message : err);
  }

  return docs;
}

// ── Notion extraction ───────────────────────────────────────────────────────

export async function extractNotionPages(userId: string, since?: Date): Promise<NormalizedDocument[]> {
  const docs: NormalizedDocument[] = [];

  try {
    const { getUncachableNotionClient } = await import('../../notion-service');
    const client = await getUncachableNotionClient(userId);

    // Search all pages
    const searchResult = await client.search({
      filter: { property: 'object', value: 'page' },
      page_size: 100,
    });

    for (const page of searchResult.results) {
      try {
        const p = page as any;

        // Incremental: skip pages not edited after the cutoff
        if (since && p.last_edited_time) {
          if (new Date(p.last_edited_time) < since) continue;
        }

        // Extract title from properties
        let title = 'Untitled';
        if (p.properties?.title?.title?.[0]?.plain_text) {
          title = p.properties.title.title[0].plain_text;
        } else if (p.properties?.Name?.title?.[0]?.plain_text) {
          title = p.properties.Name.title[0].plain_text;
        }

        // Get page blocks for content
        const blocks = await client.blocks.children.list({
          block_id: p.id,
          page_size: 100,
        });

        const textParts: string[] = [];
        for (const block of blocks.results) {
          const b = block as any;
          const richText =
            b.paragraph?.rich_text ||
            b.heading_1?.rich_text ||
            b.heading_2?.rich_text ||
            b.heading_3?.rich_text ||
            b.bulleted_list_item?.rich_text ||
            b.numbered_list_item?.rich_text ||
            b.to_do?.rich_text ||
            [];
          const text = richText.map((r: any) => r.plain_text).join('');
          if (text) textParts.push(text);
        }

        const content = textParts.join('\n');
        if (!content.trim()) continue;

        docs.push({
          id: `notion-${p.id}`,
          source: 'notion',
          sourceId: p.id,
          title,
          content: content.slice(0, 10000),
          category: 'notion',
          metadata: {
            url: p.url,
            lastEdited: p.last_edited_time,
            parentType: p.parent?.type,
          },
        });
      } catch (err) {
        console.error('[consolidation] Notion: failed to read page:', err instanceof Error ? err.message : err);
      }
    }
  } catch (err) {
    console.error('[consolidation] Notion extraction failed:', err instanceof Error ? err.message : err);
  }

  return docs;
}

// ── Recall extraction ───────────────────────────────────────────────────────

export async function extractRecallTranscripts(recallApiKey?: string, recallRegion?: string, since?: Date): Promise<NormalizedDocument[]> {
  const docs: NormalizedDocument[] = [];

  if (!recallApiKey) {
    console.log('[consolidation] Recall: no API key, skipping');
    return docs;
  }

  try {
    const baseUrl = `https://${recallRegion || 'us-west-2'}.recall.ai/api/v1`;
    const res = await fetch(`${baseUrl}/bot/?status_code=done&ordering=-created_at`, {
      headers: { Authorization: `Token ${recallApiKey}` },
    });

    if (!res.ok) return docs;
    const data = (await res.json()) as { results: Array<{ id: string; meeting_url: string; video_url?: string }> };

    for (const bot of (data.results || []).slice(0, 20) as any[]) {
      // Incremental: skip meetings that started before the cutoff
      if (since && (bot.started_at || bot.created_at)) {
        const meetingDate = new Date(bot.started_at || bot.created_at);
        if (meetingDate < since) continue;
      }
      try {
        const transcriptRes = await fetch(`${baseUrl}/bot/${bot.id}/transcript/`, {
          headers: { Authorization: `Token ${recallApiKey}` },
        });
        if (!transcriptRes.ok) continue;

        const transcript = (await transcriptRes.json()) as Array<{ speaker: string; words: Array<{ text: string }> }>;
        const text = transcript
          .map((seg) => `${seg.speaker}: ${seg.words.map((w) => w.text).join(' ')}`)
          .join('\n');

        if (!text.trim()) continue;

        docs.push({
          id: `recall-${bot.id}`,
          source: 'recall',
          sourceId: bot.id,
          title: `Meeting: ${bot.meeting_url || bot.id}`,
          content: text.slice(0, 10000),
          category: 'meeting',
          metadata: { meetingUrl: bot.meeting_url },
        });
      } catch (err) {
        console.error(`[consolidation] Recall: failed to get transcript for ${bot.id}:`, err instanceof Error ? err.message : err);
      }
    }
  } catch (err) {
    console.error('[consolidation] Recall extraction failed:', err instanceof Error ? err.message : err);
  }

  return docs;
}

// ── Workspace file extraction ───────────────────────────────────────────────

const TEXT_EXTENSIONS = new Set(['.md', '.txt', '.json', '.csv', '.html', '.xml', '.yaml', '.yml', '.log']);

export async function extractWorkspaceFiles(workspacePath: string, since?: Date): Promise<NormalizedDocument[]> {
  const docs: NormalizedDocument[] = [];

  try {
    await walkDir(workspacePath, async (filePath) => {
      const ext = extname(filePath).toLowerCase();
      if (!TEXT_EXTENSIONS.has(ext)) return;

      try {
        const info = await stat(filePath);
        if (info.size > 500_000) return; // skip files > 500KB
        // Incremental: skip files not modified after the cutoff
        if (since && info.mtime < since) return;

        const content = await readFile(filePath, 'utf-8');
        if (!content.trim()) return;

        const relativePath = filePath.replace(workspacePath, '').replace(/^\//, '');

        docs.push({
          id: `workspace-${relativePath}`,
          source: 'workspace',
          sourceId: relativePath,
          title: relativePath,
          content: content.slice(0, 10000),
          category: relativePath.split('/')[0] || 'workspace',
          metadata: { path: relativePath, size: info.size },
        });
      } catch {
        // skip unreadable files
      }
    });
  } catch (err) {
    console.error('[consolidation] Workspace extraction failed:', err instanceof Error ? err.message : err);
  }

  return docs;
}

async function walkDir(dir: string, callback: (filePath: string) => Promise<void>): Promise<void> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walkDir(fullPath, callback);
      } else if (entry.isFile()) {
        await callback(fullPath);
      }
    }
  } catch {
    // directory doesn't exist or not readable
  }
}
