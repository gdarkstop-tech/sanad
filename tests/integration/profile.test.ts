import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  addCommitment,
  listCommitments,
  listExamDates,
  readAvailability,
  readProfile,
  removeCommitment,
  removeExamDate,
  setAvailability,
  addExamDate,
  createCourse,
  updateStudentProfile,
} from '@sanad/core';
import { studentProfiles } from '@sanad/db';
import { createTestStudent, openTestDatabase, resetDatabase } from '../helpers';

/**
 * The student's profile and declared week.
 *
 * These are the inputs the Study Coach reads. A schedule the student cannot see
 * or correct is a schedule they cannot trust, so reading back exactly what was
 * stored matters as much as storing it.
 */

const { db, close } = openTestDatabase();

afterAll(async () => {
  await close();
});

beforeEach(async () => {
  await resetDatabase();
});

describe('student profile', () => {
  it('reads back the academic identity registration created', async () => {
    const { user } = await createTestStudent(db, { universityName: 'Test University' });

    const profile = await readProfile(db, user);
    expect(profile.user.email).toBe(user.email);
    expect(profile.universityName).toBe('Test University');
  });

  it('updates the name and the academic identity together', async () => {
    const { user } = await createTestStudent(db);

    const updated = await updateStudentProfile(db, user, {
      fullName: 'Updated Name',
      universityName: 'Another University',
      facultyName: 'Faculty of Engineering',
      departmentName: 'Computer Engineering',
      major: 'Software',
      studentNumber: 'S-1234',
    });

    expect(updated.user.fullName).toBe('Updated Name');
    expect(updated.universityName).toBe('Another University');
    expect(updated.facultyName).toBe('Faculty of Engineering');
    expect(updated.departmentName).toBe('Computer Engineering');
    expect(updated.major).toBe('Software');
    expect(updated.studentNumber).toBe('S-1234');

    // Persisted, not just returned.
    expect((await readProfile(db, user)).departmentName).toBe('Computer Engineering');
  });

  it('accepts an institution nobody has entered before', async () => {
    // A dropdown of known universities would lock out the first student from
    // anywhere new. The reference row is created on demand instead.
    const { user } = await createTestStudent(db);
    const updated = await updateStudentProfile(db, user, {
      universityName: 'A University That Did Not Exist Yet',
      facultyName: 'Faculty of Science',
    });
    expect(updated.universityId).not.toBeNull();
    expect(updated.facultyName).toBe('Faculty of Science');
  });

  it('clears the faculty and department when the university changes', async () => {
    // A department belongs to a faculty and a faculty to a university. Keeping
    // them would leave a department attached to an institution it is not in.
    const { user } = await createTestStudent(db);
    await updateStudentProfile(db, user, {
      universityName: 'First University',
      facultyName: 'Faculty of Engineering',
      departmentName: 'Civil',
    });

    const moved = await updateStudentProfile(db, user, { universityName: 'Second University' });
    expect(moved.universityName).toBe('Second University');
    expect(moved.facultyId).toBeNull();
    expect(moved.departmentId).toBeNull();
  });

  it('leaves fields alone when the patch does not mention them', async () => {
    const { user } = await createTestStudent(db);
    await updateStudentProfile(db, user, { major: 'Physics', studentNumber: 'S-9' });

    const renamed = await updateStudentProfile(db, user, { fullName: 'Just A Rename' });
    expect(renamed.major).toBe('Physics');
    expect(renamed.studentNumber).toBe('S-9');
  });

  it('refuses an empty name', async () => {
    const { user } = await createTestStudent(db);
    await expect(updateStudentProfile(db, user, { fullName: '   ' })).rejects.toThrowError();
  });

  it('creates the profile row when registration did not', async () => {
    const { user } = await createTestStudent(db);
    await db.delete(studentProfiles).where(eq(studentProfiles.userId, user.id));

    const created = await updateStudentProfile(db, user, { major: 'Chemistry' });
    expect(created.major).toBe('Chemistry');
  });
});

describe('the declared week', () => {
  const subjectOf = (user: { id: string; role: string }) => ({
    userId: user.id,
    role: user.role as 'student',
  });

  it('reads back every window that was set, in weekday order', async () => {
    const { user } = await createTestStudent(db);
    const subject = subjectOf(user);

    await setAvailability(db, subject, [
      { weekday: 3, startTime: '18:00', endTime: '22:00', kind: 'study', isAvailable: true },
      { weekday: 1, startTime: '09:00', endTime: '17:00', kind: 'class', isAvailable: false },
      { weekday: 1, startTime: '18:00', endTime: '20:00', kind: 'work', isAvailable: false },
    ]);

    const windows = await readAvailability(db, subject);
    expect(windows).toHaveLength(3);
    expect(windows.map((w) => w.weekday)).toEqual([1, 1, 3]);
    expect(windows[0]?.startTime.slice(0, 5)).toBe('09:00');
    expect(windows[0]?.kind).toBe('class');
    expect(windows[0]?.isAvailable).toBe(false);
  });

  it('replaces the week rather than appending to it', async () => {
    const { user } = await createTestStudent(db);
    const subject = subjectOf(user);

    await setAvailability(db, subject, [
      { weekday: 0, startTime: '10:00', endTime: '12:00', kind: 'study', isAvailable: true },
    ]);
    await setAvailability(db, subject, [
      { weekday: 5, startTime: '14:00', endTime: '16:00', kind: 'gym', isAvailable: false },
    ]);

    const windows = await readAvailability(db, subject);
    expect(windows).toHaveLength(1);
    expect(windows[0]?.weekday).toBe(5);
  });

  it('keeps one student’s week out of another’s', async () => {
    const { user: a } = await createTestStudent(db);
    const { user: b } = await createTestStudent(db);

    await setAvailability(db, subjectOf(a), [
      { weekday: 2, startTime: '18:00', endTime: '21:00', kind: 'study', isAvailable: true },
    ]);

    expect(await readAvailability(db, subjectOf(b))).toHaveLength(0);
  });
});

describe('one-off commitments', () => {
  const subjectOf = (user: { id: string; role: string }) => ({
    userId: user.id,
    role: user.role as 'student',
  });

  const hours = (from: number, to: number) => ({
    startsAt: new Date(Date.now() + from * 3_600_000),
    endsAt: new Date(Date.now() + to * 3_600_000),
  });

  it('adds, lists and removes', async () => {
    const { user } = await createTestStudent(db);
    const subject = subjectOf(user);

    const added = await addCommitment(db, subject, {
      title: 'Shift at work',
      kind: 'work',
      ...hours(24, 32),
    });
    expect((await listCommitments(db, subject)).map((c) => c.id)).toContain(added.id);

    await removeCommitment(db, subject, added.id);
    expect(await listCommitments(db, subject)).toHaveLength(0);
  });

  it('hides commitments that have already finished', async () => {
    const { user } = await createTestStudent(db);
    const subject = subjectOf(user);

    await addCommitment(db, subject, { title: 'Yesterday', kind: 'other', ...hours(-48, -40) });
    await addCommitment(db, subject, { title: 'Tomorrow', kind: 'other', ...hours(24, 28) });

    const upcoming = await listCommitments(db, subject);
    expect(upcoming.map((c) => c.title)).toEqual(['Tomorrow']);
  });

  it('refuses a commitment that ends before it starts', async () => {
    const { user } = await createTestStudent(db);
    await expect(
      addCommitment(db, subjectOf(user), { title: 'Backwards', kind: 'other', ...hours(10, 4) }),
    ).rejects.toThrowError();
  });

  it('refuses an empty title', async () => {
    const { user } = await createTestStudent(db);
    await expect(
      addCommitment(db, subjectOf(user), { title: '  ', kind: 'other', ...hours(1, 2) }),
    ).rejects.toThrowError();
  });

  it('will not let one student delete another’s commitment', async () => {
    const { user: a } = await createTestStudent(db);
    const { user: b } = await createTestStudent(db);

    const mine = await addCommitment(db, subjectOf(a), {
      title: 'Mine',
      kind: 'gym',
      ...hours(24, 26),
    });

    await expect(removeCommitment(db, subjectOf(b), mine.id)).rejects.toThrowError();
    expect(await listCommitments(db, subjectOf(a))).toHaveLength(1);
  });
});

describe('exam dates', () => {
  const subjectOf = (user: { id: string; role: string }) => ({
    userId: user.id,
    role: user.role as 'student',
  });

  it('lists what was added, with the course it belongs to', async () => {
    const { user } = await createTestStudent(db);
    const subject = subjectOf(user);
    const course = await createCourse(db, subject, {
      title: 'Any Subject',
      primaryLanguage: 'en',
      secondaryLanguages: [],
    });

    await addExamDate(db, subject, {
      offeringId: course.id,
      title: 'Midterm',
      examAt: new Date(Date.now() + 5 * 86_400_000),
    });

    const exams = await listExamDates(db, subject);
    expect(exams).toHaveLength(1);
    expect(exams[0]?.title).toBe('Midterm');
    expect(exams[0]?.courseTitle).toBe('Any Subject');
  });

  it('removes one, and will not remove another student’s', async () => {
    const { user: a } = await createTestStudent(db);
    const { user: b } = await createTestStudent(db);
    const subject = subjectOf(a);
    const course = await createCourse(db, subject, {
      title: 'Any Subject',
      primaryLanguage: 'en',
      secondaryLanguages: [],
    });
    await addExamDate(db, subject, {
      offeringId: course.id,
      title: 'Final',
      examAt: new Date(Date.now() + 9 * 86_400_000),
    });

    const [exam] = await listExamDates(db, subject);
    await expect(removeExamDate(db, subjectOf(b), exam!.id)).rejects.toThrowError();
    expect(await listExamDates(db, subject)).toHaveLength(1);

    await removeExamDate(db, subject, exam!.id);
    expect(await listExamDates(db, subject)).toHaveLength(0);
  });
});
