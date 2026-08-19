import { registerSchema } from '@sanad/contracts';
import { registerUser } from '@sanad/core';
import { db } from '@sanad/db';
import { config, setSessionCookie } from '@/lib/auth';
import { handler, json, parseBody } from '@/lib/http';

export const POST = handler(async (request) => {
  const input = await parseBody(request, registerSchema);
  const cfg = config();
  const { user, session } = await registerUser(db(), input, cfg.sessionTtlDays);
  await setSessionCookie(session.token, session.expiresAt);
  return json({ user }, 201);
});
