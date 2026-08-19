'use client';

import Link from 'next/link';
import { AuthForm } from '@/components/AuthForm';

export default function SignInPage() {
  return (
    <main className="shell">
      <h1>Sign in to Sanad</h1>
      <p className="lede">Your lectures, your materials, your study plan.</p>

      <AuthForm
        endpoint="/api/v1/auth/login"
        submitLabel="Sign in"
        buildBody={(form) => ({
          email: String(form.get('email') ?? ''),
          password: String(form.get('password') ?? ''),
        })}
      >
        <div className="field">
          <label htmlFor="email">University email</label>
          <input id="email" name="email" type="email" autoComplete="email" required />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </div>
      </AuthForm>

      <p className="muted" style={{ marginBlockStart: '1.25rem' }}>
        No account yet? <Link href="/register">Create one</Link>
      </p>
    </main>
  );
}
