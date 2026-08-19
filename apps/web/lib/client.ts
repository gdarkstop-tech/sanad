'use client';

import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from '@sanad/contracts';

function readCookie(name: string): string | undefined {
  return document.cookie
    .split('; ')
    .find((entry) => entry.startsWith(`${name}=`))
    ?.split('=')[1];
}

export interface ApiError {
  status: number;
  title: string;
  detail?: string;
}

/**
 * Single fetch path for every client component: attaches the CSRF header and
 * turns problem+json into a message a user can act on. Components never call
 * fetch directly, so no component can forget the header.
 */
export async function api<T>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  const token = readCookie(CSRF_COOKIE_NAME);
  if (token) headers.set(CSRF_HEADER_NAME, token);
  if (init.json !== undefined) headers.set('content-type', 'application/json');

  const response = await fetch(path, {
    ...init,
    headers,
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
  });

  if (response.status === 204) return undefined as T;

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error: ApiError = {
      status: response.status,
      title: payload?.title ?? 'Something went wrong',
      detail: payload?.detail,
    };
    throw error;
  }
  return payload as T;
}

export function messageFor(error: unknown): string {
  if (error && typeof error === 'object' && 'title' in error) {
    const e = error as ApiError;
    return e.detail ?? e.title;
  }
  if (error instanceof Error) return error.message;
  return 'Something went wrong.';
}
