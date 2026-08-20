import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  HashEmbeddingProvider,
  LocalDiskStorage,
  createCourse,
  createLecture,
  listCourses,
  listFolders,
  listLectures,
  listMaterials,
  normalizeFolder,
  readCourse,
  runPending,
  setCourseArchived,
  setEmbeddingProvider,
  setStorage,
  updateLecture,
  updateMaterial,
  uploadDirect,
  type Subject,
} from '@sanad/core';
import { makePdf } from '../fixtures/make-pdf';
import { createTestStudent, openTestDatabase, resetDatabase } from '../helpers';

/**
 * Organisation: archiving and folders.
 *
 * Both are filing, not deletion. The property that matters throughout is that
 * nothing a student files away becomes unreachable or unrecoverable.
 */

const { db, close } = openTestDatabase();

afterAll(async () => {
  await close();
});

beforeEach(async () => {
  await resetDatabase();
  setStorage(new LocalDiskStorage(await fs.mkdtemp(path.join(os.tmpdir(), 'sanad-org-'))));
  setEmbeddingProvider(new HashEmbeddingProvider());
});

async function student(): Promise<Subject> {
  const { user } = await createTestStudent(db);
  return { userId: user.id, role: user.role };
}

async function course(subject: Subject, title = 'Any Subject') {
  return createCourse(db, subject, { title, primaryLanguage: 'en', secondaryLanguages: [] });
}

describe('archiving a course', () => {
  it('hides it from the default list but keeps it readable', async () => {
    const owner = await student();
    const kept = await course(owner, 'Current Term');
    const done = await course(owner, 'Last Term');

    await setCourseArchived(db, owner, done.id, true);

    const active = await listCourses(db, owner);
    expect(active.map((c) => c.id)).toContain(kept.id);
    expect(active.map((c) => c.id)).not.toContain(done.id);

    // Hidden, not gone: opening it directly still works.
    const opened = await readCourse(db, owner, done.id);
    expect(opened.title).toBe('Last Term');
    expect(opened.archivedAt).not.toBeNull();
  });

  it('lists archived courses when asked for them', async () => {
    const owner = await student();
    const done = await course(owner, 'Last Term');
    await setCourseArchived(db, owner, done.id, true);

    const all = await listCourses(db, owner, { includeArchived: true });
    expect(all.map((c) => c.id)).toContain(done.id);
    expect(all.find((c) => c.id === done.id)?.archivedAt).not.toBeNull();
  });

  it('keeps the lectures and materials inside it', async () => {
    const owner = await student();
    const offering = await course(owner);
    const lecture = await createLecture(db, owner, offering.id, { title: 'Lecture 01' });
    await uploadDirect(db, owner, {
      clientRef: `arch-${Date.now()}`,
      offeringId: offering.id,
      filename: 'notes.pdf',
      mimeType: 'application/pdf',
      data: makePdf(['Some content that must survive archiving the course.']),
    });
    await runPending(db, { max: 20 });

    await setCourseArchived(db, owner, offering.id, true);

    // Archiving files a course away. It must not behave like deleting one.
    expect((await listLectures(db, owner, offering.id)).map((l) => l.id)).toContain(lecture.id);
    expect(await listMaterials(db, owner, offering.id)).toHaveLength(1);
  });

  it('restores', async () => {
    const owner = await student();
    const offering = await course(owner);

    await setCourseArchived(db, owner, offering.id, true);
    const restored = await setCourseArchived(db, owner, offering.id, false);

    expect(restored.archivedAt).toBeNull();
    expect((await listCourses(db, owner)).map((c) => c.id)).toContain(offering.id);
  });

  it('refuses to archive another student’s course', async () => {
    const owner = await student();
    const stranger = await student();
    const offering = await course(owner);

    await expect(setCourseArchived(db, stranger, offering.id, true)).rejects.toThrowError();
    expect((await readCourse(db, owner, offering.id)).archivedAt).toBeNull();
  });
});

describe('folder labels', () => {
  it('trims, and treats blank as ungrouped', () => {
    // A student clearing the field means "no folder", not a folder named "".
    expect(normalizeFolder('  Week 3  ')).toBe('Week 3');
    expect(normalizeFolder('')).toBeNull();
    expect(normalizeFolder('   ')).toBeNull();
    expect(normalizeFolder(null)).toBeNull();
    expect(normalizeFolder(undefined)).toBeNull();
    expect(normalizeFolder('x'.repeat(200))).toHaveLength(80);
  });

  it('files a lecture at creation and lets it be moved later', async () => {
    const owner = await student();
    const offering = await course(owner);

    const lecture = await createLecture(db, owner, offering.id, {
      title: 'Lecture 01',
      folder: 'Week 1',
    });
    expect(lecture.folder).toBe('Week 1');

    const moved = await updateLecture(db, owner, lecture.id, { folder: 'Revision' });
    expect(moved.folder).toBe('Revision');

    const ungrouped = await updateLecture(db, owner, lecture.id, { folder: null });
    expect(ungrouped.folder).toBeNull();
  });

  it('leaves the folder alone when a rename does not mention it', async () => {
    const owner = await student();
    const offering = await course(owner);
    const lecture = await createLecture(db, owner, offering.id, {
      title: 'Lecture 01',
      folder: 'Week 2',
    });

    const renamed = await updateLecture(db, owner, lecture.id, { title: 'Lecture 01 — Sorting' });
    expect(renamed.title).toBe('Lecture 01 — Sorting');
    expect(renamed.folder).toBe('Week 2');
  });

  it('counts what is in each folder, and ignores ungrouped items', async () => {
    const owner = await student();
    const offering = await course(owner);

    await createLecture(db, owner, offering.id, { title: 'L1', folder: 'Week 1' });
    await createLecture(db, owner, offering.id, { title: 'L2', folder: 'Week 1' });
    await createLecture(db, owner, offering.id, { title: 'L3', folder: 'Week 2' });
    await createLecture(db, owner, offering.id, { title: 'L4' });

    const { materialId } = await uploadDirect(db, owner, {
      clientRef: `folder-${Date.now()}`,
      offeringId: offering.id,
      filename: 'week1.pdf',
      mimeType: 'application/pdf',
      data: makePdf(['Material filed under the first week of the course.']),
    });
    await updateMaterial(db, owner, materialId, { folder: 'Week 1' });

    const folders = await listFolders(db, owner, offering.id);
    expect(folders.map((f) => f.name)).toEqual(['Week 1', 'Week 2']);
    expect(folders[0]).toEqual({ name: 'Week 1', lectureCount: 2, materialCount: 1 });
    expect(folders[1]).toEqual({ name: 'Week 2', lectureCount: 1, materialCount: 0 });
  });

  it('refuses to refile another student’s lecture', async () => {
    const owner = await student();
    const stranger = await student();
    const offering = await course(owner);
    const lecture = await createLecture(db, owner, offering.id, { title: 'Lecture 01' });

    await expect(updateLecture(db, stranger, lecture.id, { folder: 'Theirs' })).rejects.toThrowError();
    await expect(listFolders(db, stranger, offering.id)).rejects.toThrowError();
  });

  it('rejects an empty title rather than storing one', async () => {
    const owner = await student();
    const offering = await course(owner);
    const lecture = await createLecture(db, owner, offering.id, { title: 'Lecture 01' });

    await expect(updateLecture(db, owner, lecture.id, { title: '   ' })).rejects.toThrowError();
  });
});
