import { ContentCache, UploadQueue, type QueueItem } from '@sanad/offline';
import { httpClient } from './api';
import { fileAdapter, networkAdapter, storageAdapter } from './adapters';
import { CONFIG } from './config';

/**
 * One queue instance for the whole app.
 *
 * A second instance would race the first over the same persisted state, and
 * both would try to upload the same bytes.
 */
let listeners: Array<(items: QueueItem[]) => void> = [];

export const uploadQueue = new UploadQueue(
  storageAdapter,
  fileAdapter,
  httpClient,
  networkAdapter,
  { onChange: (items) => listeners.forEach((listener) => listener(items)) },
);

export const contentCache = new ContentCache(storageAdapter, httpClient, networkAdapter);

export function subscribeToQueue(listener: (items: QueueItem[]) => void): () => void {
  listeners.push(listener);
  void uploadQueue.list().then(listener);
  return () => {
    listeners = listeners.filter((entry) => entry !== listener);
  };
}

let timer: ReturnType<typeof setInterval> | null = null;

/** Starts connectivity-driven uploads plus a slow poll for processing status. */
export function startQueue(): void {
  uploadQueue.start();
  timer ??= setInterval(() => {
    void uploadQueue.drain();
    void uploadQueue.refreshProcessing();
  }, CONFIG.drainIntervalMs);
  void uploadQueue.drain();
}

export function stopQueue(): void {
  uploadQueue.stop();
  if (timer) clearInterval(timer);
  timer = null;
}
