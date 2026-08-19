import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  LocalDiskStorage,
  assertSafeKey,
  chunkUnits,
  classify,
  limitFor,
  sanitizeFilename,
  sha256,
  storageKeyFor,
  validateUpload,
} from '@sanad/core';

describe('upload validation', () => {
  it('classifies by MIME type first, extension as fallback', () => {
    expect(classify('slides.pdf', 'application/pdf')).toBe('pdf');
    expect(classify('slides.pdf', 'application/octet-stream')).toBe('pdf');
    expect(classify('lecture.webm', 'audio/webm')).toBe('audio');
    expect(classify('notes.txt', 'text/plain')).toBe('text');
  });

  it('rejects an unsupported type with an actionable message', () => {
    expect(() =>
      validateUpload({ filename: 'thing.exe', mimeType: 'application/x-msdownload', byteSize: 10 }),
    ).toThrow(/Accepted: PDF/);
  });

  it('rejects an empty file', () => {
    expect(() =>
      validateUpload({ filename: 'a.pdf', mimeType: 'application/pdf', byteSize: 0 }),
    ).toThrow(/empty/);
  });

  it('applies a larger limit to media than to documents', () => {
    expect(limitFor('audio')).toBeGreaterThan(limitFor('pdf'));
    expect(() =>
      validateUpload({
        filename: 'big.pdf',
        mimeType: 'application/pdf',
        byteSize: limitFor('pdf') + 1,
      }),
    ).toThrow(/too large/);
    expect(() =>
      validateUpload({
        filename: 'long.webm',
        mimeType: 'audio/webm',
        byteSize: limitFor('pdf') + 1,
      }),
    ).not.toThrow();
  });

  it('rejects a file whose bytes contradict its declared type', () => {
    // The declared MIME type is attacker-controlled; the bytes are not.
    expect(() =>
      validateUpload({
        filename: 'evil.pdf',
        mimeType: 'application/pdf',
        byteSize: 100,
        head: Buffer.from('MZ\x90\x00this is an executable'),
      }),
    ).toThrow(/does not look like a pdf/);
  });

  it('accepts a file whose bytes match', () => {
    expect(() =>
      validateUpload({
        filename: 'real.pdf',
        mimeType: 'application/pdf',
        byteSize: 100,
        head: Buffer.from('%PDF-1.7'),
      }),
    ).not.toThrow();
  });

  it('strips directory components and control characters from filenames', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFilename('C:\\Windows\\notes.txt')).toBe('notes.txt');
    expect(sanitizeFilename('re\u0000port\u001b.pdf')).toBe('report.pdf');
    expect(sanitizeFilename('')).toBe('file');
  });
});

describe('storage keys', () => {
  it('rejects traversal, absolute paths and odd characters', () => {
    expect(() => assertSafeKey('courses/a/materials/b/file.pdf')).not.toThrow();
    expect(() => assertSafeKey('../secrets')).toThrow(/Unsafe/);
    expect(() => assertSafeKey('/etc/passwd')).toThrow(/Unsafe/);
    expect(() => assertSafeKey('a/../../b')).toThrow(/Unsafe/);
    expect(() => assertSafeKey('a b')).toThrow(/Unsafe/);
    expect(() => assertSafeKey('')).toThrow();
  });

  it('derives the key from IDs, not from the uploaded filename', () => {
    const key = storageKeyFor({
      offeringId: 'off-1',
      materialId: 'mat-1',
      filename: '../../escape.pdf',
    });
    expect(key).toBe('courses/off-1/materials/mat-1/_._escape.pdf');
    expect(() => assertSafeKey(key)).not.toThrow();
  });
});

describe('local disk storage', () => {
  let root: string;
  let store: LocalDiskStorage;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'sanad-store-'));
    store = new LocalDiskStorage(root);
  });

  it('round-trips a file with its checksum', async () => {
    const data = Buffer.from('lecture audio bytes');
    const stored = await store.put('courses/c/materials/m/a.bin', data);
    expect(stored.byteSize).toBe(data.byteLength);
    expect(stored.checksumSha256).toBe(sha256(data));
    expect((await store.get('courses/c/materials/m/a.bin')).equals(data)).toBe(true);
  });

  it('appends, which is what makes an upload resumable', async () => {
    const key = 'courses/c/materials/m/a.bin';
    await store.append(key, Buffer.from('first '));
    const total = await store.append(key, Buffer.from('second'));
    expect(total).toBe(12);
    expect((await store.get(key)).toString()).toBe('first second');
  });

  it('reports a missing object as null rather than throwing', async () => {
    expect(await store.stat('courses/c/materials/m/missing.bin')).toBeNull();
  });

  it('refuses to write outside its root', async () => {
    await expect(store.put('../escaped.bin', Buffer.from('x'))).rejects.toThrow(/Unsafe/);
  });

  it('deletes idempotently', async () => {
    const key = 'courses/c/materials/m/a.bin';
    await store.put(key, Buffer.from('x'));
    await store.delete(key);
    await expect(store.delete(key)).resolves.toBeUndefined();
  });
});

describe('chunking', () => {
  it('keeps each chunk on a single page, so a chunk has one anchor', () => {
    const chunks = chunkUnits([
      { seq: 0, text: 'alpha '.repeat(200), pageNo: 1 },
      { seq: 1, text: 'beta '.repeat(200), pageNo: 2 },
    ]);
    for (const chunk of chunks) {
      expect(chunk.pageNo === 1 || chunk.pageNo === 2).toBe(true);
    }
    expect(new Set(chunks.map((c) => c.pageNo)).size).toBe(2);
  });

  it('splits long pages and overlaps them', () => {
    const long = Array.from({ length: 12 }, (_, i) => ({
      seq: i,
      text: `sentence number ${i} ${'padding '.repeat(30)}`,
      pageNo: 1,
    }));
    const chunks = chunkUnits(long);
    expect(chunks.length).toBeGreaterThan(1);
    // Overlap: some tail of one chunk reappears at the head of the next.
    const first = chunks[0]!.text.slice(-40);
    expect(chunks[1]!.text.includes(first.trim().split(' ')[0]!)).toBe(true);
  });

  it('normalizes text alongside the original, for lexical search', () => {
    const chunks = chunkUnits([{ seq: 0, text: 'مُحَاضَرَة Lecture', pageNo: 1 }]);
    expect(chunks[0]!.text).toContain('مُحَاضَرَة');
    expect(chunks[0]!.textNormalized).toContain('محاضره');
  });

  it('tags mixed-script content as mixed rather than picking one', () => {
    const chunks = chunkUnits([{ seq: 0, text: 'الدائرة تستخدم clock gating technique', pageNo: 1 }]);
    expect(chunks[0]!.language).toBe('mixed');
  });

  it('produces nothing from empty input', () => {
    expect(chunkUnits([])).toEqual([]);
  });
});
