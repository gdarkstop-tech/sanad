'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { api, messageFor } from '@/lib/client';

export interface CourseSummary {
  id: string;
  title: string;
  code: string | null;
  primaryLanguage: string;
  isOwner: boolean;
}

/**
 * A course is whatever the student types. No subject list, no picker, nothing
 * enumerated — see brief §32 and scripts/check-course-agnostic.sh.
 */
export function CourseList({ courses }: { courses: CourseSummary[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createCourse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const title = String(form.get('title') ?? '').trim();
    if (!title) return;

    const formElement = event.currentTarget;
    setBusy(true);
    setError(null);
    try {
      await api('/api/v1/courses', {
        method: 'POST',
        json: {
          title,
          code: String(form.get('code') ?? '').trim() || undefined,
          primaryLanguage: String(form.get('primaryLanguage') ?? 'ar'),
        },
      });
      formElement.reset();
      router.refresh();
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      await api(`/api/v1/courses/${id}`, { method: 'DELETE' });
      router.refresh();
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="card" style={{ marginBlockEnd: '1.5rem' }}>
        <h2>Add a course</h2>
        <form className="stack" onSubmit={createCourse}>
          <div className="field">
            <label htmlFor="title">Course name</label>
            <input id="title" name="title" required maxLength={200} />
          </div>
          <div className="field">
            <label htmlFor="code">Course code (optional)</label>
            <input id="code" name="code" maxLength={40} />
          </div>
          <div className="field">
            <label htmlFor="primaryLanguage">Main lecture language</label>
            <select id="primaryLanguage" name="primaryLanguage" defaultValue="ar">
              <option value="ar">العربية</option>
              <option value="en">English</option>
              <option value="zh">中文</option>
            </select>
          </div>
          {error ? (
            <p className="error" role="alert">
              {error}
            </p>
          ) : null}
          <button type="submit" disabled={busy}>
            Add course
          </button>
        </form>
      </section>

      <h2>Your courses</h2>
      {courses.length === 0 ? (
        <p className="muted">No courses yet. Add your first one above.</p>
      ) : (
        <div className="grid">
          {courses.map((course) => (
            <article key={course.id} className="card">
              <h2 style={{ marginBlockEnd: '0.25rem' }}>{course.title}</h2>
              <p className="muted">
                {course.code ? `${course.code} · ` : ''}
                {course.primaryLanguage}
              </p>
              {course.isOwner ? (
                <div className="row" style={{ marginBlockStart: '0.75rem' }}>
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    onClick={() => remove(course.id)}
                  >
                    Delete
                  </button>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </>
  );
}
