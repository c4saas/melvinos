import { performWebSearch } from '../../web-search';
import type { ToolDefinition, ToolResult, ToolContext } from '../tool-registry';
import { saveToWorkspace, timestampedName } from './workspace-save';
import { hasNativeSearch, performNativeSearch } from './native-web-search';

export const webSearchTool: ToolDefinition = {
  name: 'web_search',
  description:
    'Search the web for current information. Use this when you need up-to-date data, recent events, or facts you are unsure about. Returns a summary with source citations.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query to look up on the web',
      },
      deep_research: {
        type: 'boolean',
        description: 'Use deep research mode for comprehensive, in-depth analysis. Slower but much more thorough.',
      },
    },
    required: ['query'],
  },

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const query = String(args.query ?? '');
    if (!query.trim()) {
      return { output: '', error: 'Search query cannot be empty' };
    }

    // Thor mode and deep_research always use Perplexity sonar-deep-research
    const useDeepResearch = !!(args.deep_research || context.thorMode);
    if (useDeepResearch) {
      return performPerplexitySearch(query, true, context);
    }

    // Try native search for supported models
    const model = context.model ?? '';
    if (model && hasNativeSearch(model)) {
      try {
        const result = await performNativeSearch(query, model, context);

        let output = result.answer;
        if (result.sources && result.sources.length > 0) {
          output += '\n\nSources:\n' + result.sources.map((s, i) => `[${i + 1}] ${s}`).join('\n');
        }

        // Save to workspace
        const slug = query.slice(0, 50).replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
        const fileName = timestampedName(`web-search-${slug}`, 'md');
        await saveToWorkspace(context.workspacePath, 'research', fileName, `# Web Search: ${query}\n\n${output}`);

        return { output, usage: result.usage };
      } catch (err: any) {
        // Fall back to Perplexity if native search fails
        console.warn(`[web-search] Native search failed for ${model}, falling back to Perplexity:`, err.message);
      }
    }

    // Fallback: Perplexity sonar-pro
    return performPerplexitySearch(query, false, context);
  },
};

async function performPerplexitySearch(
  query: string,
  deepResearch: boolean,
  context: ToolContext,
): Promise<ToolResult> {
  const apiKey =
    (context.platformSettings as any)?.apiProviders?.perplexity?.defaultApiKey
    || process.env.PERPLEXITY_API_KEY;
  if (!apiKey) {
    return { output: '', error: 'Web search is not configured (missing PERPLEXITY_API_KEY)' };
  }

  const result = await performWebSearch(query, deepResearch, apiKey);

  let output = result.answer;
  if (result.sources && result.sources.length > 0) {
    output += '\n\nSources:\n' + result.sources.map((s, i) => `[${i + 1}] ${s}`).join('\n');
  }

  // Save to workspace
  const slug = query.slice(0, 50).replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
  const fileName = timestampedName(`web-search-${slug}`, 'md');
  await saveToWorkspace(context.workspacePath, 'research', fileName, `# Web Search: ${query}\n\n${output}`);

  return { output, usage: result.usage };
}
