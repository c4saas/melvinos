/**
 * Patch Executor
 *
 * Called when the platform owner approves a patch proposal via SMS.
 * Runs Claude Code relay with the stored prompt, then rebuilds + restarts melvinos_app.
 * Reports outcome via SMS.
 */
import http from 'http';
import { exec } from 'child_process';
import { promisify } from 'util';
import type { IStorage } from './storage';
import type { PatchProposal } from '@shared/schema';
import { toolRegistry } from './agent/tool-registry';

const execAsync = promisify(exec);

const RELAY_HOST = process.env.CLAUDE_CODE_HOST ?? 'claude-code';
const RELAY_PORT = parseInt(process.env.CLAUDE_CODE_PORT ?? '3333', 10);
const RELAY_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes for patch application

function callRelay(prompt: string, workdir: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ prompt, allowedTools: [], workdir });

    const req = http.request(
      {
        hostname: RELAY_HOST,
        port: RELAY_PORT,
        path: '/run',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        timeout: RELAY_TIMEOUT_MS,
      },
      (res) => {
        const chunks: string[] = [];
        res.on('data', (c: Buffer) => chunks.push(c.toString()));
        res.on('end', () => {
          const ndjson = chunks.join('');
          const lines = ndjson.split('\n').filter(l => l.trim());
          let result = '';
          const textParts: string[] = [];
          for (const line of lines) {
            try {
              const ev = JSON.parse(line);
              if (ev.type === 'result' && ev.subtype === 'success' && ev.result) result = ev.result;
              else if (ev.type === 'assistant') {
                for (const b of ev.message?.content ?? []) {
                  if (b.type === 'text' && b.text) textParts.push(b.text);
                }
              } else if (ev.type === 'error') {
                reject(new Error(`Claude Code error: ${ev.error}`));
                return;
              }
            } catch { /* skip */ }
          }
          resolve(result || textParts.join('\n') || '(no output)');
        });
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Claude Code relay timed out')); });
    req.write(body);
    req.end();
  });
}

async function sendSms(text: string, storage: IStorage): Promise<void> {
  const settings = await storage.getPlatformSettings();
  const hb = (settings.data as any)?.heartbeat;
  const { contactId, fromNumber, mcpServerId } = hb?.smsConfig ?? {};
  if (!contactId || !mcpServerId) return;

  const toolName = `mcp_${mcpServerId}_conversations_send-a-new-message`;
  if (!toolRegistry.has(toolName)) return;

  const args: Record<string, unknown> = {
    body_type: 'SMS',
    body_contactId: contactId,
    body_message: text.slice(0, 1500),
  };
  if (fromNumber) args.body_fromNumber = fromNumber;

  await toolRegistry.execute(toolName, args, { userId: 'system', conversationId: null, model: '', workspacePath: process.env.AGENT_WORKSPACE_PATH || '/app/workspace' });
}

async function rebuild(): Promise<string> {
  // Rebuild and restart melvinos_app container
  const { stdout, stderr } = await execAsync(
    'cd /opt/melvinos && docker compose build melvinos && docker compose up -d melvinos',
    { timeout: 5 * 60 * 1000 }
  );
  return (stdout + stderr).slice(-1000); // last 1000 chars of build output
}

export async function executePatch(proposal: PatchProposal, storage: IStorage): Promise<void> {
  const { id, code, title, claudePrompt, workdir } = proposal;

  console.log(`[patch-executor] Applying patch ${code}: ${title}`);

  try {
    // Mark as running
    await storage.updatePatchProposal(id, { status: 'approved', resolvedAt: new Date() });

    // Apply via Claude Code relay
    const applyOutput = await callRelay(claudePrompt, workdir ?? '/opt/melvinos');

    // Rebuild + restart
    let buildOutput = '';
    try {
      buildOutput = await rebuild();
    } catch (buildErr: any) {
      console.error('[patch-executor] Build failed:', buildErr.message);
      await storage.updatePatchProposal(id, {
        status: 'failed',
        applyOutput,
        error: `Build failed: ${buildErr.message}`,
      });
      await sendSms(`PATCH ${code} FAILED during rebuild: ${buildErr.message.slice(0, 200)}`, storage);
      return;
    }

    await storage.updatePatchProposal(id, {
      status: 'applied',
      appliedAt: new Date(),
      applyOutput: applyOutput + '\n\n--- Build ---\n' + buildOutput,
    });

    console.log(`[patch-executor] Patch ${code} applied successfully`);
    await sendSms(`PATCH ${code} applied. ${title} — system rebuilt and restarted.`, storage);
  } catch (err: any) {
    console.error(`[patch-executor] Patch ${code} failed:`, err.message);
    await storage.updatePatchProposal(id, {
      status: 'failed',
      error: err.message,
    });
    await sendSms(`PATCH ${code} FAILED: ${err.message.slice(0, 200)}`, storage);
  }
}
