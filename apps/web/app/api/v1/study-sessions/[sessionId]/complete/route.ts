import { completeSession } from '@sanad/core';
import { db } from '@sanad/db';
import { requireUser, subjectOf } from '@/lib/auth';
import { handler, json } from '@/lib/http';

export const POST = handler(async (_request, { params }) => {
  const user = await requireUser();
  const { sessionId } = await params;
  await completeSession(db(), subjectOf(user), sessionId as string);
  return json({ ok: true });
});
