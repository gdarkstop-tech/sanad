import postgres from 'postgres';
import { createDisposableDatabase, type Database } from '../packages/db/src/client';
import { registerUser, type AuthenticatedUser } from '../packages/core/src/services/auth';

export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is not set.');
  return url;
}

export function openTestDatabase(): { db: Database; close: () => Promise<void> } {
  return createDisposableDatabase(testDatabaseUrl());
}

/**
 * Truncate rather than re-migrate between tests: same isolation, far faster,
 * and it exercises the real schema including cascades.
 */
export async function resetDatabase(): Promise<void> {
  const sql = postgres(testDatabaseUrl(), { max: 1 });
  try {
    await sql`
      TRUNCATE TABLE
        study_sessions, study_plans, course_exams, student_commitments, study_availability,
        citations, qa_messages, student_topic_mastery, attempt_answers, quiz_attempts,
        exam_items, exams, question_options, questions, flashcards, keywords, summaries,
        topic_links, study_topics, lecture_emphasis, emphasis_cues, content_chunks,
        processing_jobs, upload_sessions, material_chunks, materials,
        transcript_segments, lecture_sessions, lectures,
        rate_limit_buckets, email_verification_tokens,
        course_staff, course_enrollments, course_offerings, courses,
        student_profiles, instructor_profiles, teaching_assistant_profiles,
        academic_terms, academic_years, departments, faculties, universities,
        consents, sessions, auth_identities, users
      RESTART IDENTITY CASCADE
    `;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

let counter = 0;

export function uniqueEmail(prefix = 'student'): string {
  counter += 1;
  return `${prefix}.${Date.now()}.${counter}@university.edu`;
}

export const VALID_PASSWORD = 'correct-horse-battery';

export async function createTestStudent(
  db: Database,
  overrides: Partial<{ email: string; fullName: string; universityName: string }> = {},
): Promise<{ user: AuthenticatedUser; token: string }> {
  const email = overrides.email ?? uniqueEmail();
  const { user, session } = await registerUser(
    db,
    {
      email,
      password: VALID_PASSWORD,
      fullName: overrides.fullName ?? 'Test Student',
      role: 'student',
      interfaceLocale: 'en',
      timezone: 'UTC',
      profile: overrides.universityName
        ? { university: { name: overrides.universityName } }
        : {},
    },
    30,
  );
  return { user, token: session.token };
}
