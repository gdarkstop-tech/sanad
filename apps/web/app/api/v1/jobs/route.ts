import { jobsFor, runPending } from '@sanad/core';
import { db } from '@sanad/db';
import { requireUser } from '@/lib/auth';
import { handler, json } from '@/lib/http';

/** Job status for one resource, so the UI can show real progress. */
export const GET = handler(async (request) => {
  await requireUser();
  const url = new URL(request.url);
  const targetType = url.searchParams.get('target_type');
  const targetId = url.searchParams.get('target_id');
  if (!targetType || !targetId) return json({ jobs: [] });

  const rows = await jobsFor(db(), targetType, targetId);
  return json({
    jobs: rows.map((j) => ({
      id: j.id,
      type: j.jobType,
      status: j.status,
      attempts: j.attempts,
      lastError: j.lastError,
      updatedAt: j.updatedAt,
    })),
  });
});

/** Manual drain — useful in development and as a demo-day safety valve. */
export const POST = handler(async () => {
  await requireUser();
  const summary = await runPending(db(), { max: 20 });
  return json({ summary });
});
