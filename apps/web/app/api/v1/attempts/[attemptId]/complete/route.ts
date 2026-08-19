import { completeAttempt } from '@sanad/core';
import { db } from '@sanad/db';
import { requireUser, subjectOf } from '@/lib/auth';
import { handler, json } from '@/lib/http';

export const POST = handler(async (_request, { params }) => {
  const user = await requireUser();
  const { attemptId } = await params;
  const result = await completeAttempt(db(), subjectOf(user), attemptId as string);
  return json({ result });
});
