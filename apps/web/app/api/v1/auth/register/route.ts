import { registerSchema } from '@sanad/contracts';
import { RATE_LIMITS, identifierKey, ipKey, issueVerification, rateLimit, registerUser } from '@sanad/core';
import { db } from '@sanad/db';
import { config, setSessionCookie } from '@/lib/auth';
import { clientIp, handler, json, parseBody } from '@/lib/http';

export const POST = handler(async (request) => {
  const input = await parseBody(request, registerSchema);
  const cfg = config();

  await rateLimit.enforce(db(), ipKey('register', clientIp(request)), RATE_LIMITS.register);

  const { user, session } = await registerUser(db(), input, cfg.sessionTtlDays);
  await setSessionCookie(session.token, session.expiresAt);

  // No email provider is wired — a transactional email service would be a paid
  // dependency and the budget is $0. The link is returned in development so the
  // flow is demonstrable end to end; a provider slots in behind this call.
  const verification = await issueVerification(db(), user.id);
  const verifyPath = `/verify-email?token=${verification.token}`;
  // Always logged server-side: with no email provider wired, the server log is
  // the only delivery channel. The link is returned to the client only outside
  // production, so it never reaches a browser that should have received a mail.
  console.info(`[verification] ${user.email} -> ${verifyPath}`);

  return json(
    { user, ...(cfg.isProduction ? {} : { verification: { path: verifyPath } }) },
    201,
  );
});
