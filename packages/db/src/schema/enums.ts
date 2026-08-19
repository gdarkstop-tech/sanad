import { pgEnum } from 'drizzle-orm/pg-core';

/**
 * Closed sets only. Anything a user might legitimately need to extend
 * (subjects, topics, vocabulary, languages) is a row, never an enum —
 * see ARCHITECTURE.md §1.1.
 */
export const userRole = pgEnum('user_role', [
  'student',
  'teaching_assistant',
  'instructor',
  'admin',
]);

export const authProvider = pgEnum('auth_provider', ['password', 'google', 'apple']);

export const enrollmentStatus = pgEnum('enrollment_status', [
  'active',
  'completed',
  'dropped',
]);
