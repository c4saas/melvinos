import { writeFile, mkdir } from 'fs/promises';
import { resolve, dirname } from 'path';

/**
 * Save content to the agent workspace in an organized folder structure.
 * Creates parent directories if needed. Silently fails (logs warning)
 * so tool execution is never blocked by workspace save issues.
 */
export async function saveToWorkspace(
  workspacePath: string,
  folder: string,
  filename: string,
  content: string | Buffer,
): Promise<string | null> {
  try {
    const relPath = `${folder}/${filename}`;
    const fullPath = resolve(workspacePath, relPath);

    // Safety: ensure we're still inside workspace
    if (!fullPath.startsWith(resolve(workspacePath))) {
      console.warn('[workspace-save] Path traversal blocked:', relPath);
      return null;
    }

    await mkdir(dirname(fullPath), { recursive: true });

    if (Buffer.isBuffer(content)) {
      await writeFile(fullPath, content);
    } else {
      await writeFile(fullPath, content, 'utf-8');
    }

    return relPath;
  } catch (err) {
    console.warn('[workspace-save] Failed to save:', err);
    return null;
  }
}

/** Generate a timestamped filename: prefix-2026-03-04-143022.ext */
export function timestampedName(prefix: string, ext: string): string {
  const now = new Date();
  const ts = now.toISOString().replace(/[T:]/g, '-').replace(/\.\d+Z$/, '');
  return `${prefix}-${ts}.${ext}`;
}
