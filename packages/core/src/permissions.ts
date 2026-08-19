/**
 * Central authorization (ARCHITECTURE.md §7).
 *
 * Every data-returning endpoint resolves a (subject, resource, action)
 * decision here. Handlers do not write their own ownership checks — checks
 * written per-handler are how one endpoint ends up leaking another student's
 * recordings.
 */

export type Role = 'student' | 'teaching_assistant' | 'instructor' | 'admin';

export interface Subject {
  userId: string;
  role: Role;
}

export type CourseAction = 'read' | 'update' | 'delete' | 'add_content';

export interface CourseContext {
  ownerUserId: string;
  /** True when the subject holds an active enrollment in the offering. */
  isEnrolled: boolean;
}

export type Decision =
  | { allowed: true }
  | { allowed: false; reason: 'not_found' | 'forbidden' };

const ALLOW: Decision = { allowed: true };
const NOT_FOUND: Decision = { allowed: false, reason: 'not_found' };
const FORBIDDEN: Decision = { allowed: false, reason: 'forbidden' };

/**
 * Courses are student-owned. Instructors and TAs hold accounts but have no
 * course-management permission in the MVP — that arrives with the deferred
 * instructor features.
 *
 * A non-owner attempting to modify gets `not_found`, not `forbidden`: the
 * caller should not learn that a course they cannot touch exists.
 */
export function canActOnCourse(
  subject: Subject,
  action: CourseAction,
  course: CourseContext,
): Decision {
  const isOwner = course.ownerUserId === subject.userId;

  if (subject.role === 'admin') return ALLOW;

  switch (action) {
    case 'read':
      if (isOwner || course.isEnrolled) return ALLOW;
      return NOT_FOUND;
    case 'update':
    case 'delete':
    case 'add_content':
      if (isOwner) return ALLOW;
      // Enrolled non-owners know the course exists, so 403 leaks nothing new.
      return course.isEnrolled ? FORBIDDEN : NOT_FOUND;
  }
}

/** Anyone signed in may create a course. Subject creation is never restricted. */
export function canCreateCourse(subject: Subject): Decision {
  return subject.userId ? ALLOW : FORBIDDEN;
}

export function canReadUser(subject: Subject, targetUserId: string): Decision {
  if (subject.role === 'admin' || subject.userId === targetUserId) return ALLOW;
  return NOT_FOUND;
}
