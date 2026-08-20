import { z } from 'zod';
import { setCourseArchived } from '@sanad/core';
import { db } from '@sanad/db';
import { requireUser, subjectOf } from '@/lib/auth';
import { handler, json, parseBody } from '@/lib/http';

const schema = z.object({ archived: z.boolean() });

/** Archive or restore. Reversible, and distinct from DELETE, which is not. */
export const POST = handler(async (request, { params }) => {
  const user = await requireUser();
  const { offeringId } = await params;
  const { archived } = await parseBody(request, schema);
  const course = await setCourseArchived(db(), subjectOf(user), offeringId as string, archived);
  return json({ course });
});
