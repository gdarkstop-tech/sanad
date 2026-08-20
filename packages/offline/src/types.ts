/**
 * Offline recording and upload queue — platform-agnostic core.
 *
 * The logic lives here, behind adapter interfaces, so it can be tested in Node
 * and run unchanged on Expo. A queue this important should not be verified only
 * by launching a simulator: losing a recorded lecture is unrecoverable, because
 * the lecture happened once.
 */

export type QueueItemStatus =
  | 'recording'
  | 'queued'
  | 'uploading'
  | 'processing'
  | 'ready'
  | 'failed';

export interface QueueItem {
  /**
   * Generated on the device BEFORE recording starts.
   *
   * This is the idempotency key the backend keys on: replaying an upload after
   * an ambiguous network failure resumes the same material instead of creating
   * a second lecture.
   */
  clientRef: string;
  /** Local file path or URI. The original is never modified. */
  localUri: string;
  offeringId: string;
  lectureId: string | null;
  filename: string;
  mimeType: string;
  totalBytes: number;
  checksumSha256: string;
  status: QueueItemStatus;
  /** Byte offset confirmed by the server; where a resume continues from. */
  uploadedBytes: number;
  uploadSessionId: string | null;
  materialId: string | null;
  attempts: number;
  lastError: string | null;
  /** Epoch ms. Retries back off from here. */
  nextAttemptAt: number;
  createdAt: number;
  updatedAt: number;
  durationMs: number | null;
  title: string;
}

/** Key-value persistence. AsyncStorage on device, a Map in tests. */
export interface QueueStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

/** Reads local recording files. expo-file-system on device. */
export interface FileAdapter {
  size(uri: string): Promise<number>;
  /** Reads a byte range. Chunked so a large lecture never loads at once. */
  readChunk(uri: string, offset: number, length: number): Promise<Uint8Array>;
  sha256(uri: string): Promise<string>;
  exists(uri: string): Promise<boolean>;
  remove(uri: string): Promise<void>;
}

export interface HttpResponse {
  ok: boolean;
  status: number;
  body: unknown;
}

/** The API surface the queue needs. Keeps fetch and auth out of the logic. */
export interface HttpClient {
  postJson(path: string, body: unknown): Promise<HttpResponse>;
  getJson(path: string): Promise<HttpResponse>;
  putBytes(path: string, bytes: Uint8Array, headers: Record<string, string>): Promise<HttpResponse>;
}

export interface NetworkAdapter {
  isOnline(): Promise<boolean>;
  /** Fires when connectivity changes. Returns an unsubscribe function. */
  onChange(listener: (online: boolean) => void): () => void;
}

export interface QueueEvents {
  onChange?: (items: QueueItem[]) => void;
}

export const QUEUE_PREFIX = 'sanad.queue.';
export const CHUNK_BYTES = 512 * 1024;
export const MAX_ATTEMPTS = 8;

/** Exponential backoff, capped. Bounded so a flaky link recovers quickly. */
export function backoffMs(attempts: number): number {
  return Math.min(2 ** Math.max(0, attempts - 1) * 2000, 5 * 60_000);
}
