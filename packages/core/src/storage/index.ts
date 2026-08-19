import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Storage abstraction (ARCHITECTURE.md §3.5).
 *
 * The MVP ships a local-disk implementation. The deadline is one week and the
 * target is a laptop, so running MinIO or paying for S3 would add a service for
 * a capability a directory provides adequately at demo scale. S3 slots in
 * behind this interface without touching a caller.
 */
export interface StoredObject {
  key: string;
  byteSize: number;
  checksumSha256: string;
}

export interface StorageProvider {
  readonly name: string;
  put(key: string, data: Buffer): Promise<StoredObject>;
  /** Appends, for resumable uploads; returns the new total size. */
  append(key: string, data: Buffer): Promise<number>;
  get(key: string): Promise<Buffer>;
  stat(key: string): Promise<{ byteSize: number } | null>;
  delete(key: string): Promise<void>;
  /** Absolute path when the backend is local; null otherwise. */
  localPath(key: string): string | null;
}

export function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

/**
 * A storage key is a name, never a caller-supplied path. Rejects traversal,
 * absolute paths, and anything outside a conservative character set.
 */
export function assertSafeKey(key: string): void {
  if (!key || key.length > 400) throw new Error('Invalid storage key');
  if (key.startsWith('/') || key.includes('..')) {
    throw new Error(`Unsafe storage key: ${key}`);
  }
  if (!/^[A-Za-z0-9/_.-]+$/.test(key)) throw new Error(`Unsafe storage key: ${key}`);
}

export class LocalDiskStorage implements StorageProvider {
  readonly name = 'local';

  constructor(private readonly root: string) {}

  private resolve(key: string): string {
    assertSafeKey(key);
    const full = path.resolve(this.root, key);
    // Belt and braces: even with a validated key, never escape the root.
    if (!full.startsWith(path.resolve(this.root) + path.sep)) {
      throw new Error(`Unsafe storage key: ${key}`);
    }
    return full;
  }

  async put(key: string, data: Buffer): Promise<StoredObject> {
    const full = this.resolve(key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, data);
    return { key, byteSize: data.byteLength, checksumSha256: sha256(data) };
  }

  async append(key: string, data: Buffer): Promise<number> {
    const full = this.resolve(key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.appendFile(full, data);
    return (await fs.stat(full)).size;
  }

  async get(key: string): Promise<Buffer> {
    return fs.readFile(this.resolve(key));
  }

  async stat(key: string): Promise<{ byteSize: number } | null> {
    try {
      return { byteSize: (await fs.stat(this.resolve(key))).size };
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    await fs.rm(this.resolve(key), { force: true });
  }

  localPath(key: string): string {
    return this.resolve(key);
  }
}

let cached: StorageProvider | undefined;

export function storage(): StorageProvider {
  cached ??= new LocalDiskStorage(process.env.STORAGE_ROOT ?? '.sanad-storage');
  return cached;
}

/** Test seam. */
export function setStorage(provider: StorageProvider): void {
  cached = provider;
}

/**
 * Keys are derived from IDs, not from the uploaded filename, so a hostile
 * filename cannot influence where bytes land. The original name is preserved
 * in the database for display.
 */
export function storageKeyFor(parts: {
  offeringId: string;
  materialId: string;
  filename: string;
}): string {
  const safeName = parts.filename
    .replace(/[^A-Za-z0-9_.-]/g, '_')
    // Collapse dot runs: '..' in a segment is traversal syntax, and a key that
    // its own validator rejects would fail every upload with such a filename.
    .replace(/\.{2,}/g, '.')
    .replace(/^[.]+/, '')
    .slice(-80) || 'file';
  return `courses/${parts.offeringId}/materials/${parts.materialId}/${safeName}`;
}
