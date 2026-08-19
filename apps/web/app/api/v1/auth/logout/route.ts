import { revokeSession } from '@sanad/core';
import { db } from '@sanad/db';
import { clearSessionCookie } from '@/lib/auth';
import { handler, json } from '@/lib/http';

export const POST = handler(async () => {
  const token = await clearSessionCookie();
  await revokeSession(db(), token);
  return json({ ok: true });
});
