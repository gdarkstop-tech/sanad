import { listFaculties } from '@sanad/core';
import { db } from '@sanad/db';
import { handler, json } from '@/lib/http';

export const GET = handler(async (_request, { params }) => {
  const { id } = await params;
  const faculties = await listFaculties(db(), id as string);
  return json({ faculties });
});
