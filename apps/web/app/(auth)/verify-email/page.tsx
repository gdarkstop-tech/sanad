'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { api, messageFor } from '@/lib/client';

type State = { status: 'working' | 'done' | 'failed'; message?: string };

function VerifyEmail() {
  const token = useSearchParams().get('token');
  const [state, setState] = useState<State>({ status: 'working' });

  useEffect(() => {
    if (!token) {
      setState({ status: 'failed', message: 'This link is missing its verification token.' });
      return;
    }
    api('/api/v1/auth/verify-email', { method: 'POST', json: { token } })
      .then(() => setState({ status: 'done' }))
      .catch((error) => setState({ status: 'failed', message: messageFor(error) }));
  }, [token]);

  return (
    <main className="shell">
      <h1>Verify your email</h1>
      {state.status === 'working' ? <p className="lede">Checking your link…</p> : null}
      {state.status === 'done' ? (
        <>
          <p className="lede">Your email is verified.</p>
          <Link href="/dashboard">Go to your courses</Link>
        </>
      ) : null}
      {state.status === 'failed' ? (
        <>
          <p className="error" role="alert">{state.message}</p>
          <p className="muted">
            Verification links expire after 24 hours and can only be used once.{' '}
            <Link href="/dashboard">Request a new one from your dashboard</Link>.
          </p>
        </>
      ) : null}
    </main>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<main className="shell"><p className="lede">Loading…</p></main>}>
      <VerifyEmail />
    </Suspense>
  );
}
