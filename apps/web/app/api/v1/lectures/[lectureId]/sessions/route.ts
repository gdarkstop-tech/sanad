import { z } from 'zod';
import { openSession } from '@sanad/core';
import { db } from '@sanad/db';
import { requireUser, subjectOf } from '@/lib/auth';
import { handler, json, parseBody } from '@/lib/http';

const schema = z.object({
  captureMode: z.enum(['live', 'upload']).default('upload'),
  languageHints: z.array(z.string().max(35)).max(5).default([]),
});

export const POST = handler(async (request, { params }) => {
  const user = await requireUser();
  const { lectureId } = await params;
  const input = await parseBody(request, schema);
  const session = await openSession(db(), subjectOf(user), lectureId as string, input);
  return json({ session }, 201);
});
