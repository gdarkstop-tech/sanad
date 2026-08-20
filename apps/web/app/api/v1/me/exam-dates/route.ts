import { listExamDates } from '@sanad/core';
import { db } from '@sanad/db';
import { requireUser, subjectOf } from '@/lib/auth';
import { handler, json } from '@/lib/http';

/** Every exam the student has entered, across courses — what the coach plans back from. */
export const GET = handler(async () => {
  const user = await requireUser();
  const exams = await listExamDates(db(), subjectOf(user));
  return json({ exams });
});
