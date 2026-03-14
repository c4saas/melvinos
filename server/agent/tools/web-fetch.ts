import type { ToolDefinition, ToolResult, ToolContext } from '../tool-registry';
import { saveToWorkspace, timestampedName } from './workspace-save';

const TIMEOUT_MS = 10_000;
const MAX_RESPONSE_SIZE = 1024 * 1024; // 1 MB

function stripHtmlTags(html: string): string {
  // Remove script/style blocks entirely
  let text = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
  // Replace block elements with newlines
  text = text.replace(/<\/(p|div|h[1-6]|li|tr|br|hr)[\s>]/gi, '\n');
  // Remove remaining tags
  text = text.replace(/<[^>]+>/g, '');
  // Decode common HTML entities
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&nbsp;/g, ' ');
  // Collapse whitespace
  text = text.replace(/\n{3,}/g, '\n\n');
  text = text.replace(/[ \t]+/g, ' ');
  return text.trim();
}

export const webFetchTool: ToolDefinition = {
  name: 'web_fetch',
  description:
    'Fetch the content of a web page or API endpoint. Returns the raw response or extracted text from HTML. Use this to retrieve documentation, API responses, or web page content.',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The URL to fetch',
      },
      extract_text: {
        type: 'boolean',
        description: 'Extract readable text from HTML (default: true). Set to false for raw response.',
        default: true,
      },
    },
    required: ['url'],
  },

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const url = String(args.url ?? '');
    const extractText = args.extract_text !== false;

    if (!url.trim()) {
      return { output: '', error: 'URL cannot be empty' };
    }

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { output: '', error: 'Invalid URL format' };
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { output: '', error: 'Only HTTP and HTTPS URLs are supported' };
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Atlas-Agent/1.0',
          'Accept': 'text/html,application/json,text/plain,*/*',
        },
      });
      clearTimeout(timeout);

      if (!response.ok) {
        return {
          output: '',
          error: `HTTP ${response.status} ${response.statusText}`,
        };
      }

      const contentType = response.headers.get('content-type') ?? '';
      const buffer = await response.arrayBuffer();

      if (buffer.byteLength > MAX_RESPONSE_SIZE) {
        return {
          output: '',
          error: `Response too large (${(buffer.byteLength / 1024).toFixed(0)} KB). Max: ${MAX_RESPONSE_SIZE / 1024} KB`,
        };
      }

      let body = new TextDecoder().decode(buffer);

      if (extractText && contentType.includes('text/html')) {
        body = stripHtmlTags(body);
      }

      // Truncate to reasonable size for LLM context
      const maxChars = 50_000;
      if (body.length > maxChars) {
        body = body.slice(0, maxChars) + `\n\n[Truncated — ${body.length} total characters]`;
      }

      const output = `URL: ${url}\nContent-Type: ${contentType}\nSize: ${buffer.byteLength} bytes\n\n${body}`;

      // Save to workspace
      const host = parsed.hostname.replace(/^www\./, '').replace(/[^a-zA-Z0-9]+/g, '-');
      const fileName = timestampedName(`fetch-${host}`, 'md');
      await saveToWorkspace(context.workspacePath, 'research', fileName, `# Web Fetch: ${url}\n\n${output}`);

      return { output };
    } catch (err: any) {
      if (err.name === 'AbortError') {
        return { output: '', error: `Request timed out after ${TIMEOUT_MS / 1000}s` };
      }
      return { output: '', error: err.message };
    }
  },
};
