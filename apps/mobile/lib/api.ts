import AsyncStorage from '@react-native-async-storage/async-storage';
import type { HttpClient, HttpResponse } from '@sanad/offline';
import { getApiUrl } from './config';

/**
 * API client.
 *
 * All business logic lives on the server; this only carries the session cookie
 * and shapes errors. React Native has no cookie jar by default, so the session
 * cookie is stored and replayed explicitly.
 */

const SESSION_KEY = 'sanad.session.cookie';
const CSRF_KEY = 'sanad.session.csrf';

let sessionCookie: string | null = null;
let csrfToken: string | null = null;

export async function restoreSession(): Promise<boolean> {
  sessionCookie = await AsyncStorage.getItem(SESSION_KEY);
  csrfToken = await AsyncStorage.getItem(CSRF_KEY);
  return sessionCookie !== null;
}

export async function clearSession(): Promise<void> {
  sessionCookie = null;
  csrfToken = null;
  await AsyncStorage.multiRemove([SESSION_KEY, CSRF_KEY]);
}

function captureCookies(response: Response): void {
  const raw = response.headers.get('set-cookie');
  if (!raw) return;
  for (const part of raw.split(/,(?=\s*\w+=)/)) {
    const pair = part.split(';')[0]?.trim();
    if (!pair) continue;
    if (pair.startsWith('sanad_session=')) {
      sessionCookie = pair;
      void AsyncStorage.setItem(SESSION_KEY, pair);
    }
    if (pair.startsWith('sanad_csrf=')) {
      csrfToken = pair.split('=')[1] ?? null;
      if (csrfToken) void AsyncStorage.setItem(CSRF_KEY, csrfToken);
    }
  }
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  const result: Record<string, string> = { ...extra };
  const cookies = [sessionCookie, csrfToken ? `sanad_csrf=${csrfToken}` : null]
    .filter(Boolean)
    .join('; ');
  if (cookies) result.cookie = cookies;
  if (csrfToken) result['x-csrf-token'] = csrfToken;
  return result;
}

/**
 * The server was never reached: wrong address, server not running, firewall, or
 * the device is on another network.
 *
 * Deliberately not an `ApiError`. Screens treat a reply with a status as the
 * server talking and a transport failure as "we are offline", and that
 * distinction is what keeps downloaded courses reachable on a dead network.
 */
export class NetworkError extends Error {
  constructor(readonly url: string) {
    super(
      `Cannot reach the server at ${url}. Check that it is running and that this device is on the same network.`,
    );
    this.name = 'NetworkError';
  }
}

/**
 * `fetch` rejects with a bare "Network request failed" when it cannot reach the
 * host. On a phone that is the most likely failure and the least informative
 * message in the app, so the address it actually tried is named.
 */
async function reach(path: string, init?: RequestInit): Promise<Response> {
  const base = getApiUrl();
  try {
    return await fetch(`${base}${path}`, init);
  } catch {
    throw new NetworkError(base);
  }
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function parse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { title: text.slice(0, 200) };
  }
}

/** Surfaces the API's problem+json detail so the student sees a real reason. */
function messageOf(body: unknown, status: number): string {
  const problem = body as { detail?: string; title?: string } | null;
  return problem?.detail ?? problem?.title ?? `Request failed (${status})`;
}

export async function apiGet<T>(path: string): Promise<T> {
  const response = await reach(path, { headers: headers() });
  captureCookies(response);
  const body = await parse(response);
  if (!response.ok) throw new ApiError(response.status, messageOf(body, response.status));
  return body as T;
}

export async function apiSend<T>(
  path: string,
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  json?: unknown,
): Promise<T> {
  const response = await reach(path, {
    method,
    headers: headers(json !== undefined ? { 'content-type': 'application/json' } : {}),
    body: json !== undefined ? JSON.stringify(json) : undefined,
  });
  captureCookies(response);
  const body = await parse(response);
  if (!response.ok) throw new ApiError(response.status, messageOf(body, response.status));
  return body as T;
}

/**
 * The HttpClient the upload queue drives.
 *
 * Deliberately the same endpoints the web app uses — there is one upload
 * system, not two.
 */
export const httpClient: HttpClient = {
  async postJson(path, body): Promise<HttpResponse> {
    const response = await reach(path, {
      method: 'POST',
      headers: headers({ 'content-type': 'application/json' }),
      body: JSON.stringify(body ?? {}),
    });
    captureCookies(response);
    return { ok: response.ok, status: response.status, body: await parse(response) };
  },
  async getJson(path): Promise<HttpResponse> {
    const response = await reach(path, { headers: headers() });
    captureCookies(response);
    return { ok: response.ok, status: response.status, body: await parse(response) };
  },
  async putBytes(path, bytes, extra): Promise<HttpResponse> {
    const response = await reach(path, {
      method: 'PUT',
      headers: headers(extra),
      body: bytes as unknown as BodyInit,
    });
    captureCookies(response);
    return { ok: response.ok, status: response.status, body: await parse(response) };
  },
};

/** Warms the CSRF cookie before the first state-changing request. */
export async function primeCsrf(): Promise<void> {
  if (csrfToken) return;
  const response = await reach('/sign-in', { method: 'GET' });
  captureCookies(response);
}
