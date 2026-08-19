import { NextResponse, type NextRequest } from 'next/server';
import { CSRF_COOKIE_NAME } from '@sanad/contracts';

/**
 * Issues the CSRF cookie on first contact so the very first state-changing
 * request (register or sign-in) already has a token to echo.
 *
 * Runs in the edge runtime: Web Crypto only, and no import from @sanad/core,
 * which is server-only.
 */
function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function middleware(request: NextRequest) {
  const response = NextResponse.next();
  if (!request.cookies.get(CSRF_COOKIE_NAME)) {
    response.cookies.set(CSRF_COOKIE_NAME, generateToken(), {
      httpOnly: false, // read by the page's own script — that is the mechanism
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
    });
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
