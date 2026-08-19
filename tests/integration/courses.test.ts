import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  createCourse,
  deleteCourse,
  listCourses,
  readCourse,
  updateCourse,
  type Subject,
} from '@sanad/core';
import { courseOfferings, courses } from '@sanad/db';
import { createTestStudent, openTestDatabase, resetDatabase } from '../helpers';

const { db, close } = openTestDatabase();

afterAll(async () => {
  await close();
});

beforeEach(async () => {
  await resetDatabase();
});

async function student(): Promise<Subject> {
  const { user } = await createTestStudent(db);
  return { userId: user.id, role: user.role };
}

const baseCourse = {
  primaryLanguage: 'ar',
  secondaryLanguages: [] as string[],
};

describe('creating courses', () => {
  it('creates a course and its offering in one call', async () => {
    const owner = await student();
    const course = await createCourse(db, owner, { ...baseCourse, title: 'Linear Algebra' });

    expect(course.title).toBe('Linear Algebra');
    expect(course.isOwner).toBe(true);
    expect(await db.select().from(courses)).toHaveLength(1);
    expect(await db.select().from(courseOfferings)).toHaveLength(1);
  });

  it('accepts any subject the student types, from any discipline', async () => {
    const owner = await student();
    // The point of the test: the server has no notion of what subjects exist.
    for (const title of ['Pharmacology II', '中级中文', 'محاسبة مالية', 'Jazz History']) {
      const course = await createCourse(db, owner, { ...baseCourse, title });
      expect(course.title).toBe(title);
    }
    expect(await listCourses(db, owner)).toHaveLength(4);
  });

  it('enrolls the owner so downstream content queries need one path', async () => {
    const owner = await student();
    const course = await createCourse(db, owner, { ...baseCourse, title: 'Statistics' });
    await expect(readCourse(db, owner, course.id)).resolves.toMatchObject({
      title: 'Statistics',
    });
  });

  it('stores per-course language settings', async () => {
    const owner = await student();
    const course = await createCourse(db, owner, {
      title: 'Data Structures',
      primaryLanguage: 'en',
      secondaryLanguages: ['ar'],
    });
    expect(course.primaryLanguage).toBe('en');
    expect(course.secondaryLanguages).toEqual(['ar']);
  });
});

describe('isolation between students', () => {
  it('lists only the caller’s own courses', async () => {
    const alice = await student();
    const bob = await student();
    await createCourse(db, alice, { ...baseCourse, title: 'Alice Course' });
    await createCourse(db, bob, { ...baseCourse, title: 'Bob Course' });

    const aliceCourses = await listCourses(db, alice);
    expect(aliceCourses).toHaveLength(1);
    expect(aliceCourses[0]?.title).toBe('Alice Course');
  });

  it('reports another student’s course as not found, not forbidden', async () => {
    const alice = await student();
    const bob = await student();
    const course = await createCourse(db, alice, { ...baseCourse, title: 'Private Course' });

    await expect(readCourse(db, bob, course.id)).rejects.toMatchObject({ status: 404 });
  });

  it('refuses an update by a non-owner', async () => {
    const alice = await student();
    const bob = await student();
    const course = await createCourse(db, alice, { ...baseCourse, title: 'Original Title' });

    await expect(
      updateCourse(db, bob, course.id, { title: 'Hijacked' }),
    ).rejects.toMatchObject({ status: 404 });

    const [row] = await db.select().from(courses).where(eq(courses.id, course.courseId));
    expect(row?.title).toBe('Original Title');
  });

  it('refuses a delete by a non-owner and leaves the course intact', async () => {
    const alice = await student();
    const bob = await student();
    const course = await createCourse(db, alice, { ...baseCourse, title: 'Keep Me' });

    await expect(deleteCourse(db, bob, course.id)).rejects.toMatchObject({ status: 404 });
    await expect(readCourse(db, alice, course.id)).resolves.toMatchObject({ title: 'Keep Me' });
  });
});

describe('owner actions', () => {
  it('updates course and offering fields together', async () => {
    const owner = await student();
    const course = await createCourse(db, owner, { ...baseCourse, title: 'Before' });

    const updated = await updateCourse(db, owner, course.id, {
      title: 'After',
      code: 'NEW101',
      primaryLanguage: 'en',
    });

    expect(updated.title).toBe('After');
    expect(updated.code).toBe('NEW101');
    expect(updated.primaryLanguage).toBe('en');
  });

  it('soft-deletes so a mistake is recoverable', async () => {
    const owner = await student();
    const course = await createCourse(db, owner, { ...baseCourse, title: 'Dropped Course' });

    await deleteCourse(db, owner, course.id);

    expect(await listCourses(db, owner)).toHaveLength(0);
    await expect(readCourse(db, owner, course.id)).rejects.toMatchObject({ status: 404 });

    const [row] = await db.select().from(courses).where(eq(courses.id, course.courseId));
    expect(row?.deletedAt).not.toBeNull();
  });

  it('reports a missing course as not found', async () => {
    const owner = await student();
    await expect(
      readCourse(db, owner, '01920000-0000-7000-8000-000000000000'),
    ).rejects.toMatchObject({ status: 404 });
  });
});
