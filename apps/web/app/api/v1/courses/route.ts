import { createCourseSchema } from '@sanad/contracts';
import { createCourse, listCourses } from '@sanad/core';
import { db } from '@sanad/db';
import { requireUser, subjectOf } from '@/lib/auth';
import { handler, json, parseBody } from '@/lib/http';

export const GET = handler(async (request) => {
  const user = await requireUser();
  // Archived courses are out of the way by default and one query away.
  const includeArchived =
    new URL(request.url).searchParams.get('include_archived') === 'true';
  const courses = await listCourses(db(), subjectOf(user), { includeArchived });
  return json({ courses });
});

export const POST = handler(async (request) => {
  const user = await requireUser();
  const input = await parseBody(request, createCourseSchema);
  const course = await createCourse(db(), subjectOf(user), input);
  return json({ course }, 201);
});
