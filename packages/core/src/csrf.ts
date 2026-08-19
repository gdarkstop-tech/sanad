import { createHash, randomBytes } from 'node:crypto';
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from '@sanad/contracts';
import { AppError } from './errors';
import { safeEqual } from './session';

/**
 * Double-submit cookie CSRF protection.
 *
 * The token is set in a cookie the page's own JavaScript can read, and must be
 * echoed in a request header. A cross-site attacker can cause the browser to
 * send the cookie but cannot read it to construct the header, so the two cannot
 * be made to match from another origin.
 *
 * SameSite=Lax on the session cookie already blocks cross-site form POSTs; this
 * is the second layer, and it also covers same-site subdomain cases that Lax
 * does not.
 */
export { CSRF_COOKIE_NAME, CSRF_HEADER_NAME };

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function generateCsrfToken(): string {
  return randomBytes(32).toString('base64url');
}

export function requiresCsrfCheck(method: string): boolean {
  return !SAFE_METHODS.has(method.toUpperCase());
}

export function csrfCookieOptions(secure: boolean) {
  return {
    // Readable by the page's own script — that is the mechanism, not an oversight.
    httpOnly: false,
    sameSite: 'lax' as const,
    secure,
    path: '/',
  };
}

/**
 * Throws 403 unless the header matches the cookie. Comparison is constant-time
 * and length-checked; a missing value on either side is a failure, never a skip.
 */
export function assertCsrf(
  method: string,
  cookieToken: string | undefined,
  headerToken: string | undefined,
): void {
  if (!requiresCsrfCheck(method)) return;

  if (!cookieToken || !headerToken) {
    throw new AppError({
      status: 403,
      type: 'csrf-failed',
      title: 'Request rejected',
      detail: 'Missing CSRF token. Reload the page and try again.',
    });
  }

  if (!safeEqual(hash(cookieToken), hash(headerToken))) {
    throw new AppError({
      status: 403,
      type: 'csrf-failed',
      title: 'Request rejected',
      detail: 'CSRF token mismatch. Reload the page and try again.',
    });
  }
}

/** Hashing first makes the constant-time compare independent of token length. */
function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
