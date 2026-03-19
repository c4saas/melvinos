/**
 * Encrypt/decrypt sensitive fields in platform settings data.
 *
 * Sensitive fields are encrypted at rest in the database using AES-256-GCM.
 * When reading settings, fields are decrypted transparently.
 * When writing settings, fields are encrypted before storage.
 *
 * Encrypted values are prefixed with "enc:" to distinguish from plaintext.
 */

import { encryptSecret, decryptSecret } from './secret-storage';

// Paths to sensitive fields within platform_settings.data
const SENSITIVE_PATHS = [
  // API provider keys
  ['apiProviders', 'anthropic', 'defaultApiKey'],
  ['apiProviders', 'openai', 'defaultApiKey'],
  ['apiProviders', 'groq', 'defaultApiKey'],
  ['apiProviders', 'google', 'defaultApiKey'],
  ['apiProviders', 'perplexity', 'defaultApiKey'],
  ['apiProviders', 'ollama', 'defaultApiKey'],
  // Integration tokens
  ['integrations', 'notion', 'integrationToken'],
  ['integrations', 'recall', 'apiKey'],
] as const;

const ENC_PREFIX = 'enc:';

function getNestedValue(obj: Record<string, any>, path: readonly string[]): string | undefined {
  let current: any = obj;
  for (const key of path) {
    if (!current || typeof current !== 'object') return undefined;
    current = current[key];
  }
  return typeof current === 'string' ? current : undefined;
}

function setNestedValue(obj: Record<string, any>, path: readonly string[], value: string): void {
  let current: any = obj;
  for (let i = 0; i < path.length - 1; i++) {
    if (!current[path[i]] || typeof current[path[i]] !== 'object') {
      current[path[i]] = {};
    }
    current = current[path[i]];
  }
  current[path[path.length - 1]] = value;
}

/**
 * Encrypt sensitive fields before writing to database.
 * Only encrypts non-empty, non-already-encrypted values.
 */
export function encryptSettingsData(data: Record<string, any>): Record<string, any> {
  const clone = JSON.parse(JSON.stringify(data));

  for (const path of SENSITIVE_PATHS) {
    const value = getNestedValue(clone, path);
    if (value && !value.startsWith(ENC_PREFIX)) {
      try {
        const { cipherText } = encryptSecret(value);
        setNestedValue(clone, path, ENC_PREFIX + cipherText);
      } catch (err) {
        // If encryption fails (no key configured), leave plaintext
        console.warn(`[settings-encryption] Could not encrypt ${path.join('.')}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  // Encrypt SSH private keys
  if (Array.isArray(clone.sshServers)) {
    for (const server of clone.sshServers) {
      if (server.privateKey && !server.privateKey.startsWith(ENC_PREFIX)) {
        try {
          const { cipherText } = encryptSecret(server.privateKey);
          server.privateKey = ENC_PREFIX + cipherText;
        } catch {}
      }
    }
  }

  // Encrypt MCP server headers with auth tokens
  if (Array.isArray(clone.mcpServers)) {
    for (const mcp of clone.mcpServers) {
      if (mcp.headers) {
        for (const [key, val] of Object.entries(mcp.headers)) {
          if (typeof val === 'string' && !val.startsWith(ENC_PREFIX) &&
              (key.toLowerCase().includes('authorization') || key.toLowerCase().includes('token'))) {
            try {
              const { cipherText } = encryptSecret(val);
              mcp.headers[key] = ENC_PREFIX + cipherText;
            } catch {}
          }
        }
      }
    }
  }

  return clone;
}

/**
 * Decrypt sensitive fields after reading from database.
 */
export function decryptSettingsData(data: Record<string, any>): Record<string, any> {
  const clone = JSON.parse(JSON.stringify(data));

  for (const path of SENSITIVE_PATHS) {
    const value = getNestedValue(clone, path);
    if (value && value.startsWith(ENC_PREFIX)) {
      try {
        const decrypted = decryptSecret(value.slice(ENC_PREFIX.length));
        setNestedValue(clone, path, decrypted);
      } catch (err) {
        console.error(`[settings-encryption] Could not decrypt ${path.join('.')}: ${err instanceof Error ? err.message : err}`);
        // Leave the encrypted value — don't expose raw ciphertext as if it were a key
        setNestedValue(clone, path, '');
      }
    }
  }

  // Decrypt SSH private keys
  if (Array.isArray(clone.sshServers)) {
    for (const server of clone.sshServers) {
      if (server.privateKey?.startsWith(ENC_PREFIX)) {
        try {
          server.privateKey = decryptSecret(server.privateKey.slice(ENC_PREFIX.length));
        } catch { server.privateKey = ''; }
      }
    }
  }

  // Decrypt MCP headers
  if (Array.isArray(clone.mcpServers)) {
    for (const mcp of clone.mcpServers) {
      if (mcp.headers) {
        for (const [key, val] of Object.entries(mcp.headers)) {
          if (typeof val === 'string' && val.startsWith(ENC_PREFIX)) {
            try {
              mcp.headers[key] = decryptSecret(val.slice(ENC_PREFIX.length));
            } catch { mcp.headers[key] = ''; }
          }
        }
      }
    }
  }

  return clone;
}

/**
 * Mask sensitive fields for safe display (e.g., API responses).
 * Shows only the last 4 characters.
 */
export function maskSettingsData(data: Record<string, any>): Record<string, any> {
  const clone = JSON.parse(JSON.stringify(data));

  for (const path of SENSITIVE_PATHS) {
    const value = getNestedValue(clone, path);
    if (value && value.length > 4) {
      const last4 = value.slice(-4);
      setNestedValue(clone, path, `${'*'.repeat(Math.min(value.length - 4, 20))}${last4}`);
    }
  }

  if (Array.isArray(clone.sshServers)) {
    for (const server of clone.sshServers) {
      if (server.privateKey && server.privateKey.length > 10) {
        server.privateKey = '****[SSH KEY]****';
      }
    }
  }

  return clone;
}
