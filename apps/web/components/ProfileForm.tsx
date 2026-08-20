'use client';

import { useState, type FormEvent } from 'react';
import { api, messageFor } from '@/lib/client';

export interface Profile {
  user: { fullName: string; email: string; emailVerified: boolean; interfaceLocale: string };
  universityName: string | null;
  facultyName: string | null;
  departmentName: string | null;
  academicYearLabel: string | null;
  major: string | null;
  studentNumber: string | null;
}

/**
 * The student's academic identity.
 *
 * Institution fields are free text rather than a dropdown: a dropdown of known
 * universities locks out the first student from anywhere new, and the server
 * creates the reference row on demand. Only what Sanad actually uses is asked
 * for — there is no date of birth, no phone number, no address.
 */
export function ProfileForm({ initial }: { initial: Profile }) {
  const [profile, setProfile] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const value = (name: string) => String(data.get(name) ?? '').trim();

    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const result = await api<{ profile: Profile }>('/api/v1/me/profile', {
        method: 'PATCH',
        json: {
          fullName: value('fullName'),
          universityName: value('universityName') || null,
          facultyName: value('facultyName') || null,
          departmentName: value('departmentName') || null,
          major: value('major') || null,
          studentNumber: value('studentNumber') || null,
        },
      });
      setProfile(result.profile);
      setSaved(true);
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card stack" onSubmit={save}>
      <h2 style={{ marginBlockStart: 0 }}>Your details</h2>

      {error ? <p className="error" role="alert">{error}</p> : null}
      {saved && !error ? <p className="muted" role="status">Saved.</p> : null}

      <div className="field">
        <label htmlFor="fullName">Name</label>
        <input id="fullName" name="fullName" defaultValue={profile.user.fullName} maxLength={200} required />
      </div>

      <div className="field">
        <label htmlFor="email">Email</label>
        <input id="email" value={profile.user.email} readOnly disabled />
        <span className="muted" style={{ fontSize: '0.85rem' }}>
          {profile.user.emailVerified ? 'Verified' : 'Not verified yet'}
        </span>
      </div>

      <div className="field">
        <label htmlFor="universityName">University</label>
        <input
          id="universityName"
          name="universityName"
          defaultValue={profile.universityName ?? ''}
          maxLength={200}
          placeholder="Your university"
        />
      </div>

      <div className="field">
        <label htmlFor="facultyName">Faculty</label>
        <input
          id="facultyName"
          name="facultyName"
          defaultValue={profile.facultyName ?? ''}
          maxLength={200}
          placeholder="Faculty of Engineering"
        />
      </div>

      <div className="field">
        <label htmlFor="departmentName">Department</label>
        <input
          id="departmentName"
          name="departmentName"
          defaultValue={profile.departmentName ?? ''}
          maxLength={200}
          placeholder="Computer Engineering"
        />
      </div>

      <div className="field">
        <label htmlFor="major">Major</label>
        <input id="major" name="major" defaultValue={profile.major ?? ''} maxLength={200} />
      </div>

      <div className="field">
        <label htmlFor="studentNumber">Student number</label>
        <input
          id="studentNumber"
          name="studentNumber"
          defaultValue={profile.studentNumber ?? ''}
          maxLength={60}
        />
      </div>

      {profile.academicYearLabel ? (
        <p className="muted">Academic year: {profile.academicYearLabel}</p>
      ) : null}

      <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
    </form>
  );
}
