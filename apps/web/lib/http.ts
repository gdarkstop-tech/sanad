import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { ZodError, type ZodTypeAny, type output as ZodOutput } from 'zod';
import { AppError, CSRF_COOKIE_NAME, CSRF_HEADER_NAME, Errors, assertCsrf } from '@sanad/core';

/**
 * One place that turns anything thrown by a handler into RFC 9457
 * problem+json (API.md §1). Handlers throw; they never format errors.
 */
export function problem(error: unknown, instance?: string): NextResponse {
  if (error instanceof AppError) {
    const body = error.toProblem(instance);
    return NextResponse.json(body, {
      status: body.status,
      headers: { 'content-type': 'application/problem+json' },
    });
  }

  if (error instanceof ZodError) {
    const body = Errors.validation('One or more fields are invalid.', {
      issues: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    }).toProblem(instance);
    return NextResponse.json(body, {
      status: body.status,
      headers: { 'content-type': 'application/problem+json' },
    });
  }

  console.error('[unhandled]', error);
  const body = Errors.internal().toProblem(instance);
  return NextResponse.json(body, {
    status: body.status,
    headers: { 'content-type': 'application/problem+json' },
  });
}

export function json<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

export async function parseBody<S extends ZodTypeAny>(
  request: Request,
  schema: S,
): Promise<ZodOutput<S>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw Errors.validation('Request body must be valid JSON.');
  }
  return schema.parse(raw);
}

/**
 * Wraps a handler so no route repeats try/catch — and so CSRF is checked in one
 * place rather than remembered per route. A route that forgets a security check
 * is the failure mode this exists to prevent.
 */
export function handler(
  fn: (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<NextResponse>,
  options: { csrf?: boolean } = {},
) {
  return async (
    request: Request,
    context: { params: Promise<Record<string, string>> },
  ): Promise<NextResponse> => {
    try {
      if (options.csrf !== false) {
        const store = await cookies();
        assertCsrf(
          request.method,
          store.get(CSRF_COOKIE_NAME)?.value,
          request.headers.get(CSRF_HEADER_NAME) ?? undefined,
        );
      }
      return await fn(request, context);
    } catch (error) {
      return problem(error, new URL(request.url).pathname);
    }
  };
}

/** Best-effort client address for rate-limit bucketing behind a proxy. */
export function clientIp(request: Request): string | null {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]?.trim() ?? null;
  return request.headers.get('x-real-ip');
}
