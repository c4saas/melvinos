import { randomUUID } from "crypto";
import fs from "node:fs";
import path from "node:path";

export interface FileWriteRequest {
  ownerId: string;
  buffer: Buffer;
  name: string;
  mimeType: string;
  analyzedContent?: string;
  metadata?: Record<string, unknown> | null;
}

export interface FileRecord {
  id: string;
  ownerId: string;
  buffer: Buffer;
  name: string;
  mimeType: string;
  size: number;
  createdAt: Date;
  expiresAt: Date;
  analyzedContent?: string;
  metadata?: Record<string, unknown> | null;
}

export interface FileStorageAdapter {
  put(input: FileWriteRequest): Promise<FileRecord>;
  get(id: string): Promise<FileRecord | undefined>;
  delete(id: string): Promise<void>;
  getSignedUrl(id: string): Promise<string>;
}

export class FileQuotaExceededError extends Error {
  constructor(public readonly limitBytes: number) {
    super(`File storage quota exceeded. Limit is ${Math.floor(limitBytes / (1024 * 1024))}MB per user.`);
    this.name = "FileQuotaExceededError";
  }
}

export interface InMemoryFileStorageOptions {
  ttlMs?: number;
  quotaBytes?: number;
}

export class InMemoryFileStorage implements FileStorageAdapter {
  private readonly files = new Map<string, FileRecord>();
  private readonly ttlMs: number;
  private readonly quotaBytes: number;
  private readonly locks = new Map<string, Promise<void>>();

  constructor(options: InMemoryFileStorageOptions = {}) {
    this.ttlMs = options.ttlMs ?? 24 * 60 * 60 * 1000; // 24 hours
    this.quotaBytes = options.quotaBytes ?? 5 * 1024 * 1024 * 1024; // 5GB per user by default
  }

  async put(input: FileWriteRequest): Promise<FileRecord> {
    const previousLock = this.locks.get(input.ownerId) || Promise.resolve();
    
    let resolve: () => void;
    const currentLock = previousLock.then(() => new Promise<void>((r) => { resolve = r; }));
    this.locks.set(input.ownerId, currentLock);

    await previousLock;

    try {
      this.cleanupExpired();

      const now = Date.now();
      const size = input.buffer.byteLength;
      const usage = this.calculateUsage(input.ownerId);

      if (usage + size > this.quotaBytes) {
        throw new FileQuotaExceededError(this.quotaBytes);
      }

      const record: FileRecord = {
        id: randomUUID(),
        ownerId: input.ownerId,
        buffer: input.buffer,
        name: input.name,
        mimeType: input.mimeType,
        size,
        createdAt: new Date(now),
        expiresAt: new Date(now + this.ttlMs),
        analyzedContent: input.analyzedContent,
        metadata: input.metadata ?? null,
      };

      this.files.set(record.id, record);

      return record;
    } finally {
      resolve!();
      if (this.locks.get(input.ownerId) === currentLock) {
        this.locks.delete(input.ownerId);
      }
    }
  }

  async get(id: string): Promise<FileRecord | undefined> {
    this.cleanupExpired();
    const record = this.files.get(id);

    if (!record) {
      return undefined;
    }

    if (record.expiresAt.getTime() <= Date.now()) {
      this.files.delete(id);
      return undefined;
    }

    return record;
  }

  async delete(id: string): Promise<void> {
    this.files.delete(id);
  }

  async getSignedUrl(id: string): Promise<string> {
    return `/api/files/${id}`;
  }

  private calculateUsage(ownerId: string): number {
    let total = 0;
    for (const file of Array.from(this.files.values())) {
      if (file.ownerId === ownerId && file.expiresAt.getTime() > Date.now()) {
        total += file.size;
      }
    }
    return total;
  }

  private cleanupExpired(): void {
    const now = Date.now();
    for (const [id, file] of Array.from(this.files.entries())) {
      if (file.expiresAt.getTime() <= now) {
        this.files.delete(id);
      }
    }
  }
}

// ── Disk-backed file storage (persists across restarts) ───────────
export interface DiskFileStorageOptions {
  directory?: string;
  quotaBytes?: number;
}

interface DiskFileMeta {
  id: string;
  ownerId: string;
  name: string;
  mimeType: string;
  size: number;
  createdAt: string;
  analyzedContent?: string;
  metadata?: Record<string, unknown> | null;
}

export class DiskFileStorage implements FileStorageAdapter {
  private readonly dir: string;
  private readonly quotaBytes: number;

  constructor(options: DiskFileStorageOptions = {}) {
    this.dir = options.directory ?? path.join(process.cwd(), 'uploads', 'files');
    this.quotaBytes = options.quotaBytes ?? 5 * 1024 * 1024 * 1024; // 5GB per user
    fs.mkdirSync(this.dir, { recursive: true });
  }

  private metaPath(id: string): string {
    return path.join(this.dir, `${id}.meta.json`);
  }

  private dataPath(id: string): string {
    return path.join(this.dir, `${id}.data`);
  }

  async put(input: FileWriteRequest): Promise<FileRecord> {
    const id = randomUUID();
    const size = input.buffer.byteLength;
    const now = new Date();

    const meta: DiskFileMeta = {
      id,
      ownerId: input.ownerId,
      name: input.name,
      mimeType: input.mimeType,
      size,
      createdAt: now.toISOString(),
      analyzedContent: input.analyzedContent,
      metadata: input.metadata ?? null,
    };

    fs.writeFileSync(this.dataPath(id), input.buffer);
    fs.writeFileSync(this.metaPath(id), JSON.stringify(meta));

    return {
      id,
      ownerId: input.ownerId,
      buffer: input.buffer,
      name: input.name,
      mimeType: input.mimeType,
      size,
      createdAt: now,
      expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000), // 30 days
      analyzedContent: input.analyzedContent,
      metadata: input.metadata ?? null,
    };
  }

  async get(id: string): Promise<FileRecord | undefined> {
    const metaFile = this.metaPath(id);
    const dataFile = this.dataPath(id);

    if (!fs.existsSync(metaFile) || !fs.existsSync(dataFile)) {
      return undefined;
    }

    try {
      const meta: DiskFileMeta = JSON.parse(fs.readFileSync(metaFile, 'utf-8'));
      const buffer = fs.readFileSync(dataFile);

      return {
        id: meta.id,
        ownerId: meta.ownerId,
        buffer,
        name: meta.name,
        mimeType: meta.mimeType,
        size: meta.size,
        createdAt: new Date(meta.createdAt),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        analyzedContent: meta.analyzedContent,
        metadata: meta.metadata,
      };
    } catch {
      return undefined;
    }
  }

  async delete(id: string): Promise<void> {
    try { fs.unlinkSync(this.dataPath(id)); } catch { /* ignore */ }
    try { fs.unlinkSync(this.metaPath(id)); } catch { /* ignore */ }
  }

  async getSignedUrl(id: string): Promise<string> {
    return `/api/files/${id}`;
  }
}

export function createFileStorage(): FileStorageAdapter {
  const ttlStr = process.env.FILE_STORAGE_TTL_MS;
  const quotaStr = process.env.FILE_STORAGE_QUOTA_BYTES;
  const ttlMs = ttlStr !== undefined ? Number(ttlStr) : undefined;
  const quotaBytes = quotaStr !== undefined ? Number(quotaStr) : undefined;

  if (ttlStr !== undefined && Number.isNaN(ttlMs)) {
    throw new Error("Invalid FILE_STORAGE_TTL_MS");
  }
  if (quotaStr !== undefined && Number.isNaN(quotaBytes)) {
    throw new Error("Invalid FILE_STORAGE_QUOTA_BYTES");
  }

  // Use disk storage for persistence across restarts (mounted at /app/uploads)
  const uploadsDir = process.env.FILE_STORAGE_DIR ?? path.join(process.cwd(), 'uploads', 'files');
  return new DiskFileStorage({ directory: uploadsDir, quotaBytes });
}
