import type { ToolDefinition, ToolResult, ToolContext } from '../tool-registry';
import { saveToWorkspace, timestampedName } from './workspace-save';

const PERPLEXITY_ENDPOINT = 'https://api.perplexity.ai/chat/completions';

export const deepResearchTool: ToolDefinition = {
  name: 'deep_research',
  description:
    'Perform deep research on a topic using Perplexity sonar-deep-research. This is slower but much more thorough than regular web_search — use it for complex questions requiring comprehensive analysis with citations.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The research question or topic to investigate in depth',
      },
      search_recency_filter: {
        type: 'string',
        description: 'Filter results by recency: month, week, day, hour (default: month)',
        enum: ['month', 'week', 'day', 'hour'],
      },
    },
    required: ['query'],
  },

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const query = String(args.query ?? '');
    const recencyFilter = String(args.search_recency_filter ?? 'month');

    if (!query.trim()) {
      return { output: '', error: 'Research query cannot be empty' };
    }

    const apiKey =
      (context.platformSettings as any)?.apiProviders?.perplexity?.defaultApiKey
      || process.env.PERPLEXITY_API_KEY;
    if (!apiKey) {
      return { output: '', error: 'Deep research is not configured (missing PERPLEXITY_API_KEY)' };
    }

    try {
      const response = await fetch(PERPLEXITY_ENDPOINT, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'sonar-deep-research',
          messages: [
            {
              role: 'system',
              content: 'You are a thorough research analyst. Provide comprehensive, well-structured analysis with specific details, data, and citations.',
            },
            {
              role: 'user',
              content: query,
            },
          ],
          max_tokens: 4000,
          temperature: 0.1,
          search_recency_filter: recencyFilter,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Deep research error ${response.status}:`, errorText);
        return {
          output: '',
          error: `Deep research failed: ${response.status} ${response.statusText}`,
        };
      }

      const data = await response.json();
      const answer = data.choices?.[0]?.message?.content || '';
      const citations = Array.isArray(data.citations) ? data.citations : [];

      let output = answer;
      if (citations.length > 0) {
        output += '\n\nSources:\n' + citations.map((s: string, i: number) => `[${i + 1}] ${s}`).join('\n');
      }

      // Save research report to workspace
      const slug = query.slice(0, 50).replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
      const fileName = timestampedName(`research-${slug}`, 'md');
      const fileContent = `# Research: ${query}\n\n${output}`;
      await saveToWorkspace(context.workspacePath, 'research', fileName, fileContent);

      const usage = data.usage ? {
        model: 'sonar-deep-research',
        promptTokens: data.usage.prompt_tokens ?? 0,
        completionTokens: data.usage.completion_tokens ?? 0,
        totalTokens: data.usage.total_tokens ?? (data.usage.prompt_tokens ?? 0) + (data.usage.completion_tokens ?? 0),
      } : undefined;

      return { output, usage };
    } catch (err: any) {
      return { output: '', error: `Deep research failed: ${err.message}` };
    }
  },
};
