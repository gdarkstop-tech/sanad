import { loginSchema } from '@sanad/contracts';
import { RATE_LIMITS, authenticate, identifierKey, ipKey, rateLimit } from '@sanad/core';
import { db } from '@sanad/db';
import { config, setSessionCookie } from '@/lib/auth';
import { clientIp, handler, json, parseBody } from '@/lib/http';

export const POST = handler(async (request) => {
  const input = await parseBody(request, loginSchema);
  const cfg = config();

  // Two buckets: per-IP stops one host spraying many accounts, per-email stops
  // a distributed attack concentrating on one account. Either alone leaves a gap.
  await rateLimit.enforce(db(), ipKey('login', clientIp(request)), RATE_LIMITS.login);
  await rateLimit.enforce(db(), identifierKey('login', input.email), RATE_LIMITS.login);

  const { user, session } = await authenticate(
    db(),
    input.email,
    input.password,
    cfg.sessionTtlDays,
  );
  await setSessionCookie(session.token, session.expiresAt);
  return json({ user });
});
