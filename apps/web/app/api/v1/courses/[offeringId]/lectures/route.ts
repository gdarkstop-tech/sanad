import { z } from 'zod';
import { createLecture, listLectures } from '@sanad/core';
import { db } from '@sanad/db';
import { requireUser, subjectOf } from '@/lib/auth';
import { handler, json, parseBody } from '@/lib/http';

const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  sequenceNo: z.number().int().positive().max(999).nullish(),
  occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  folder: z.string().trim().max(80).nullish(),
});

export const GET = handler(async (_request, { params }) => {
  const user = await requireUser();
  const { offeringId } = await params;
  const lectures = await listLectures(db(), subjectOf(user), offeringId as string);
  return json({ lectures });
});

export const POST = handler(async (request, { params }) => {
  const user = await requireUser();
  const { offeringId } = await params;
  const input = await parseBody(request, createSchema);
  const lecture = await createLecture(db(), subjectOf(user), offeringId as string, input);
  return json({ lecture }, 201);
});
