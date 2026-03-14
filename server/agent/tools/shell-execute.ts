import { exec } from 'child_process';
import { resolve } from 'path';
import type { ToolDefinition, ToolResult, ToolContext } from '../tool-registry';

const TIMEOUT_MS = 30_000;
const MAX_OUTPUT = 64 * 1024; // 64 KB

// Commands that are never allowed
const BLOCKED_PATTERNS = [
  /\brm\s+(-[^\s]*\s+)*\//,   // rm with flags targeting / (covers rm -rf /, rm -rf /*)
  /\bmkfs\b/,
  /\bdd\b.*\bof=\/dev\b/,
  /:()\s*\{.*\|.*&\s*\}\s*;/, // fork bomb variants
  /\bshutdown\b/,
  /\breboot\b/,
  /\bkill\s+-9\s+1\b/,        // kill init process
  /\bpkill\s+-9\b/,           // kill all matching processes
];

function isBlocked(command: string): boolean {
  return BLOCKED_PATTERNS.some((pattern) => pattern.test(command));
}

function execAsync(
  command: string,
  options: { cwd: string; timeout: number },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const child = exec(
      command,
      {
        cwd: options.cwd,
        timeout: options.timeout,
        maxBuffer: MAX_OUTPUT,
        env: { ...process.env, TERM: 'dumb' },
      },
      (error, stdout, stderr) => {
        resolve({
          stdout: stdout ?? '',
          stderr: stderr ?? '',
          exitCode: error ? (error as any).code ?? 1 : 0,
        });
      },
    );
    child.stdin?.end();
  });
}

export const shellExecuteTool: ToolDefinition = {
  name: 'shell_execute',
  description:
    'Execute a shell command in the workspace directory. Use this for running build tools, git commands, package managers, system utilities, or any CLI operation. Commands run in bash with a 30-second timeout.',
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The shell command to execute',
      },
    },
    required: ['command'],
  },
  requiresApproval: true,

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const command = String(args.command ?? '');
    if (!command.trim()) {
      return { output: '', error: 'Command cannot be empty' };
    }

    if (isBlocked(command)) {
      return { output: '', error: 'Command blocked by safety policy' };
    }

    const cwd = resolve(context.workspacePath);

    try {
      const { stdout, stderr, exitCode } = await execAsync(command, {
        cwd,
        timeout: TIMEOUT_MS,
      });

      const parts: string[] = [];
      if (stdout.trim()) parts.push(stdout.trim());
      if (stderr.trim()) parts.push(`[stderr]\n${stderr.trim()}`);
      if (parts.length === 0) parts.push('(no output)');

      const output = parts.join('\n\n');

      if (exitCode !== 0) {
        return { output, error: `Exit code: ${exitCode}` };
      }

      return { output };
    } catch (err: any) {
      return { output: '', error: err.message };
    }
  },
};
