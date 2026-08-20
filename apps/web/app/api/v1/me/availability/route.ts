import { z } from 'zod';
import { readAvailability, setAvailability } from '@sanad/core';
import { db } from '@sanad/db';
import { requireUser, subjectOf } from '@/lib/auth';
import { handler, json, parseBody } from '@/lib/http';

const timePattern = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

const schema = z.object({
  windows: z
    .array(
      z.object({
        weekday: z.number().int().min(0).max(6),
        startTime: z.string().regex(timePattern),
        endTime: z.string().regex(timePattern),
        kind: z.enum(['study', 'work', 'gym', 'class', 'sleep', 'other']),
        isAvailable: z.boolean(),
      }),
    )
    .max(60),
});

/** The declared week, so an editor can render what the scheduler actually uses. */
export const GET = handler(async () => {
  const user = await requireUser();
  const windows = await readAvailability(db(), subjectOf(user));
  return json({ windows });
});

/** Replaces the whole week: partial edits of a schedule are ambiguous. */
export const PUT = handler(async (request) => {
  const user = await requireUser();
  const { windows } = await parseBody(request, schema);
  await setAvailability(db(), subjectOf(user), windows);
  return json({ ok: true, count: windows.length });
});
