import { z } from 'zod';
import { startAttempt } from '@sanad/core';
import { db } from '@sanad/db';
import { requireUser, subjectOf } from '@/lib/auth';
import { handler, json, parseBody } from '@/lib/http';

const schema = z.object({ courseId: z.string().uuid(), examId: z.string().uuid().optional() });

export const POST = handler(async (request) => {
  const user = await requireUser();
  const input = await parseBody(request, schema);
  const attempt = await startAttempt(db(), subjectOf(user), input.courseId, input.examId);
  return json({ attempt }, 201);
});
