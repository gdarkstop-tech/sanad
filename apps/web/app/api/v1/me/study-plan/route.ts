import { currentPlan, generatePlan } from '@sanad/core';
import { db } from '@sanad/db';
import { requireUser, subjectOf } from '@/lib/auth';
import { handler, json } from '@/lib/http';

export const GET = handler(async () => {
  const user = await requireUser();
  const plan = await currentPlan(db(), subjectOf(user));
  return json({ plan });
});

/** Deterministic: same inputs, same plan, no model involved. */
export const POST = handler(async () => {
  const user = await requireUser();
  const plan = await generatePlan(db(), subjectOf(user));
  return json({ plan }, 201);
});
