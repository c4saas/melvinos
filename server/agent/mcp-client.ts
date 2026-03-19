import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { toolRegistry, type ToolDefinition, type ToolResult, type ToolContext } from './tool-registry';
import type { JSONSchema7 } from './types';

export interface McpServerConfig {
  id: string;
  name: string;
  transport: 'stdio' | 'sse' | 'streamable-http';
  // stdio transport
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  // SSE / streamable-http transport
  url?: string;
  headers?: Record<string, string>;
  // state
  enabled: boolean;
}

interface McpConnection {
  config: McpServerConfig;
  client: Client;
  transport: StdioClientTransport | SSEClientTransport | StreamableHTTPClientTransport;
  toolNames: string[];
}

const connections = new Map<string, McpConnection>();

function mcpToolName(serverId: string, toolName: string): string {
  return `mcp_${serverId}_${toolName}`;
}

async function connectServer(config: McpServerConfig): Promise<McpConnection> {
  const existing = connections.get(config.id);
  if (existing) {
    await disconnectServer(config.id);
  }

  const client = new Client(
    { name: 'melvin-agent', version: '1.0.0' },
    { capabilities: {} },
  );

  let transport: StdioClientTransport | SSEClientTransport | StreamableHTTPClientTransport;

  if (config.transport === 'stdio') {
    if (!config.command) {
      throw new Error(`MCP server "${config.name}": command is required for stdio transport`);
    }
    transport = new StdioClientTransport({
      command: config.command,
      args: config.args ?? [],
      env: { ...process.env, ...(config.env ?? {}) } as Record<string, string>,
    });
  } else if (config.transport === 'streamable-http') {
    if (!config.url) {
      throw new Error(`MCP server "${config.name}": url is required for streamable-http transport`);
    }
    const requestInit: RequestInit | undefined = config.headers
      ? { headers: config.headers }
      : undefined;
    transport = new StreamableHTTPClientTransport(new URL(config.url), {
      requestInit,
    });
  } else {
    if (!config.url) {
      throw new Error(`MCP server "${config.name}": url is required for SSE transport`);
    }
    const hasHeaders = config.headers && Object.keys(config.headers).length > 0;
    transport = new SSEClientTransport(new URL(config.url), hasHeaders ? {
      eventSourceInit: { fetch: (url: string | URL | Request, init?: RequestInit) => fetch(url, { ...init, headers: { ...Object.fromEntries(new Headers(init?.headers ?? {}).entries()), ...config.headers } }) },
      requestInit: { headers: config.headers },
    } : undefined);
  }

  await client.connect(transport);

  // Discover tools
  const toolsResult = await client.listTools();
  const toolNames: string[] = [];

  for (const mcpTool of toolsResult.tools) {
    const registryName = mcpToolName(config.id, mcpTool.name);

    const toolDef: ToolDefinition = {
      name: registryName,
      description: `[${config.name}] ${mcpTool.description ?? mcpTool.name}`,
      parameters: (mcpTool.inputSchema ?? { type: 'object', properties: {} }) as JSONSchema7,
      async execute(args: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
        try {
          const MCP_TIMEOUT_MS = 30_000;
          const result = await Promise.race([
            client.callTool({ name: mcpTool.name, arguments: args }),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error(`MCP tool "${mcpTool.name}" timed out after ${MCP_TIMEOUT_MS / 1000}s`)), MCP_TIMEOUT_MS)
            ),
          ]);

          const textParts: string[] = [];
          if (Array.isArray(result.content)) {
            for (const block of result.content) {
              if (block.type === 'text' && typeof block.text === 'string') {
                textParts.push(block.text);
              }
            }
          }

          const output = textParts.join('\n') || JSON.stringify(result.content);
          return {
            output,
            error: result.isError ? output : undefined,
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          // If connection-level error, attempt auto-reconnect for next call
          if (message.includes('closed') || message.includes('disconnected') || message.includes('ECONNREFUSED')) {
            console.warn(`[mcp] Connection lost for "${config.name}", scheduling reconnect...`);
            void autoReconnect(config.id);
          }
          return { output: '', error: `MCP tool "${mcpTool.name}" failed: ${message}` };
        }
      },
    };

    // Only register if not already taken
    if (!toolRegistry.has(registryName)) {
      toolRegistry.register(toolDef);
      toolNames.push(registryName);
    }
  }

  const connection: McpConnection = { config, client, transport, toolNames };
  connections.set(config.id, connection);

  console.log(
    `[mcp] Connected to "${config.name}" (${config.transport}) — ${toolNames.length} tools registered`,
  );

  return connection;
}

async function disconnectServer(serverId: string): Promise<void> {
  const connection = connections.get(serverId);
  if (!connection) return;

  // Unregister tools
  for (const name of connection.toolNames) {
    toolRegistry.unregister(name);
  }

  try {
    await connection.client.close();
  } catch (err) {
    console.warn(`[mcp] Error closing connection to "${connection.config.name}":`, err);
  }

  connections.delete(serverId);
  console.log(`[mcp] Disconnected from "${connection.config.name}"`);
}

const reconnectingServers = new Set<string>();

async function autoReconnect(serverId: string): Promise<void> {
  if (reconnectingServers.has(serverId)) return;
  const existing = connections.get(serverId);
  if (!existing) return;
  reconnectingServers.add(serverId);
  try {
    await new Promise(r => setTimeout(r, 2000)); // 2s backoff
    await disconnectServer(serverId);
    await connectServer(existing.config);
    console.log(`[mcp] Auto-reconnected to "${existing.config.name}" successfully`);
  } catch (err) {
    console.error(`[mcp] Auto-reconnect failed for "${existing.config.name}":`, err);
  } finally {
    reconnectingServers.delete(serverId);
  }
}

export async function initMcpServers(configs: McpServerConfig[]): Promise<void> {
  // Disconnect servers no longer in config
  for (const [id] of connections) {
    if (!configs.some((c) => c.id === id && c.enabled)) {
      await disconnectServer(id);
    }
  }

  // Connect enabled servers
  for (const config of configs) {
    if (!config.enabled) {
      await disconnectServer(config.id);
      continue;
    }

    // Skip if already connected with same config
    if (connections.has(config.id)) continue;

    try {
      await connectServer(config);
    } catch (err) {
      console.error(`[mcp] Failed to connect to "${config.name}":`, err);
    }
  }
}

export function getMcpServerStatus(): Array<{
  id: string;
  name: string;
  connected: boolean;
  toolCount: number;
  tools: string[];
}> {
  return [...connections.values()].map((conn) => ({
    id: conn.config.id,
    name: conn.config.name,
    connected: true,
    toolCount: conn.toolNames.length,
    tools: conn.toolNames,
  }));
}

export async function reconnectServer(serverId: string, config: McpServerConfig): Promise<void> {
  await disconnectServer(serverId);
  if (config.enabled) {
    await connectServer(config);
  }
}

export async function disconnectAllServers(): Promise<void> {
  for (const [id] of connections) {
    await disconnectServer(id);
  }
}
