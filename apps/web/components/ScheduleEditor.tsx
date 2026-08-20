'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, messageFor } from '@/lib/client';

/**
 * The student's real week.
 *
 * The scheduler already subtracted work, gym and class windows — nothing could
 * enter them. Without this the coach planned around an invented week of free
 * evenings, which is the difference between a schedule a student follows and
 * one they ignore.
 *
 * Everything here is an input to deterministic scheduling. No model reads it.
 */

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const KINDS = [
  { value: 'study', label: 'Free to study', available: true },
  { value: 'class', label: 'University', available: false },
  { value: 'work', label: 'Work', available: false },
  { value: 'gym', label: 'Gym', available: false },
  { value: 'sleep', label: 'Sleep', available: false },
  { value: 'other', label: 'Other commitment', available: false },
] as const;

type Kind = (typeof KINDS)[number]['value'];

interface Window {
  id?: string;
  weekday: number;
  startTime: string;
  endTime: string;
  kind: Kind;
  isAvailable: boolean;
}

interface Commitment {
  id: string;
  title: string;
  kind: string;
  startsAt: string;
  endsAt: string;
}

interface ExamDate {
  id: string;
  offeringId: string;
  courseTitle: string;
  title: string;
  examAt: string;
}

/** `18:00:00` from Postgres, `18:00` from an input. One shape for both. */
function hhmm(time: string): string {
  return time.slice(0, 5);
}

function kindOf(value: string): Kind {
  return (KINDS.find((k) => k.value === value)?.value ?? 'other') as Kind;
}

export function ScheduleEditor({ onPlanned }: { onPlanned?: () => void }) {
  const [windows, setWindows] = useState<Window[] | null>(null);
  const [commitments, setCommitments] = useState<Commitment[]>([]);
  const [exams, setExams] = useState<ExamDate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const [draft, setDraft] = useState({
    weekday: 1,
    startTime: '18:00',
    endTime: '21:00',
    kind: 'study' as Kind,
  });

  const load = useCallback(async () => {
    setError(null);
    try {
      const [week, once, examList] = await Promise.all([
        api<{ windows: Window[] }>('/api/v1/me/availability'),
        api<{ commitments: Commitment[] }>('/api/v1/me/commitments'),
        api<{ exams: ExamDate[] }>('/api/v1/me/exam-dates'),
      ]);
      setWindows(
        week.windows.map((w) => ({
          ...w,
          startTime: hhmm(w.startTime),
          endTime: hhmm(w.endTime),
          kind: kindOf(w.kind),
        })),
      );
      setCommitments(once.commitments);
      setExams(examList.exams);
    } catch (caught) {
      setWindows([]);
      setError(messageFor(caught));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** The whole week is replaced on every save: a partial edit is ambiguous. */
  async function persist(next: Window[]) {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await api('/api/v1/me/availability', {
        method: 'PUT',
        json: {
          windows: next.map((w) => ({
            weekday: w.weekday,
            startTime: w.startTime,
            endTime: w.endTime,
            kind: w.kind,
            isAvailable: w.isAvailable,
          })),
        },
      });
      setWindows(next);
      setSaved(true);
    } catch (caught) {
      setError(messageFor(caught));
      // Re-read rather than keeping an optimistic list the server rejected.
      void load();
    } finally {
      setBusy(false);
    }
  }

  function addWindow() {
    if (draft.endTime <= draft.startTime) {
      setError('A window has to end after it starts.');
      return;
    }
    const template = KINDS.find((k) => k.value === draft.kind);
    void persist([
      ...(windows ?? []),
      { ...draft, isAvailable: template?.available ?? false },
    ]);
  }

  function removeWindow(index: number) {
    void persist((windows ?? []).filter((_, i) => i !== index));
  }

  async function plan() {
    setBusy(true);
    setError(null);
    try {
      await api('/api/v1/me/study-plan', { method: 'POST' });
      onPlanned?.();
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }

  async function removeCommitment(id: string) {
    setError(null);
    try {
      await api(`/api/v1/me/commitments/${id}`, { method: 'DELETE' });
      setCommitments((list) => list.filter((c) => c.id !== id));
    } catch (caught) {
      setError(messageFor(caught));
    }
  }

  if (windows === null) {
    return (
      <section className="card">
        <h2>Your week</h2>
        <p className="muted" role="status">Loading your schedule…</p>
      </section>
    );
  }

  const byDay = WEEKDAYS.map((name, weekday) => ({
    name,
    weekday,
    entries: windows
      .map((w, index) => ({ ...w, index }))
      .filter((w) => w.weekday === weekday)
      .sort((a, b) => a.startTime.localeCompare(b.startTime)),
  }));

  return (
    <section className="card">
      <h2>Your week</h2>
      <p className="muted" style={{ marginBlockStart: 0 }}>
        Tell Sanad when you have class, work, or the gym. It plans around them —
        it will never schedule study over a commitment.
      </p>

      {error ? <p className="error" role="alert">{error}</p> : null}
      {saved && !error ? (
        <p className="muted" role="status">Saved. Re-plan your week to use it.</p>
      ) : null}

      <div className="week">
        {byDay.map((day) => (
          <div key={day.weekday} className="week-day">
            <h3 className="week-day-name">{day.name}</h3>
            {day.entries.length === 0 ? (
              <p className="muted week-empty">Nothing declared</p>
            ) : (
              <ul className="plain">
                {day.entries.map((entry) => (
                  <li key={`${entry.weekday}-${entry.startTime}-${entry.kind}`} className="week-entry">
                    <span className={entry.isAvailable ? 'pill pill-ready' : 'pill'}>
                      {KINDS.find((k) => k.value === entry.kind)?.label ?? entry.kind}
                    </span>
                    <span className="timestamp">
                      {entry.startTime}–{entry.endTime}
                    </span>
                    <button
                      type="button"
                      className="secondary week-remove"
                      onClick={() => removeWindow(entry.index)}
                      disabled={busy}
                      aria-label={`Remove ${entry.startTime} on ${day.name}`}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>

      <div className="row" style={{ marginBlockStart: '1rem', alignItems: 'flex-end' }}>
        <div className="field">
          <label htmlFor="sched-day">Day</label>
          <select
            id="sched-day"
            value={draft.weekday}
            onChange={(e) => setDraft({ ...draft, weekday: Number(e.target.value) })}
          >
            {WEEKDAYS.map((name, index) => (
              <option key={name} value={index}>{name}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="sched-kind">What</label>
          <select
            id="sched-kind"
            value={draft.kind}
            onChange={(e) => setDraft({ ...draft, kind: e.target.value as Kind })}
          >
            {KINDS.map((kind) => (
              <option key={kind.value} value={kind.value}>{kind.label}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="sched-from">From</label>
          <input
            id="sched-from"
            type="time"
            value={draft.startTime}
            onChange={(e) => setDraft({ ...draft, startTime: e.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="sched-to">To</label>
          <input
            id="sched-to"
            type="time"
            value={draft.endTime}
            onChange={(e) => setDraft({ ...draft, endTime: e.target.value })}
          />
        </div>
        <button type="button" onClick={addWindow} disabled={busy}>
          {busy ? 'Saving…' : 'Add'}
        </button>
      </div>

      {exams.length > 0 ? (
        <>
          <h3>Exams ahead</h3>
          <ul className="plain">
            {exams.map((exam) => (
              <li key={exam.id} className="row" style={{ justifyContent: 'space-between' }}>
                <span>
                  <strong>{exam.courseTitle}</strong>
                  <span className="muted"> · {exam.title}</span>
                </span>
                <span className="timestamp">
                  {new Date(exam.examAt).toLocaleDateString(undefined, {
                    weekday: 'short',
                    day: 'numeric',
                    month: 'short',
                  })}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="muted">
          No exam dates yet. Add one from a course page — the coach works backwards from them.
        </p>
      )}

      {commitments.length > 0 ? (
        <>
          <h3>One-off commitments</h3>
          <ul className="plain">
            {commitments.map((commitment) => (
              <li key={commitment.id} className="row" style={{ justifyContent: 'space-between' }}>
                <span>
                  {commitment.title}
                  <span className="muted">
                    {' '}· {new Date(commitment.startsAt).toLocaleString(undefined, {
                      weekday: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </span>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => removeCommitment(commitment.id)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <button
        type="button"
        onClick={plan}
        disabled={busy}
        style={{ marginBlockStart: '1rem' }}
      >
        {busy ? 'Planning…' : 'Plan my week around this'}
      </button>
    </section>
  );
}
