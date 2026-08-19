import { cookies } from 'next/headers';
import {
  Errors,
  SESSION_COOKIE_NAME,
  loadConfig,
  resolveSession,
  sessionCookieOptions,
  type AuthenticatedUser,
  type Subject,
} from '@sanad/core';
import { db } from '@sanad/db';

export const config = () => loadConfig();

export async function currentUser(): Promise<AuthenticatedUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;
  return resolveSession(db(), token);
}

/** Throws 401 rather than returning null — the common case in API routes. */
export async function requireUser(): Promise<AuthenticatedUser> {
  const user = await currentUser();
  if (!user) throw Errors.unauthenticated();
  return user;
}

export function subjectOf(user: AuthenticatedUser): Subject {
  return { userId: user.id, role: user.role };
}

export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, token, sessionCookieOptions(expiresAt, config().isProduction));
}

export async function clearSessionCookie(): Promise<string | undefined> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;
  store.delete(SESSION_COOKIE_NAME);
  return token;
}
