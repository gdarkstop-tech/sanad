/**
 * RFC 9457 problem details (API.md §1). Every failure the API returns is one
 * of these, so clients never have to parse prose to know what happened.
 */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  extensions?: Record<string, unknown>;
}

export class AppError extends Error {
  readonly status: number;
  readonly type: string;
  readonly title: string;
  readonly extensions: Record<string, unknown> | undefined;

  constructor(init: {
    status: number;
    type: string;
    title: string;
    detail?: string;
    extensions?: Record<string, unknown>;
  }) {
    super(init.detail ?? init.title);
    this.name = 'AppError';
    this.status = init.status;
    this.type = init.type;
    this.title = init.title;
    this.extensions = init.extensions;
  }

  toProblem(instance?: string): ProblemDetails {
    return {
      type: `https://sanad.app/errors/${this.type}`,
      title: this.title,
      status: this.status,
      ...(this.message && this.message !== this.title ? { detail: this.message } : {}),
      ...(instance ? { instance } : {}),
      ...(this.extensions ? { extensions: this.extensions } : {}),
    };
  }
}

export const Errors = {
  validation: (detail: string, extensions?: Record<string, unknown>) =>
    new AppError({
      status: 400,
      type: 'validation-failed',
      title: 'Request validation failed',
      detail,
      ...(extensions ? { extensions } : {}),
    }),

  unauthenticated: () =>
    new AppError({
      status: 401,
      type: 'unauthenticated',
      title: 'Sign in required',
    }),

  /**
   * Used where revealing existence would itself leak information — a student
   * probing another student's course IDs learns nothing (API.md §1).
   */
  notFound: (what = 'Resource') =>
    new AppError({ status: 404, type: 'not-found', title: `${what} not found` }),

  forbidden: (detail?: string) =>
    new AppError({
      status: 403,
      type: 'forbidden',
      title: 'Not permitted',
      ...(detail ? { detail } : {}),
    }),

  conflict: (title: string, detail?: string) =>
    new AppError({
      status: 409,
      type: 'conflict',
      title,
      ...(detail ? { detail } : {}),
    }),

  internal: () =>
    new AppError({ status: 500, type: 'internal', title: 'Something went wrong' }),
};
