'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, messageFor } from '@/lib/client';

interface ExamDate {
  id: string;
  title: string;
  examAt: string;
}

/**
 * Exam dates for one course.
 *
 * This is what the Study Coach plans backwards from — without a date every
 * topic has the same urgency, which is the same as having no priorities.
 */
export function ExamDateForm({ courseId }: { courseId: string }) {
  const [exams, setExams] = useState<ExamDate[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<{ exams: ExamDate[] }>(`/api/v1/courses/${courseId}/exam-dates`);
      setExams(data.exams);
    } catch (caught) {
      setExams([]);
      setError(messageFor(caught));
    }
  }, [courseId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const title = String(data.get('title') ?? '').trim();
    const date = String(data.get('examAt') ?? '');
    if (!title || !date) return;

    setBusy(true);
    setError(null);
    try {
      await api(`/api/v1/courses/${courseId}/exam-dates`, {
        method: 'POST',
        // A date input has no time; midday avoids a timezone shift moving the
        // exam to the previous day for anyone west of UTC.
        json: { title, examAt: new Date(`${date}T12:00:00`).toISOString() },
      });
      form.reset();
      await load();
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setError(null);
    try {
      await api(`/api/v1/courses/${courseId}/exam-dates/${id}`, { method: 'DELETE' });
      await load();
    } catch (caught) {
      setError(messageFor(caught));
    }
  }

  return (
    <section className="card">
      <h2>Exam dates</h2>
      <p className="muted" style={{ marginBlockStart: 0 }}>
        The study coach plans backwards from these.
      </p>

      {error ? <p className="error" role="alert">{error}</p> : null}

      {exams === null ? (
        <p className="muted" role="status">Loading…</p>
      ) : exams.length === 0 ? (
        <p className="muted">None yet.</p>
      ) : (
        <ul className="plain">
          {exams.map((exam) => (
            <li key={exam.id} className="row" style={{ justifyContent: 'space-between' }}>
              <span>
                <strong>{exam.title}</strong>
                <span className="timestamp">
                  {' '}
                  {new Date(exam.examAt).toLocaleDateString(undefined, {
                    weekday: 'short',
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}
                </span>
              </span>
              <button type="button" className="secondary" onClick={() => remove(exam.id)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <form className="row" onSubmit={add} style={{ marginBlockStart: '0.8rem', alignItems: 'flex-end' }}>
        <div className="field">
          <label htmlFor="exam-title">What</label>
          <input id="exam-title" name="title" placeholder="Midterm" required maxLength={200} />
        </div>
        <div className="field">
          <label htmlFor="exam-date">When</label>
          <input id="exam-date" name="examAt" type="date" required />
        </div>
        <button type="submit" disabled={busy}>{busy ? 'Adding…' : 'Add exam date'}</button>
      </form>
    </section>
  );
}
