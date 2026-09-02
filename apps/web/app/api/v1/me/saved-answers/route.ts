import { listSavedAnswers } from '@sanad/core';
import { db } from '@sanad/db';
import { requireUser, subjectOf } from '@/lib/auth';
import { handler, json } from '@/lib/http';

export const GET = handler(async () => {
  const user = await requireUser();
  const answers = await listSavedAnswers(db(), subjectOf(user));
  return json({ answers });
});
