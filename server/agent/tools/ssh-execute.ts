import { execFile } from 'child_process';
import { promisify } from 'util';
import { writeFile, unlink, mkdtemp, rmdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import type { ToolDefinition, ToolResult, ToolContext } from '../tool-registry';

const execFileAsync = promisify(execFile);

export const sshExecuteTool: ToolDefinition = {
  name: 'ssh_execute',
  description:
    'Execute a shell command on a configured remote server via SSH. Use when the user asks to run commands, check logs, restart services, or manage files on a remote server. Servers must be configured in Settings > SSH Servers.',
  parameters: {
    type: 'object',
    properties: {
      server: {
        type: 'string',
        description: 'Label of the SSH server to connect to (as shown in Settings > SSH Servers)',
      },
      command: {
        type: 'string',
        description: 'The shell command to run on the remote server',
      },
    },
    required: ['server', 'command'],
  },

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const serverLabel = String(args.server ?? '').trim();
    const command = String(args.command ?? '').trim();

    if (!serverLabel || !command) {
      return { output: '', error: 'Both server and command are required.' };
    }

    const sshServers: any[] = context.platformSettings?.sshServers ?? [];
    const server = sshServers.find(
      (s: any) => s.label?.toLowerCase() === serverLabel.toLowerCase() && s.enabled !== false,
    );

    if (!server) {
      const available = sshServers
        .filter((s: any) => s.enabled !== false)
        .map((s: any) => s.label)
        .join(', ');
      return {
        output: '',
        error: `SSH server "${serverLabel}" not found or disabled. Available: ${available || 'none configured'}. Add servers in Settings > SSH Servers.`,
      };
    }

    if (!server.privateKey?.trim()) {
      return {
        output: '',
        error: `SSH server "${serverLabel}" has no private key configured. Edit it in Settings > SSH Servers.`,
      };
    }

    // Use a unique temp directory (mkdtemp) so key path is unpredictable
    let tmpDir: string | null = null;
    try {
      tmpDir = await mkdtemp(join(tmpdir(), 'ssh-'));
      const keyPath = join(tmpDir, 'key.pem');
      await writeFile(keyPath, server.privateKey.trimEnd() + '\n', { mode: 0o600 });

      const port = String(server.port ?? 22);

      // Use execFile with args array — no shell interpolation, no injection risk
      const sshArgs = [
        '-o', 'BatchMode=yes',
        '-o', 'StrictHostKeyChecking=accept-new',
        '-o', 'ConnectTimeout=10',
        '-o', 'ServerAliveInterval=5',
        '-i', keyPath,
        '-p', port,
        `${server.username}@${server.host}`,
        command,
      ];

      const { stdout, stderr } = await execFileAsync('ssh', sshArgs, { timeout: 30000 });
      const output = [stdout, stderr].filter(Boolean).join('\n').trim();
      return { output: output || '(command completed with no output)' };
    } catch (err: any) {
      const msg = err.stderr ? `${err.message}\n${err.stderr}` : err.message;
      return { output: '', error: `SSH command failed: ${msg}` };
    } finally {
      // Guaranteed cleanup: remove key file and temp directory
      if (tmpDir) {
        const keyPath = join(tmpDir, 'key.pem');
        await unlink(keyPath).catch(() => {});
        await rmdir(tmpDir).catch(() => {});
      }
    }
  },
};
