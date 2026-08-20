import { listFolders } from '@sanad/core';
import { db } from '@sanad/db';
import { requireUser, subjectOf } from '@/lib/auth';
import { handler, json } from '@/lib/http';

export const GET = handler(async (_request, { params }) => {
  const user = await requireUser();
  const { offeringId } = await params;
  const folders = await listFolders(db(), subjectOf(user), offeringId as string);
  return json({ folders });
});
