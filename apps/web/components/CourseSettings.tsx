'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { api, messageFor } from '@/lib/client';

/**
 * Renaming, re-coding, archiving and deleting one course.
 *
 * Archive and delete sit together deliberately, with different weights:
 * archiving is reversible and keeps every lecture, deleting is not. Putting
 * them in the same place with that difference stated is safer than hiding the
 * destructive one somewhere else.
 */
export function CourseSettings({
  courseId,
  title,
  code,
  primaryLanguage,
  archivedAt,
}: {
  courseId: string;
  title: string;
  code: string | null;
  primaryLanguage: string;
  archivedAt: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const nextTitle = String(data.get('title') ?? '').trim();
    if (!nextTitle) {
      setError('A course needs a name.');
      return;
    }

    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await api(`/api/v1/courses/${courseId}`, {
        method: 'PATCH',
        json: {
          title: nextTitle,
          code: String(data.get('code') ?? '').trim() || null,
          primaryLanguage: String(data.get('primaryLanguage') ?? primaryLanguage),
        },
      });
      setSaved(true);
      router.refresh();
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }

  async function setArchived(archived: boolean) {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/v1/courses/${courseId}/archive`, { method: 'POST', json: { archived } });
      router.refresh();
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/v1/courses/${courseId}`, { method: 'DELETE' });
      router.push('/dashboard');
    } catch (caught) {
      setError(messageFor(caught));
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <div className="spread">
        <h2 style={{ margin: 0 }}>Course settings</h2>
        <button type="button" className="secondary" onClick={() => setOpen((was) => !was)}>
          {open ? 'Close' : 'Edit course'}
        </button>
      </div>

      {!open ? null : (
        <>
          {error ? <p className="error" role="alert">{error}</p> : null}
          {saved && !error ? <p className="muted" role="status">Saved.</p> : null}

          <form className="stack" onSubmit={save} style={{ marginBlockStart: '0.8rem' }}>
            <div className="field">
              <label htmlFor="course-title">Course name</label>
              <input id="course-title" name="title" defaultValue={title} maxLength={200} required />
            </div>
            <div className="field">
              <label htmlFor="course-code">Course code (optional)</label>
              <input id="course-code" name="code" defaultValue={code ?? ''} maxLength={40} />
            </div>
            <div className="field">
              <label htmlFor="course-language">Main lecture language</label>
              <select id="course-language" name="primaryLanguage" defaultValue={primaryLanguage}>
                <option value="ar">العربية</option>
                <option value="en">English</option>
                <option value="zh">中文</option>
              </select>
            </div>
            <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
          </form>

          <hr className="rule" />

          <div className="row">
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => setArchived(!archivedAt)}
            >
              {archivedAt ? 'Restore this course' : 'Archive this course'}
            </button>
            <span className="muted">
              {archivedAt
                ? 'Archived courses keep everything inside them.'
                : 'Hides it from your course list. Nothing is deleted.'}
            </span>
          </div>

          <div className="row" style={{ marginBlockStart: '0.8rem' }}>
            {confirmingDelete ? (
              <>
                <button type="button" className="danger" disabled={busy} onClick={remove}>
                  {busy ? 'Deleting…' : 'Yes, delete it'}
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setConfirmingDelete(false)}
                >
                  Cancel
                </button>
                <span className="muted">
                  This removes the course and its lectures from your list.
                </span>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setConfirmingDelete(true)}
                >
                  Delete this course
                </button>
                <span className="muted">Archiving is usually what you want instead.</span>
              </>
            )}
          </div>
        </>
      )}
    </section>
  );
}
