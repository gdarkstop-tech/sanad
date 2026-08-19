import { updateCourseSchema } from '@sanad/contracts';
import { deleteCourse, readCourse, updateCourse } from '@sanad/core';
import { db } from '@sanad/db';
import { requireUser, subjectOf } from '@/lib/auth';
import { handler, json, parseBody } from '@/lib/http';

export const GET = handler(async (_request, { params }) => {
  const user = await requireUser();
  const { offeringId } = await params;
  const course = await readCourse(db(), subjectOf(user), offeringId as string);
  return json({ course });
});

export const PATCH = handler(async (request, { params }) => {
  const user = await requireUser();
  const { offeringId } = await params;
  const patch = await parseBody(request, updateCourseSchema);
  const course = await updateCourse(db(), subjectOf(user), offeringId as string, patch);
  return json({ course });
});

export const DELETE = handler(async (_request, { params }) => {
  const user = await requireUser();
  const { offeringId } = await params;
  await deleteCourse(db(), subjectOf(user), offeringId as string);
  return json({ ok: true });
});
