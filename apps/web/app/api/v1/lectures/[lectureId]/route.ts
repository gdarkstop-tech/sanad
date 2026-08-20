import { z } from 'zod';
import { deleteLecture, readLecture, updateLecture } from '@sanad/core';
import { db } from '@sanad/db';
import { requireUser, subjectOf } from '@/lib/auth';
import { handler, json, parseBody } from '@/lib/http';

export const GET = handler(async (_request, { params }) => {
  const user = await requireUser();
  const { lectureId } = await params;
  const lecture = await readLecture(db(), subjectOf(user), lectureId as string);
  return json({ lecture });
});

/** Rename, refile, or set the date. `folder: null` ungroups the lecture. */
const patchSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  folder: z.string().trim().max(80).nullable().optional(),
  occurredOn: z.string().date().nullable().optional(),
});

export const PATCH = handler(async (request, { params }) => {
  const user = await requireUser();
  const { lectureId } = await params;
  const patch = await parseBody(request, patchSchema);
  const lecture = await updateLecture(db(), subjectOf(user), lectureId as string, patch);
  return json({ lecture });
});

export const DELETE = handler(async (_request, { params }) => {
  const user = await requireUser();
  const { lectureId } = await params;
  await deleteLecture(db(), subjectOf(user), lectureId as string);
  return json({ ok: true });
});
