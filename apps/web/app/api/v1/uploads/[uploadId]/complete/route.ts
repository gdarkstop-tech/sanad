import { completeUpload, runPending } from '@sanad/core';
import { db } from '@sanad/db';
import { requireUser, subjectOf } from '@/lib/auth';
import { handler, json } from '@/lib/http';

export const POST = handler(async (_request, { params }) => {
  const user = await requireUser();
  const { uploadId } = await params;
  const result = await completeUpload(db(), subjectOf(user), uploadId as string);

  // Drain inline: on a laptop there is no separate worker process, and the
  // student expects their upload to start processing immediately.
  await runPending(db(), { max: 5 }).catch((error) => {
    console.error('[worker] inline drain failed', error);
  });

  return json({ material: result });
});
