import { z } from 'zod';
import { addExamDate } from '@sanad/core';
import { db } from '@sanad/db';
import { requireUser, subjectOf } from '@/lib/auth';
import { handler, json, parseBody } from '@/lib/http';

const schema = z.object({
  title: z.string().trim().min(1).max(200),
  examAt: z.string().datetime(),
});

export const POST = handler(async (request, { params }) => {
  const user = await requireUser();
  const { offeringId } = await params;
  const input = await parseBody(request, schema);
  await addExamDate(db(), subjectOf(user), {
    offeringId: offeringId as string,
    title: input.title,
    examAt: new Date(input.examAt),
  });
  return json({ ok: true }, 201);
});
