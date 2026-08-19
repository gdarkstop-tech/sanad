import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { emailVerificationTokens, users, type Database } from '@sanad/db';
import { Errors } from '../errors';

/**
 * Email verification.
 *
 * No email service is wired: a transactional email provider would be a paid
 * dependency, and the MVP budget is $0. `issueVerification` returns the link
 * and the caller decides what to do with it — in development it is logged, and
 * a provider can be added later behind the same call without touching this.
 */
const TOKEN_TTL_HOURS = 24;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface VerificationLink {
  token: string;
  expiresAt: Date;
}

export async function issueVerification(
  db: Database,
  userId: string,
  now: Date = new Date(),
): Promise<VerificationLink> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + TOKEN_TTL_HOURS * 3600 * 1000);

  await db.insert(emailVerificationTokens).values({
    userId,
    tokenHash: hashToken(token),
    expiresAt,
  });

  return { token, expiresAt };
}

/**
 * Consumes a token and marks the account verified.
 *
 * Single-use: `consumedAt` is set in the same transaction that flips
 * `emailVerifiedAt`, so a replayed link fails rather than silently succeeding.
 */
export async function verifyEmail(
  db: Database,
  token: string,
  now: Date = new Date(),
): Promise<{ userId: string }> {
  const tokenHash = hashToken(token);

  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(emailVerificationTokens)
      .where(
        and(
          eq(emailVerificationTokens.tokenHash, tokenHash),
          isNull(emailVerificationTokens.consumedAt),
          gt(emailVerificationTokens.expiresAt, now),
        ),
      )
      .limit(1);

    if (!row) {
      throw Errors.validation('This verification link is invalid or has expired.');
    }

    await tx
      .update(emailVerificationTokens)
      .set({ consumedAt: now })
      .where(eq(emailVerificationTokens.id, row.id));

    await tx
      .update(users)
      .set({ emailVerifiedAt: now, updatedAt: now })
      .where(eq(users.id, row.userId));

    return { userId: row.userId };
  });
}

export async function isVerified(db: Database, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ verifiedAt: users.emailVerifiedAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return Boolean(row?.verifiedAt);
}
