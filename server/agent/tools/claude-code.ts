import http from 'http';
import type { ToolDefinition, ToolResult, ToolContext } from '../tool-registry';

const RELAY_HOST = process.env.CLAUDE_CODE_HOST ?? 'claude-code';
const RELAY_PORT = parseInt(process.env.CLAUDE_CODE_PORT ?? '3333', 10);
const TIMEOUT_MS = 5 * 60 * 1000;

/** Claude Code NDJSON event from `claude -p --output-format stream-json` */
interface CCEvent {
  type: string;
  subtype?: string;
  result?: string;
  error?: string;
  message?: {
    role: string;
    content: Array<{
      type: string;
      text?: string;
      id?: string;
      name?: string;
      input?: Record<string, unknown>;
    }>;
  };
  tool_use_id?: string;
  content?: string | Array<{ type: string; text?: string }>;
}

function extractResult(ndjson: string): string {
  const lines = ndjson.split('\n').filter((l) => l.trim());
  let finalResult = '';
  const assistantText: string[] = [];

  for (const line of lines) {
    try {
      const event: CCEvent = JSON.parse(line);
      if (event.type === 'result' && event.subtype === 'success' && event.result) {
        finalResult = event.result;
      } else if (event.type === 'assistant') {
        for (const block of event.message?.content ?? []) {
          if (block.type === 'text' && block.text) assistantText.push(block.text);
        }
      } else if (event.type === 'error') {
        return `Error from Claude Code: ${event.error}`;
      }
    } catch {
      // skip unparseable lines
    }
  }

  return finalResult || assistantText.join('\n') || '(no output)';
}

function callRelay(
  prompt: string,
  allowedTools: string[],
  workdir: string,
  emitEvent?: ToolContext['emitEvent'],
  model?: string,
  maxTurns?: number,
  effort?: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ prompt, allowedTools, workdir, model, maxTurns, effort });

    const req = http.request(
      {
        hostname: RELAY_HOST,
        port: RELAY_PORT,
        path: '/run',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: TIMEOUT_MS,
      },
      (res) => {
        let lineBuffer = '';
        const allChunks: string[] = [];

        // Track in-flight Claude Code sub-tool calls to pair with results
        const runningSubTools = new Map<string, { name: string; startMs: number }>();

        res.on('data', (chunk: Buffer) => {
          const str = chunk.toString();
          allChunks.push(str);
          lineBuffer += str;

          const lines = lineBuffer.split('\n');
          lineBuffer = lines.pop() ?? '';

          if (!emitEvent) return;

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const event: CCEvent = JSON.parse(line);

              // Emit sub-tool_call for each tool_use block in assistant messages
              if (event.type === 'assistant' && event.message?.content) {
                for (const block of event.message.content) {
                  if (block.type === 'tool_use' && block.id && block.name) {
                    const subId = `cc_${block.id}`;
                    const subName = `cc_${block.name}`;
                    runningSubTools.set(block.id, { name: subName, startMs: Date.now() });
                    emitEvent({ type: 'tool_call', id: subId, tool: subName, args: block.input ?? {} });
                  }
                  // Stream CC assistant text to client in real-time
                  if (block.type === 'text' && block.text) {
                    emitEvent({ type: 'cc_text', text: block.text });
                  }
                }
              }

              // Emit sub-tool_result when we get the tool response
              if (event.type === 'tool' && event.tool_use_id) {
                const tracked = runningSubTools.get(event.tool_use_id);
                if (tracked) {
                  const subId = `cc_${event.tool_use_id}`;
                  const output =
                    typeof event.content === 'string'
                      ? event.content
                      : Array.isArray(event.content)
                        ? event.content.map((c) => c.text ?? '').join('')
                        : '';
                  emitEvent({
                    type: 'tool_result',
                    id: subId,
                    tool: tracked.name,
                    output,
                    durationMs: Date.now() - tracked.startMs,
                  });
                  runningSubTools.delete(event.tool_use_id);
                }
              }
            } catch {
              // skip non-JSON lines
            }
          }
        });

        res.on('end', () => resolve(extractResult(allChunks.join(''))));
        res.on('error', reject);
      },
    );

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Claude Code relay request timed out'));
    });
    req.write(body);
    req.end();
  });
}

export const claudeCodeTool: ToolDefinition = {
  name: 'claude_code',
  description:
    'Delegate a software engineering task to Claude Code — a full agentic coding assistant running in a dedicated container. It can read, write, and edit files, run shell commands, search the codebase, and browse the web. Use this for complex coding tasks, multi-file refactors, debugging, code generation, or any task that benefits from an autonomous coding agent working in the /workspace directory.',
  parameters: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description:
          'The coding task or question to send to Claude Code. Be specific: mention which files to work with, what changes are needed, and the expected outcome.',
      },
      workdir: {
        type: 'string',
        description:
          'Working directory within the container (default: /workspace). Use a subdirectory to scope work to a specific project.',
      },
      model: {
        type: 'string',
        description:
          'Claude model to use for the coding task (e.g. "claude-opus-4-6" for harder tasks, "claude-sonnet-4-6" for speed). Defaults to the container default.',
      },
      maxTurns: {
        type: 'number',
        description:
          'Maximum number of agentic turns Claude Code can take (default: unlimited). Use a smaller number to limit scope.',
      },
      effort: {
        type: 'string',
        enum: ['low', 'medium', 'high'],
        description:
          'Effort level for Claude Code: low (fast, less thinking), medium (balanced), high (maximum reasoning, ~32k thinking tokens). Defaults to high.',
      },
    },
    required: ['prompt'],
  },

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const prompt = String(args.prompt ?? '').trim();
    if (!prompt) return { output: '', error: 'prompt is required' };

    const workdir = String(args.workdir ?? '/workspace');
    // Tool args take priority; fall back to session-level context defaults
    const model = (args.model ? String(args.model) : undefined) ?? (context as any).ccModel;
    const maxTurns = typeof args.maxTurns === 'number' ? Math.floor(args.maxTurns) : undefined;
    const effort = (args.effort ? String(args.effort) : undefined) ?? (context as any).ccEffort;

    try {
      const result = await callRelay(prompt, [], workdir, context.emitEvent, model, maxTurns, effort);
      return { output: result };
    } catch (err: any) {
      const msg: string = err.message ?? String(err);
      if (msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND') || msg.includes('connect')) {
        return {
          output: '',
          error: 'Claude Code container is not reachable. Make sure it is running: docker compose up -d claude-code',
        };
      }
      return { output: '', error: msg };
    }
  },
};
