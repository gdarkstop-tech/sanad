import { removeCommitment } from '@sanad/core';
import { db } from '@sanad/db';
import { requireUser, subjectOf } from '@/lib/auth';
import { handler, json } from '@/lib/http';

export const DELETE = handler(async (_request, { params }) => {
  const user = await requireUser();
  const { commitmentId } = await params;
  await removeCommitment(db(), subjectOf(user), commitmentId as string);
  return json({ ok: true });
});
