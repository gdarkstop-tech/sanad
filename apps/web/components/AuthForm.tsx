'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  endpoint: string;
  submitLabel: string;
  buildBody: (form: FormData) => unknown;
  children: ReactNode;
}

/**
 * Shared submit handling for sign-in and registration. Surfaces the
 * problem+json `title`/`detail` rather than a generic message — an error the
 * user cannot act on is not an error message (API.md §1).
 */
export function AuthForm({ endpoint, submitLabel, buildBody, children }: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const body = buildBody(new FormData(event.currentTarget));
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (response.ok) {
      router.push('/dashboard');
      router.refresh();
      return;
    }

    const problem = await response.json().catch(() => null);
    setError(problem?.detail ?? problem?.title ?? 'Something went wrong.');
    setBusy(false);
  }

  return (
    <form className="stack" onSubmit={onSubmit}>
      {children}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      <button type="submit" disabled={busy}>
        {busy ? '…' : submitLabel}
      </button>
    </form>
  );
}
