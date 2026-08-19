import { z } from 'zod';
import { submitAnswer } from '@sanad/core';
import { db } from '@sanad/db';
import { requireUser, subjectOf } from '@/lib/auth';
import { handler, json, parseBody } from '@/lib/http';

const schema = z.object({
  questionId: z.string().uuid(),
  response: z.string().max(4000),
});

export const POST = handler(async (request, { params }) => {
  const user = await requireUser();
  const { attemptId } = await params;
  const input = await parseBody(request, schema);
  const graded = await submitAnswer(db(), subjectOf(user), attemptId as string, input);
  return json({ graded });
});
