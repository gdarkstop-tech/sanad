import { setAnswerSaved } from '@sanad/core';
import { db } from '@sanad/db';
import { requireUser, subjectOf } from '@/lib/auth';
import { handler, json } from '@/lib/http';

/** Bookmark. Scoped to the caller inside the update, so a guessed id saves nothing. */
export const POST = handler(async (_request, { params }) => {
  const user = await requireUser();
  const { messageId } = await params;
  const saved = await setAnswerSaved(db(), subjectOf(user), messageId as string, true);
  return json({ saved });
});

export const DELETE = handler(async (_request, { params }) => {
  const user = await requireUser();
  const { messageId } = await params;
  const saved = await setAnswerSaved(db(), subjectOf(user), messageId as string, false);
  return json({ saved });
});
