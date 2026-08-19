import { searchUniversities } from '@sanad/core';
import { db } from '@sanad/db';
import { handler, json } from '@/lib/http';

/** Public: the registration picker needs it before a session exists. */
export const GET = handler(async (request) => {
  const q = new URL(request.url).searchParams.get('q') ?? '';
  const universities = await searchUniversities(db(), q);
  return json({ universities });
});
