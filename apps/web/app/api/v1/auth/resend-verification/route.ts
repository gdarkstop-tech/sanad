import { RATE_LIMITS, identifierKey, issueVerification, rateLimit } from '@sanad/core';
import { db } from '@sanad/db';
import { config, requireUser } from '@/lib/auth';
import { handler, json } from '@/lib/http';

export const POST = handler(async () => {
  const user = await requireUser();
  const cfg = config();

  await rateLimit.enforce(
    db(),
    identifierKey('verify-resend', user.id),
    RATE_LIMITS.verificationResend,
  );

  const verification = await issueVerification(db(), user.id);
  const verifyPath = `/verify-email?token=${verification.token}`;
  console.info(`[verification] ${user.email} -> ${verifyPath}`);

  return json(cfg.isProduction ? { sent: true } : { sent: true, path: verifyPath });
});
