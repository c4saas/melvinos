#!/usr/bin/env node
/**
 * Claude Code HTTP Relay
 * Runs as the `claude` user inside the claude-code container.
 * Exposes POST /run to execute `claude -p` headlessly and stream NDJSON back.
 */

const { spawn } = require('child_process');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const CREDS_PATH = path.join(process.env.HOME || '/home/claude', '.claude', '.credentials.json');

const PORT = 3333;
const DEFAULT_TOOLS = 'Bash,Read,Write,Edit,Glob,Grep,WebSearch,WebFetch';
const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

const server = http.createServer((req, res) => {
  // Health check
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }

  // Usage / account info
  if (req.method === 'GET' && req.url === '/usage') {
    let creds;
    try {
      creds = JSON.parse(fs.readFileSync(CREDS_PATH, 'utf8'));
    } catch {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not authenticated — run /usage after logging in' }));
      return;
    }

    const oauth = creds?.claudeAiOauth;
    if (!oauth?.accessToken) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No OAuth token found in credentials' }));
      return;
    }

    // If token is expired, run a trivial claude command to trigger the CLI's built-in refresh
    async function getValidToken() {
      const isExpired = oauth.expiresAt && (oauth.expiresAt - 60000) < Date.now();
      if (!isExpired) return oauth.accessToken;
      // Spawn a minimal claude command — the CLI auto-refreshes the OAuth token
      await new Promise((resolve) => {
        const { spawn: sp } = require('child_process');
        const p = sp('claude', ['-p', 'ping', '--max-turns', '1', '--output-format', 'json'],
          { env: { ...process.env, HOME: '/home/claude' }, timeout: 15000 });
        p.on('close', () => resolve());
        p.on('error', () => resolve());
      });
      // Re-read credentials — CLI should have written a fresh token
      try {
        const fresh = JSON.parse(fs.readFileSync(CREDS_PATH, 'utf8'));
        return fresh?.claudeAiOauth?.accessToken || oauth.accessToken;
      } catch {
        return oauth.accessToken;
      }
    }

    getValidToken().then(token => {
      // Fetch profile from Anthropic
      const apiReq = https.request(
        'https://api.anthropic.com/api/oauth/profile',
        { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } },
        (apiRes) => {
          let data = '';
          apiRes.on('data', chunk => (data += chunk));
          apiRes.on('end', () => {
            try {
              const profile = JSON.parse(data);
              const account = profile.account || {};
              const org = profile.organization || {};
              const result = {
                name: account.full_name || account.display_name || 'Unknown',
                email: account.email || '',
                plan: account.has_claude_max ? 'Claude Max' : account.has_claude_pro ? 'Claude Pro' : 'Free',
                hasMax: Boolean(account.has_claude_max),
                hasPro: Boolean(account.has_claude_pro),
                organizationName: org.name || null,
                createdAt: account.created_at || null,
                expiresAt: creds.claudeAiOauth.expiresAt || null,
                scopes: creds.claudeAiOauth.scopes || [],
              };
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify(result));
            } catch (e) {
              res.writeHead(502, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Failed to parse Anthropic response', raw: data.slice(0, 200) }));
            }
          });
        },
      );
      apiReq.on('error', err => {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      });
      apiReq.end();
    }).catch(err => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    });
    return;
  }

  if (req.method !== 'POST' || req.url !== '/run') {
    res.writeHead(404);
    res.end();
    return;
  }

  let body = '';
  req.on('data', chunk => (body += chunk));
  req.on('end', () => {
    let opts;
    try {
      opts = JSON.parse(body);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      return;
    }

    const { prompt, allowedTools, workdir, model, maxTurns } = opts;
    if (!prompt || typeof prompt !== 'string') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'prompt is required' }));
      return;
    }

    const cwd = workdir || '/workspace';
    const tools = Array.isArray(allowedTools) && allowedTools.length > 0
      ? allowedTools.join(',')
      : DEFAULT_TOOLS;

    const args = [
      '-p', prompt,
      '--output-format', 'stream-json',
      '--allowedTools', tools,
    ];

    if (model && typeof model === 'string') args.push('--model', model);
    if (maxTurns && Number.isInteger(maxTurns) && maxTurns > 0) args.push('--max-turns', String(maxTurns));

    const spawnEnv = { ...process.env, HOME: '/home/claude', SHELL: '/bin/bash' };
    const effort = opts.effort;
    if (effort && ['low', 'medium', 'high'].includes(effort)) {
      spawnEnv.CLAUDE_CODE_EFFORT_LEVEL = effort;
    }

    const proc = spawn('claude', args, { cwd, env: spawnEnv });

    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });

    const killTimer = setTimeout(() => {
      proc.kill('SIGTERM');
      res.write(JSON.stringify({ type: 'error', error: 'Timed out after 5 minutes' }) + '\n');
      res.end();
    }, TIMEOUT_MS);

    proc.stdout.on('data', data => res.write(data));
    proc.stderr.on('data', data => {
      // Log to container stderr — don't send to caller (noisy auth messages etc.)
      process.stderr.write('[claude stderr] ' + data);
    });

    proc.on('close', code => {
      clearTimeout(killTimer);
      res.write(JSON.stringify({ type: 'exit', code }) + '\n');
      res.end();
    });

    proc.on('error', err => {
      clearTimeout(killTimer);
      res.write(JSON.stringify({ type: 'error', error: err.message }) + '\n');
      res.end();
    });
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Claude Code relay listening on :${PORT}`);
});
