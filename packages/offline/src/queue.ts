import {
  CHUNK_BYTES,
  MAX_ATTEMPTS,
  QUEUE_PREFIX,
  backoffMs,
  type FileAdapter,
  type HttpClient,
  type NetworkAdapter,
  type QueueEvents,
  type QueueItem,
  type QueueStorage,
} from './types';

/**
 * The offline upload queue.
 *
 * Guarantees, in order of importance:
 *
 * 1. **Recording never needs a network.** The queue is only involved after a
 *    recording exists on disk.
 * 2. **A recording is never lost.** Every state change is persisted before it
 *    is acted on, so an app kill at any point resumes rather than forgets.
 * 3. **A retry never duplicates a lecture.** `clientRef` is generated before
 *    recording and is the server's idempotency key.
 * 4. **An interrupted upload resumes by byte offset**, never restarts.
 * 5. **The original file is preserved** until the server confirms the upload.
 */
export class UploadQueue {
  private draining = false;
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly storage: QueueStorage,
    private readonly files: FileAdapter,
    private readonly http: HttpClient,
    private readonly network: NetworkAdapter,
    private readonly events: QueueEvents = {},
  ) {}

  /** Starts reacting to connectivity. Safe to call more than once. */
  start(): void {
    this.unsubscribe ??= this.network.onChange((online) => {
      if (online) void this.drain();
    });
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  async list(): Promise<QueueItem[]> {
    const keys = (await this.storage.keys()).filter((key) => key.startsWith(QUEUE_PREFIX));
    const items: QueueItem[] = [];
    for (const key of keys) {
      const raw = await this.storage.get(key);
      if (!raw) continue;
      try {
        items.push(JSON.parse(raw) as QueueItem);
      } catch {
        // A corrupted entry must not take the whole queue down with it.
        await this.storage.remove(key);
      }
    }
    return items.sort((a, b) => a.createdAt - b.createdAt);
  }

  async get(clientRef: string): Promise<QueueItem | null> {
    const raw = await this.storage.get(QUEUE_PREFIX + clientRef);
    return raw ? (JSON.parse(raw) as QueueItem) : null;
  }

  private async save(item: QueueItem): Promise<QueueItem> {
    const next = { ...item, updatedAt: Date.now() };
    await this.storage.set(QUEUE_PREFIX + next.clientRef, JSON.stringify(next));
    this.events.onChange?.(await this.list());
    return next;
  }

  async remove(clientRef: string): Promise<void> {
    await this.storage.remove(QUEUE_PREFIX + clientRef);
    this.events.onChange?.(await this.list());
  }

  /**
   * Registers a recording that is about to start.
   *
   * Called *before* the first byte is captured, so a crash mid-recording still
   * leaves a queue entry pointing at a partial file rather than an orphan.
   */
  async registerRecording(input: {
    clientRef: string;
    localUri: string;
    offeringId: string;
    lectureId?: string | null;
    title: string;
    mimeType?: string;
    filename?: string;
  }): Promise<QueueItem> {
    const now = Date.now();
    return this.save({
      clientRef: input.clientRef,
      localUri: input.localUri,
      offeringId: input.offeringId,
      lectureId: input.lectureId ?? null,
      filename: input.filename ?? 'lecture.m4a',
      mimeType: input.mimeType ?? 'audio/mp4',
      totalBytes: 0,
      checksumSha256: '',
      status: 'recording',
      uploadedBytes: 0,
      uploadSessionId: null,
      materialId: null,
      attempts: 0,
      lastError: null,
      nextAttemptAt: 0,
      createdAt: now,
      updatedAt: now,
      durationMs: null,
      title: input.title,
    });
  }

  /**
   * Marks a recording finished and eligible for upload.
   *
   * The size and checksum are computed here, offline — they are what the
   * server verifies later, and computing them now means a corrupted file is
   * caught before it is queued rather than after a long upload.
   */
  async finishRecording(
    clientRef: string,
    details: { durationMs?: number } = {},
  ): Promise<QueueItem> {
    const item = await this.require(clientRef);
    if (!(await this.files.exists(item.localUri))) {
      return this.save({
        ...item,
        status: 'failed',
        lastError: 'The recording file is missing.',
      });
    }

    const totalBytes = await this.files.size(item.localUri);
    if (totalBytes <= 0) {
      return this.save({
        ...item,
        status: 'failed',
        lastError: 'The recording is empty.',
      });
    }

    return this.save({
      ...item,
      status: 'queued',
      totalBytes,
      checksumSha256: await this.files.sha256(item.localUri),
      durationMs: details.durationMs ?? item.durationMs,
      nextAttemptAt: 0,
    });
  }

  /** Puts a failed item back in line immediately. */
  async retry(clientRef: string): Promise<QueueItem> {
    const item = await this.require(clientRef);
    return this.save({
      ...item,
      status: 'queued',
      attempts: 0,
      lastError: null,
      nextAttemptAt: 0,
    });
  }

  /**
   * Uploads everything due.
   *
   * Serialized: a phone on a weak connection does better with one upload at a
   * time than several competing for the same bytes.
   */
  async drain(now: number = Date.now()): Promise<{ uploaded: number; failed: number }> {
    if (this.draining) return { uploaded: 0, failed: 0 };
    this.draining = true;
    const result = { uploaded: 0, failed: 0 };

    try {
      if (!(await this.network.isOnline())) return result;

      for (const item of await this.list()) {
        const due =
          (item.status === 'queued' || item.status === 'uploading') &&
          item.nextAttemptAt <= now;
        if (!due) continue;

        try {
          await this.upload(item);
          result.uploaded += 1;
        } catch (error) {
          result.failed += 1;
          await this.recordFailure(item, error);
          // A dropped connection stops the pass; the rest stay queued.
          if (!(await this.network.isOnline())) break;
        }
      }
    } finally {
      this.draining = false;
    }

    return result;
  }

  private async recordFailure(item: QueueItem, error: unknown): Promise<void> {
    const current = (await this.get(item.clientRef)) ?? item;
    const attempts = current.attempts + 1;
    const message = error instanceof Error ? error.message : String(error);
    const exhausted = attempts >= MAX_ATTEMPTS;

    await this.save({
      ...current,
      // Exhausted means visible, never silently dropped: a lecture that failed
      // to upload must stay on screen so the student can act on it.
      status: exhausted ? 'failed' : 'queued',
      attempts,
      lastError: message.slice(0, 300),
      nextAttemptAt: exhausted ? 0 : Date.now() + backoffMs(attempts),
    });
  }

  /** Open (or resume) → send remaining chunks → complete. */
  private async upload(item: QueueItem): Promise<void> {
    let current = await this.save({ ...item, status: 'uploading' });

    const opened = await this.http.postJson('/api/v1/uploads', {
      clientRef: current.clientRef,
      offeringId: current.offeringId,
      lectureId: current.lectureId,
      filename: current.filename,
      mimeType: current.mimeType,
      totalBytes: current.totalBytes,
      checksumSha256: current.checksumSha256,
    });
    if (!opened.ok) throw new Error(problemOf(opened, 'Could not start the upload'));

    const session = (opened.body as { upload?: UploadSession }).upload;
    if (!session) throw new Error('The server did not return an upload session.');

    current = await this.save({
      ...current,
      uploadSessionId: session.uploadSessionId,
      materialId: session.materialId,
      // Trust the server's offset, not our own: it is the authority on what
      // actually arrived, which is the whole point of resuming.
      uploadedBytes: session.receivedBytes,
    });

    while (current.uploadedBytes < current.totalBytes) {
      const length = Math.min(CHUNK_BYTES, current.totalBytes - current.uploadedBytes);
      const bytes = await this.files.readChunk(current.localUri, current.uploadedBytes, length);

      const response = await this.http.putBytes(
        `/api/v1/uploads/${current.uploadSessionId}/chunk`,
        bytes,
        {
          'x-upload-offset': String(current.uploadedBytes),
          'content-type': 'application/octet-stream',
        },
      );

      if (response.status === 409) {
        // Offset conflict: the server knows better. Re-sync and continue.
        const status = await this.http.getJson(`/api/v1/uploads/${current.uploadSessionId}`);
        const fresh = (status.body as { upload?: UploadSession }).upload;
        if (!status.ok || !fresh) throw new Error('Could not resynchronize the upload.');
        current = await this.save({ ...current, uploadedBytes: fresh.receivedBytes });
        continue;
      }
      if (!response.ok) throw new Error(problemOf(response, 'Chunk upload failed'));

      const progressed = (response.body as { upload?: UploadSession }).upload;
      current = await this.save({
        ...current,
        uploadedBytes: progressed?.receivedBytes ?? current.uploadedBytes + length,
      });
    }

    const completed = await this.http.postJson(
      `/api/v1/uploads/${current.uploadSessionId}/complete`,
      {},
    );
    if (!completed.ok) throw new Error(problemOf(completed, 'Could not finish the upload'));

    await this.save({
      ...current,
      status: 'processing',
      attempts: 0,
      lastError: null,
    });
  }

  /**
   * Refreshes server-side processing state for uploaded recordings.
   *
   * Only once a recording is `ready` is the local file redundant — and even
   * then removing it is the caller's decision, never automatic.
   */
  async refreshProcessing(): Promise<void> {
    if (!(await this.network.isOnline())) return;

    for (const item of await this.list()) {
      if (item.status !== 'processing' || !item.materialId) continue;
      const response = await this.http.getJson(`/api/v1/materials/${item.materialId}`);
      if (!response.ok) continue;

      const material = (response.body as { material?: { processingStatus?: string; processingError?: string | null } })
        .material;
      if (material?.processingStatus === 'ready') {
        await this.save({ ...item, status: 'ready', lastError: null });
      } else if (material?.processingStatus === 'failed') {
        await this.save({
          ...item,
          status: 'failed',
          lastError: material.processingError ?? 'Processing failed on the server.',
        });
      }
    }
  }

  private async require(clientRef: string): Promise<QueueItem> {
    const item = await this.get(clientRef);
    if (!item) throw new Error(`No queued recording for ${clientRef}`);
    return item;
  }
}

interface UploadSession {
  uploadSessionId: string;
  materialId: string;
  receivedBytes: number;
  totalBytes: number;
  status: string;
  resumed: boolean;
}

/** Surfaces the API's problem+json detail so the student sees a real reason. */
function problemOf(response: { body: unknown; status: number }, fallback: string): string {
  const body = response.body as { detail?: string; title?: string } | null;
  return body?.detail ?? body?.title ?? `${fallback} (HTTP ${response.status})`;
}
