import { createHash } from 'node:crypto';
import { describe, expect, it, beforeEach } from 'vitest';
import { ContentCache, Sha256, UploadQueue, backoffMs, base64ToBytes, sha256Hex } from '@sanad/offline';
import {
  FakeUploadServer,
  MemoryFiles,
  MemoryNetwork,
  MemoryStorage,
} from '@sanad/offline/testing';

/**
 * The offline recording queue.
 *
 * A bug here loses a recorded lecture, and a lecture happens once — so these
 * tests exercise the failure paths (no network, mid-upload drop, app restart,
 * ambiguous retry) at least as hard as the happy one.
 */

let storage: MemoryStorage;
let files: MemoryFiles;
let http: FakeUploadServer;
let network: MemoryNetwork;
let queue: UploadQueue;

const OFFERING = 'offering-1';
const RECORDING = new Uint8Array(1_400_000).map((_, i) => i % 251);

function build(online = true) {
  network = new MemoryNetwork(online);
  queue = new UploadQueue(storage, files, http, network);
  return queue;
}

beforeEach(() => {
  storage = new MemoryStorage();
  files = new MemoryFiles();
  http = new FakeUploadServer();
  build(true);
});

async function record(clientRef = 'ref-1', bytes: Uint8Array = RECORDING) {
  const uri = `file://recordings/${clientRef}.m4a`;
  await queue.registerRecording({
    clientRef,
    localUri: uri,
    offeringId: OFFERING,
    title: 'Lecture 01',
  });
  files.write(uri, bytes);
  return queue.finishRecording(clientRef, { durationMs: 45_000 });
}

describe('recording without a network', () => {
  it('records and queues with no connectivity at all', async () => {
    build(false);
    const item = await record();

    expect(item.status).toBe('queued');
    expect(item.totalBytes).toBe(RECORDING.byteLength);
    expect(item.checksumSha256).toHaveLength(64);
    // Nothing was sent, because nothing could be.
    expect(http.requests).toHaveLength(0);
  });

  it('generates the idempotency key before recording starts', async () => {
    build(false);
    await queue.registerRecording({
      clientRef: 'ref-early',
      localUri: 'file://recordings/ref-early.m4a',
      offeringId: OFFERING,
      title: 'Lecture',
    });
    const item = await queue.get('ref-early');
    expect(item?.clientRef).toBe('ref-early');
    expect(item?.status).toBe('recording');
  });

  it('reports an empty recording rather than queueing a useless file', async () => {
    const item = await record('ref-empty', new Uint8Array(0));
    expect(item.status).toBe('failed');
    expect(item.lastError).toMatch(/empty/i);
  });

  it('reports a missing file rather than failing silently', async () => {
    await queue.registerRecording({
      clientRef: 'ref-gone',
      localUri: 'file://recordings/missing.m4a',
      offeringId: OFFERING,
      title: 'Lecture',
    });
    const item = await queue.finishRecording('ref-gone');
    expect(item.status).toBe('failed');
    expect(item.lastError).toMatch(/missing/i);
  });
});

describe('uploading when connectivity returns', () => {
  it('uploads a queued recording byte-for-byte', async () => {
    await record();
    const result = await queue.drain();

    expect(result.uploaded).toBe(1);
    expect((await queue.get('ref-1'))?.status).toBe('processing');
    expect(http.assembled('ref-1')).toEqual(RECORDING);
  });

  it('does nothing while offline, then uploads on reconnect', async () => {
    build(false);
    await record();

    expect((await queue.drain()).uploaded).toBe(0);
    expect((await queue.get('ref-1'))?.status).toBe('queued');

    network.setOnline(true);
    await queue.drain();
    expect((await queue.get('ref-1'))?.status).toBe('processing');
  });

  it('uploads automatically when the connectivity listener fires', async () => {
    build(false);
    queue.start();
    await record();

    network.setOnline(true);
    // Give the listener's async drain a turn to run.
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect((await queue.get('ref-1'))?.status).toBe('processing');
    queue.stop();
  });
});

describe('interrupted uploads', () => {
  it('resumes from the byte offset instead of restarting', async () => {
    await record();

    // Drop the link after one chunk lands, leaving real bytes on the server.
    http.failAfterChunks = 1;
    await queue.drain();
    const midway = await queue.get('ref-1');
    expect(midway?.status).toBe('queued');
    expect(midway?.uploadedBytes).toBeGreaterThan(0);
    expect(midway?.uploadedBytes).toBeLessThan(RECORDING.byteLength);

    const alreadySent = midway!.uploadedBytes;
    http.requests = [];
    http.failAfterChunks = null;

    await queue.drain(Date.now() + 60_000);

    expect((await queue.get('ref-1'))?.status).toBe('processing');
    expect(http.assembled('ref-1')).toEqual(RECORDING);
    // Resumed, not restarted: fewer chunks than a full upload would need.
    const chunkPuts = http.requests.filter((r) => r.startsWith('PUT')).length;
    expect(chunkPuts).toBeLessThan(Math.ceil(RECORDING.byteLength / 524_288));
    expect(alreadySent).toBeGreaterThan(0);
  });

  it('resynchronizes when the server disagrees about the offset', async () => {
    await record();
    // The server silently keeps only half a chunk, so the client's idea of the
    // offset is ahead of the server's.
    http.truncateNextChunk = true;

    await queue.drain();

    expect((await queue.get('ref-1'))?.status).toBe('processing');
    expect(http.assembled('ref-1')).toEqual(RECORDING);
  });

  it('backs off between attempts and eventually gives up visibly', async () => {
    await record();
    http.failNextChunks = 100;

    let now = Date.now();
    for (let i = 0; i < 10; i += 1) {
      await queue.drain(now);
      now += 10 * 60_000;
    }

    const item = await queue.get('ref-1');
    // Failed, not deleted: the student must be able to see and retry it.
    expect(item?.status).toBe('failed');
    expect(item?.lastError).toBeTruthy();
    expect(item?.attempts).toBeGreaterThanOrEqual(8);
  });

  it('grows the backoff and caps it', () => {
    expect(backoffMs(1)).toBe(2000);
    expect(backoffMs(3)).toBeGreaterThan(backoffMs(2));
    expect(backoffMs(50)).toBe(5 * 60_000);
  });

  it('retries on demand after giving up', async () => {
    await record();
    http.failNextChunks = 100;
    let now = Date.now();
    for (let i = 0; i < 10; i += 1) {
      await queue.drain(now);
      now += 10 * 60_000;
    }
    expect((await queue.get('ref-1'))?.status).toBe('failed');

    http.failNextChunks = 0;
    await queue.retry('ref-1');
    await queue.drain();

    expect((await queue.get('ref-1'))?.status).toBe('processing');
  });
});

describe('duplicate prevention', () => {
  it('never creates a second lecture from a replayed upload', async () => {
    await record();
    await queue.drain();

    // The classic ambiguous failure: the client is unsure the upload landed.
    await queue.retry('ref-1');
    await queue.drain();

    expect(http.sessions.size).toBe(1);
    expect(http.assembled('ref-1')).toEqual(RECORDING);
  });

  it('keeps separate recordings separate', async () => {
    await record('ref-a', RECORDING.slice(0, 600_000));
    await record('ref-b', RECORDING.slice(0, 400_000));
    await queue.drain();

    expect(http.sessions.size).toBe(2);
    expect((await queue.list()).every((item) => item.status === 'processing')).toBe(true);
  });
});

describe('surviving an app restart', () => {
  it('resumes a queued recording after the process is replaced', async () => {
    build(false);
    await record('ref-restart');

    // A new queue over the same persisted storage: the app was killed.
    const revived = new UploadQueue(storage.clone(), files, http, new MemoryNetwork(true));
    const restored = await revived.list();

    expect(restored).toHaveLength(1);
    expect(restored[0]?.clientRef).toBe('ref-restart');
    expect(restored[0]?.status).toBe('queued');

    await revived.drain();
    expect((await revived.get('ref-restart'))?.status).toBe('processing');
  });

  it('resumes a partially uploaded recording after a restart', async () => {
    await record('ref-half');
    http.failAfterChunks = 1;
    await queue.drain();
    http.failAfterChunks = null;

    const revived = new UploadQueue(storage.clone(), files, http, new MemoryNetwork(true));
    await revived.drain(Date.now() + 60_000);

    expect((await revived.get('ref-half'))?.status).toBe('processing');
    expect(http.assembled('ref-half')).toEqual(RECORDING);
  });

  it('discards a corrupted queue entry without losing the others', async () => {
    await record('ref-good');
    await storage.set('sanad.queue.ref-broken', 'not json at all');

    const items = await queue.list();
    expect(items).toHaveLength(1);
    expect(items[0]?.clientRef).toBe('ref-good');
  });
});

describe('processing status', () => {
  it('follows a recording through to ready', async () => {
    await record();
    await queue.drain();

    const materialId = (await queue.get('ref-1'))!.materialId!;
    http.materialStatus[materialId] = { processingStatus: 'ready' };
    await queue.refreshProcessing();

    expect((await queue.get('ref-1'))?.status).toBe('ready');
  });

  it('surfaces a server-side processing failure with its reason', async () => {
    await record();
    await queue.drain();

    const materialId = (await queue.get('ref-1'))!.materialId!;
    http.materialStatus[materialId] = {
      processingStatus: 'failed',
      processingError: 'The recording had no audible speech.',
    };
    await queue.refreshProcessing();

    const item = await queue.get('ref-1');
    expect(item?.status).toBe('failed');
    expect(item?.lastError).toMatch(/audible speech/);
  });

  it('preserves the original file until the server confirms', async () => {
    await record();
    await queue.drain();
    // Nothing removes the local recording on its own.
    expect(await files.exists('file://recordings/ref-1.m4a')).toBe(true);
  });
});

describe('offline content cache', () => {
  it('refuses to download without a connection, and says why', async () => {
    const offline = new MemoryNetwork(false);
    const cache = new ContentCache(storage, http, offline);
    await expect(cache.download('course-1', 'Any Course')).rejects.toThrow(/connection/i);
  });

  it('stores and reads a course back with no network', async () => {
    const cache = new ContentCache(storage, http, new MemoryNetwork(true));
    await storage.set(
      'sanad.cache.course-1',
      JSON.stringify({
        courseId: 'course-1',
        title: 'Any Course',
        cachedAt: Date.now(),
        lectures: [{ id: 'l1', title: 'Lecture 01', status: 'ready', segments: [], emphasis: [] }],
        materials: [],
        summary: 'A summary',
        flashcards: [],
      }),
    );

    const offlineCache = new ContentCache(storage, http, new MemoryNetwork(false));
    const read = await offlineCache.read('course-1');
    expect(read?.title).toBe('Any Course');
    expect(read?.summary).toBe('A summary');
    expect(await offlineCache.list()).toHaveLength(1);
    expect(cache).toBeDefined();
  });

  it('discards a corrupted cache entry rather than crashing', async () => {
    await storage.set('sanad.cache.course-x', '{broken');
    const cache = new ContentCache(storage, http, new MemoryNetwork(false));
    expect(await cache.read('course-x')).toBeNull();
    expect(await cache.list()).toHaveLength(0);
  });
});

describe('checksums computed on the device', () => {
  /**
   * The server rejects a completed upload whose bytes do not hash to the
   * checksum the device declared, so a wrong digest here does not degrade the
   * upload — it fails every one of them.
   */
  const reference = (bytes: Uint8Array): string =>
    createHash('sha256').update(Buffer.from(bytes)).digest('hex');

  it('matches node:crypto for an empty input', () => {
    expect(sha256Hex(new Uint8Array(0))).toBe(reference(new Uint8Array(0)));
  });

  it('matches node:crypto across the block-size boundaries', () => {
    // 55/56/57 and 63/64/65 are where the padding rules change.
    for (const size of [1, 55, 56, 57, 63, 64, 65, 127, 128, 1000]) {
      const bytes = new Uint8Array(size).map((_, i) => (i * 7 + 3) % 256);
      expect(sha256Hex(bytes)).toBe(reference(bytes));
    }
  });

  it('matches node:crypto when fed in windows, as a long recording is', () => {
    const bytes = new Uint8Array(3_000_000).map((_, i) => i % 251);
    const digest = new Sha256();
    const window = 1024 * 1024;
    for (let offset = 0; offset < bytes.length; offset += window) {
      digest.update(bytes.subarray(offset, Math.min(offset + window, bytes.length)));
    }
    expect(digest.digest()).toBe(reference(bytes));
  });

  it('is independent of how the bytes are chopped up', () => {
    const bytes = new Uint8Array(5_000).map((_, i) => (i * 31) % 256);
    const uneven = new Sha256();
    let offset = 0;
    for (const size of [1, 63, 64, 65, 2, 700, 1, 999]) {
      uneven.update(bytes.subarray(offset, Math.min(offset + size, bytes.length)));
      offset += size;
    }
    uneven.update(bytes.subarray(offset));
    expect(uneven.digest()).toBe(reference(bytes));
  });

  it('decodes base64 the way the device reads a file window', () => {
    const bytes = new Uint8Array(1_234).map((_, i) => (i * 13) % 256);
    for (const length of [0, 1, 2, 3, 4, 5, 1_234]) {
      const slice = bytes.subarray(0, length);
      const base64 = Buffer.from(slice).toString('base64');
      expect(base64ToBytes(base64)).toEqual(slice);
    }
  });

  it('refuses to keep hashing after the digest is taken', () => {
    const digest = new Sha256();
    digest.update(new Uint8Array([1, 2, 3]));
    digest.digest();
    expect(() => digest.update(new Uint8Array([4]))).toThrow(/finalized/i);
  });
});
