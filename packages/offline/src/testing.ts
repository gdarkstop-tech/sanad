import { createHash } from 'node:crypto';
import type {
  FileAdapter,
  HttpClient,
  HttpResponse,
  NetworkAdapter,
  QueueStorage,
} from './types';

/**
 * In-memory adapters.
 *
 * These make the queue testable in Node, which matters more than usual here:
 * a bug in this code loses a recorded lecture, and a lecture happens once.
 * The Expo app supplies the native equivalents.
 */

export class MemoryStorage implements QueueStorage {
  private readonly map = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.map.get(key) ?? null;
  }
  async set(key: string, value: string): Promise<void> {
    this.map.set(key, value);
  }
  async remove(key: string): Promise<void> {
    this.map.delete(key);
  }
  async keys(): Promise<string[]> {
    return [...this.map.keys()];
  }
  /** Simulates an app restart: the data survives, the object does not. */
  clone(): MemoryStorage {
    const copy = new MemoryStorage();
    for (const [key, value] of this.map) copy.map.set(key, value);
    return copy;
  }
}

export class MemoryFiles implements FileAdapter {
  private readonly files = new Map<string, Uint8Array>();

  write(uri: string, bytes: Uint8Array): void {
    this.files.set(uri, bytes);
  }
  async exists(uri: string): Promise<boolean> {
    return this.files.has(uri);
  }
  async size(uri: string): Promise<number> {
    return this.files.get(uri)?.byteLength ?? 0;
  }
  async readChunk(uri: string, offset: number, length: number): Promise<Uint8Array> {
    const data = this.files.get(uri);
    if (!data) throw new Error(`No such file: ${uri}`);
    return data.slice(offset, offset + length);
  }
  async sha256(uri: string): Promise<string> {
    const data = this.files.get(uri);
    if (!data) throw new Error(`No such file: ${uri}`);
    return createHash('sha256').update(Buffer.from(data)).digest('hex');
  }
  async remove(uri: string): Promise<void> {
    this.files.delete(uri);
  }
}

export class MemoryNetwork implements NetworkAdapter {
  private online: boolean;
  private readonly listeners = new Set<(online: boolean) => void>();

  constructor(online = true) {
    this.online = online;
  }
  async isOnline(): Promise<boolean> {
    return this.online;
  }
  onChange(listener: (online: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  setOnline(online: boolean): void {
    this.online = online;
    for (const listener of this.listeners) listener(online);
  }
}

/**
 * A fake server implementing the real upload contract: resumable by offset and
 * idempotent by clientRef. Modelling those two rules exactly is what lets the
 * tests prove the client honours them.
 */
export class FakeUploadServer implements HttpClient {
  readonly sessions = new Map<
    string,
    { id: string; materialId: string; received: Uint8Array[]; totalBytes: number; completed: boolean }
  >();
  private readonly byId = new Map<string, string>();
  /** Force the next N chunk writes to fail, to simulate a dropped link. */
  failNextChunks = 0;
  /** Accept this many chunks, then start failing — a mid-upload drop. */
  failAfterChunks: number | null = null;
  private acceptedChunks = 0;
  /** Truncate the next chunk, to simulate a partial write before a drop. */
  truncateNextChunk = false;
  materialStatus: Record<string, { processingStatus: string; processingError?: string | null }> = {};
  requests: string[] = [];

  private received(id: string): number {
    const session = this.sessions.get(this.byId.get(id) ?? '');
    return session ? session.received.reduce((sum, part) => sum + part.byteLength, 0) : 0;
  }

  async postJson(path: string, body: unknown): Promise<HttpResponse> {
    this.requests.push(`POST ${path}`);

    if (path === '/api/v1/uploads') {
      const input = body as { clientRef: string; totalBytes: number };
      const existing = this.sessions.get(input.clientRef);
      if (existing) {
        // Idempotent: the same clientRef resumes, never duplicates.
        return {
          ok: true,
          status: 200,
          body: {
            upload: {
              uploadSessionId: existing.id,
              materialId: existing.materialId,
              receivedBytes: this.received(existing.id),
              totalBytes: existing.totalBytes,
              status: 'in_progress',
              resumed: true,
            },
          },
        };
      }
      const id = `session-${this.sessions.size + 1}`;
      const materialId = `material-${this.sessions.size + 1}`;
      this.sessions.set(input.clientRef, {
        id,
        materialId,
        received: [],
        totalBytes: input.totalBytes,
        completed: false,
      });
      this.byId.set(id, input.clientRef);
      this.materialStatus[materialId] = { processingStatus: 'uploaded' };
      return {
        ok: true,
        status: 201,
        body: {
          upload: {
            uploadSessionId: id,
            materialId,
            receivedBytes: 0,
            totalBytes: input.totalBytes,
            status: 'pending',
            resumed: false,
          },
        },
      };
    }

    const complete = path.match(/^\/api\/v1\/uploads\/(.+)\/complete$/);
    if (complete) {
      const session = this.sessions.get(this.byId.get(complete[1]!) ?? '');
      if (!session) return { ok: false, status: 404, body: { title: 'Not found' } };
      if (this.received(session.id) !== session.totalBytes) {
        return { ok: false, status: 400, body: { detail: 'Upload is incomplete.' } };
      }
      session.completed = true;
      this.materialStatus[session.materialId] = { processingStatus: 'uploaded' };
      return { ok: true, status: 200, body: { material: { materialId: session.materialId } } };
    }

    return { ok: true, status: 200, body: {} };
  }

  async getJson(path: string): Promise<HttpResponse> {
    this.requests.push(`GET ${path}`);

    const upload = path.match(/^\/api\/v1\/uploads\/([^/]+)$/);
    if (upload) {
      const session = this.sessions.get(this.byId.get(upload[1]!) ?? '');
      if (!session) return { ok: false, status: 404, body: { title: 'Not found' } };
      return {
        ok: true,
        status: 200,
        body: {
          upload: {
            uploadSessionId: session.id,
            materialId: session.materialId,
            receivedBytes: this.received(session.id),
            totalBytes: session.totalBytes,
            status: 'in_progress',
            resumed: false,
          },
        },
      };
    }

    const material = path.match(/^\/api\/v1\/materials\/(.+)$/);
    if (material) {
      const status = this.materialStatus[material[1]!];
      if (!status) return { ok: false, status: 404, body: { title: 'Not found' } };
      return { ok: true, status: 200, body: { material: status } };
    }

    return { ok: true, status: 200, body: {} };
  }

  async putBytes(
    path: string,
    bytes: Uint8Array,
    headers: Record<string, string>,
  ): Promise<HttpResponse> {
    this.requests.push(`PUT ${path}`);

    if (this.failNextChunks > 0) {
      this.failNextChunks -= 1;
      return { ok: false, status: 503, body: { detail: 'Network unavailable' } };
    }
    if (this.failAfterChunks !== null && this.acceptedChunks >= this.failAfterChunks) {
      return { ok: false, status: 503, body: { detail: 'Network unavailable' } };
    }

    const match = path.match(/^\/api\/v1\/uploads\/([^/]+)\/chunk$/);
    const session = this.sessions.get(this.byId.get(match?.[1] ?? '') ?? '');
    if (!session) return { ok: false, status: 404, body: { title: 'Not found' } };

    const offset = Number(headers['x-upload-offset']);
    const expected = this.received(session.id);
    if (offset !== expected) {
      // The real server rejects a wrong offset rather than corrupting the file.
      return {
        ok: false,
        status: 409,
        body: { detail: `Expected ${expected} but received ${offset}` },
      };
    }

    let payload = bytes;
    if (this.truncateNextChunk) {
      this.truncateNextChunk = false;
      payload = bytes.slice(0, Math.floor(bytes.byteLength / 2));
    }
    session.received.push(payload);
    this.acceptedChunks += 1;

    return {
      ok: true,
      status: 200,
      body: {
        upload: {
          uploadSessionId: session.id,
          materialId: session.materialId,
          receivedBytes: this.received(session.id),
          totalBytes: session.totalBytes,
          status: 'in_progress',
          resumed: false,
        },
      },
    };
  }

  /** The bytes the server actually holds, for byte-exactness assertions. */
  assembled(clientRef: string): Uint8Array {
    const session = this.sessions.get(clientRef);
    if (!session) return new Uint8Array();
    const total = session.received.reduce((sum, part) => sum + part.byteLength, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const part of session.received) {
      out.set(part, offset);
      offset += part.byteLength;
    }
    return out;
  }
}
