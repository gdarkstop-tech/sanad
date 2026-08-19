import { uploadStatus } from '@sanad/core';
import { db } from '@sanad/db';
import { requireUser, subjectOf } from '@/lib/auth';
import { handler, json } from '@/lib/http';

/** Answers "where did I get to?" after an app restart or a dropped connection. */
export const GET = handler(async (_request, { params }) => {
  const user = await requireUser();
  const { uploadId } = await params;
  const upload = await uploadStatus(db(), subjectOf(user), uploadId as string);
  return json({ upload });
});
