import { loginSchema } from '@sanad/contracts';
import { authenticate } from '@sanad/core';
import { db } from '@sanad/db';
import { config, setSessionCookie } from '@/lib/auth';
import { handler, json, parseBody } from '@/lib/http';

export const POST = handler(async (request) => {
  const input = await parseBody(request, loginSchema);
  const cfg = config();
  const { user, session } = await authenticate(
    db(),
    input.email,
    input.password,
    cfg.sessionTtlDays,
  );
  await setSessionCookie(session.token, session.expiresAt);
  return json({ user });
});
