'use client';

import Link from 'next/link';
import { AuthForm } from '@/components/AuthForm';

/**
 * University, faculty, and department accept a typed name. Reference data may
 * not exist yet, and registration cannot deadlock on empty tables (API.md §2).
 */
export default function RegisterPage() {
  return (
    <main className="shell">
      <h1>Create your Sanad account</h1>
      <p className="lede">
        Your academic details help organize courses. You can change them later.
      </p>

      <AuthForm
        endpoint="/api/v1/auth/register"
        submitLabel="Create account"
        buildBody={(form) => {
          const text = (key: string) => {
            const value = String(form.get(key) ?? '').trim();
            return value.length > 0 ? value : undefined;
          };
          const university = text('university');
          const faculty = text('faculty');
          const department = text('department');
          return {
            email: text('email'),
            password: String(form.get('password') ?? ''),
            fullName: text('fullName'),
            role: 'student',
            interfaceLocale: text('interfaceLocale') ?? 'en',
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC',
            profile: {
              ...(university ? { university: { name: university } } : {}),
              ...(faculty ? { faculty: { name: faculty } } : {}),
              ...(department ? { department: { name: department } } : {}),
              ...(text('major') ? { major: text('major') } : {}),
              ...(text('studentNumber') ? { studentNumber: text('studentNumber') } : {}),
            },
          };
        }}
      >
        <div className="field">
          <label htmlFor="fullName">Full name</label>
          <input id="fullName" name="fullName" required autoComplete="name" />
        </div>
        <div className="field">
          <label htmlFor="email">University email</label>
          <input id="email" name="email" type="email" required autoComplete="email" />
        </div>
        <div className="field">
          <label htmlFor="password">Password (10 characters minimum)</label>
          <input
            id="password"
            name="password"
            type="password"
            minLength={10}
            required
            autoComplete="new-password"
          />
        </div>
        <div className="field">
          <label htmlFor="university">University</label>
          <input id="university" name="university" />
        </div>
        <div className="field">
          <label htmlFor="faculty">College / faculty</label>
          <input id="faculty" name="faculty" />
        </div>
        <div className="field">
          <label htmlFor="department">Department / major (optional)</label>
          <input id="department" name="department" />
        </div>
        <div className="field">
          <label htmlFor="interfaceLocale">Application language</label>
          <select id="interfaceLocale" name="interfaceLocale" defaultValue="en">
            <option value="en">English</option>
            <option value="ar">العربية</option>
            <option value="zh">中文</option>
          </select>
        </div>
      </AuthForm>

      <p className="muted" style={{ marginBlockStart: '1.25rem' }}>
        Already registered? <Link href="/sign-in">Sign in</Link>
      </p>
    </main>
  );
}
