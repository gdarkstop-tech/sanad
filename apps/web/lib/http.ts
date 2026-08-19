import { NextResponse } from 'next/server';
import { ZodError, type ZodTypeAny, type output as ZodOutput } from 'zod';
import { AppError, Errors } from '@sanad/core';

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

/** Wraps a handler so no route has to repeat try/catch. */
export function handler(
  fn: (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<NextResponse>,
) {
  return async (
    request: Request,
    context: { params: Promise<Record<string, string>> },
  ): Promise<NextResponse> => {
    try {
      return await fn(request, context);
    } catch (error) {
      return problem(error, new URL(request.url).pathname);
    }
  };
}
