import type { IStorage } from '../../storage';
import type { ToolDefinition, ToolResult, ToolContext } from '../tool-registry';
import {
  indexMemory,
  semanticSearchMemories,
  deleteMemoryVector,
  isQdrantAvailable,
} from '../../qdrant-memory';

let storageRef: IStorage | null = null;

export function setMemoryStorage(storage: IStorage): void {
  storageRef = storage;
}

async function getOpenAIKey(): Promise<string | null> {
  if (!storageRef) return null;
  try {
    const settings = await storageRef.getPlatformSettings();
    const key = (settings.data as any)?.aiProviders?.openai?.apiKey
      || (settings.data as any)?.apiProviders?.openai?.defaultApiKey
      || process.env.OPENAI_API_KEY
      || null;
    return key || null;
  } catch {
    return process.env.OPENAI_API_KEY || null;
  }
}

export const memoryDeleteTool: ToolDefinition = {
  name: 'memory_delete',
  description:
    'Delete a specific memory that the user has asked to be forgotten. First use memory_search to find the memory and get its ID, then call this tool with that ID. Only use this when the user explicitly asks to forget or delete a specific memory.',
  parameters: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'The ID of the memory to delete (obtained from memory_search results)',
      },
      confirm_content: {
        type: 'string',
        description: 'A brief description of what is being deleted, for confirmation in the response',
      },
    },
    required: ['id'],
  },

  async execute(args: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
    if (!storageRef) {
      return { output: '', error: 'Memory storage not initialized' };
    }

    const id = String(args.id ?? '').trim();
    if (!id) {
      return { output: '', error: 'Memory ID is required' };
    }

    try {
      await storageRef.deleteAgentMemory(id);
      // Remove from Qdrant vector index (fire-and-forget)
      deleteMemoryVector(id).catch((err) => {
        console.error('[memory-store] Qdrant delete failed:', err instanceof Error ? err.message : err);
      });
      const label = args.confirm_content ? ` ("${String(args.confirm_content)}")` : '';
      return { output: `Memory${label} has been deleted.` };
    } catch (err: any) {
      return { output: '', error: `Failed to delete memory: ${err.message}` };
    }
  },
};

export const memorySaveTool: ToolDefinition = {
  name: 'memory_save',
  description:
    'Save a piece of information to persistent memory. Use this to remember facts, preferences, decisions, or anything that should persist across conversations. Provide a short title and the content to remember.',
  parameters: {
    type: 'object',
    properties: {
      content: {
        type: 'string',
        description: 'The information to remember',
      },
      category: {
        type: 'string',
        description: 'Category for this memory (e.g. "preference", "fact", "procedure", "context")',
      },
      source: {
        type: 'string',
        description: 'Optional source or context where this memory came from',
      },
    },
    required: ['content', 'category'],
  },

  async execute(args: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
    if (!storageRef) {
      return { output: '', error: 'Memory storage not initialized' };
    }

    const content = String(args.content ?? '');
    const category = String(args.category ?? 'general');
    const source = args.source ? String(args.source) : undefined;

    if (!content.trim()) {
      return { output: '', error: 'Content is required' };
    }

    try {
      const memory = await storageRef.createAgentMemory({
        content,
        category,
        source,
      });

      // Index in Qdrant for semantic search (fire-and-forget)
      getOpenAIKey().then((apiKey) => {
        if (apiKey) {
          indexMemory(memory.id, content, category, apiKey).catch((err) => {
            console.error('[memory-store] Qdrant index failed:', err instanceof Error ? err.message : err);
          });
        }
      }).catch((err) => {
        console.error('[memory-store] Failed to get OpenAI key for Qdrant indexing:', err instanceof Error ? err.message : err);
      });

      return { output: `Remembered [${category}]: ${content.slice(0, 120)}${content.length > 120 ? '…' : ''}` };
    } catch (err: any) {
      return { output: '', error: err.message };
    }
  },
};

export const memorySearchTool: ToolDefinition = {
  name: 'memory_search',
  description:
    'Search persistent memories for previously saved information. Use this to recall facts, preferences, or decisions from past conversations.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search term or topic to look for in memories',
      },
      category: {
        type: 'string',
        description: 'Optional category filter (e.g. "preference", "fact", "procedure")',
      },
    },
    required: ['query'],
  },

  async execute(args: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
    if (!storageRef) {
      return { output: '', error: 'Memory storage not initialized' };
    }

    const query = String(args.query ?? '');
    if (!query.trim()) {
      return { output: '', error: 'Search query cannot be empty' };
    }

    const category = args.category ? String(args.category) : undefined;

    try {
      // Try Qdrant semantic search first
      const apiKey = await getOpenAIKey();
      if (apiKey && await isQdrantAvailable()) {
        try {
          const hits = await semanticSearchMemories(query, 20, apiKey);
          let results = hits;

          // Apply category filter if provided
          if (category) {
            results = results.filter((h) => h.category === category);
          }

          if (results.length > 0) {
            const formatted = results
              .map((h) => `- ID: ${h.id} | [${h.category}] ${h.content}`)
              .join('\n');
            return { output: `Found ${results.length} memories:\n\n${formatted}` };
          }
          // Fall through to PG search if Qdrant returned nothing
        } catch (qdrantErr) {
          console.error('[memory-store] Qdrant search failed, falling back to PG:', qdrantErr instanceof Error ? qdrantErr.message : qdrantErr);
        }
      }

      // Fallback: PostgreSQL ILIKE search
      let memories = await storageRef.searchAgentMemories(query, 20);
      if (category) {
        memories = memories.filter((m) => m.category === category);
      }

      if (memories.length === 0) {
        return { output: 'No memories found matching that query.' };
      }

      const formatted = memories
        .map((m) => `- ID: ${m.id} | [${m.category}] ${m.content}`)
        .join('\n');

      return { output: `Found ${memories.length} memories:\n\n${formatted}` };
    } catch (err: any) {
      return { output: '', error: err.message };
    }
  },
};
