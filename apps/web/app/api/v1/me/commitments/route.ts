import { z } from 'zod';
import { addCommitment, listCommitments } from '@sanad/core';
import { db } from '@sanad/db';
import { requireUser, subjectOf } from '@/lib/auth';
import { handler, json, parseBody } from '@/lib/http';

/**
 * One-off commitments — a dated exam, a shift, a trip.
 *
 * Weekly rhythm lives in `/me/availability`; anything that happens once lives
 * here. The scheduler subtracts both.
 */
const schema = z.object({
  title: z.string().trim().min(1).max(200),
  kind: z.enum(['study', 'work', 'gym', 'class', 'sleep', 'other']).default('other'),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
});

export const GET = handler(async () => {
  const user = await requireUser();
  const commitments = await listCommitments(db(), subjectOf(user));
  return json({ commitments });
});

export const POST = handler(async (request) => {
  const user = await requireUser();
  const input = await parseBody(request, schema);
  const commitment = await addCommitment(db(), subjectOf(user), {
    title: input.title,
    kind: input.kind,
    startsAt: new Date(input.startsAt),
    endsAt: new Date(input.endsAt),
  });
  return json({ commitment }, 201);
});
