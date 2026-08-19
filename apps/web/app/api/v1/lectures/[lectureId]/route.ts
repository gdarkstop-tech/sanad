import { deleteLecture, readLecture } from '@sanad/core';
import { db } from '@sanad/db';
import { requireUser, subjectOf } from '@/lib/auth';
import { handler, json } from '@/lib/http';

export const GET = handler(async (_request, { params }) => {
  const user = await requireUser();
  const { lectureId } = await params;
  const lecture = await readLecture(db(), subjectOf(user), lectureId as string);
  return json({ lecture });
});

export const DELETE = handler(async (_request, { params }) => {
  const user = await requireUser();
  const { lectureId } = await params;
  await deleteLecture(db(), subjectOf(user), lectureId as string);
  return json({ ok: true });
});
