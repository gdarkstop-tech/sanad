'use client';

import { useEffect, useState } from 'react';
import { api, messageFor } from '@/lib/client';

interface Session {
  id: string;
  startsAt: string;
  endsAt: string;
  activityType: string;
  courseTitle: string | null;
  topicName: string | null;
  rationale: { mastery?: number; daysToExam?: number | null };
}

interface Plan {
  planId: string;
  coachMessage: string;
  sessions: Session[];
}

function when(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleString(undefined, {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Study Coach. The plan comes from deterministic scheduling; only the message
 * above it is written prose, and it quotes the scheduler's own numbers.
 */
export function StudyCoach() {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ plan: Plan | null }>('/api/v1/me/study-plan')
      .then((data) => setPlan(data.plan))
      // A failure here is not the same as "no plan yet", and saying so is the
      // difference between the student retrying and assuming it is empty.
      .catch((caught: unknown) => setError(messageFor(caught)))
      .finally(() => setLoading(false));
  }, []);

  async function build() {
    setBusy(true);
    setError(null);
    try {
      // The week comes from what the student declared above. Inventing a
      // default here would produce a plan over hours they never said they had.
      const data = await api<{ plan: Plan }>('/api/v1/me/study-plan', { method: 'POST' });
      setPlan(data.plan);
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }

  async function complete(id: string) {
    setError(null);
    try {
      await api(`/api/v1/study-sessions/${id}/complete`, { method: 'POST' });
      const data = await api<{ plan: Plan | null }>('/api/v1/me/study-plan');
      setPlan(data.plan);
    } catch (caught) {
      // Marking a session done and having nothing happen is worse than an
      // error message, because the student cannot tell it did not work.
      setError(messageFor(caught));
    }
  }

  return (
    <section className="card">
      <h2>Study coach</h2>
      <p className="muted" style={{ marginBlockStart: 0 }}>
        Plans your week around your weak topics and exam dates. The schedule is
        computed, not guessed.
      </p>
      <button type="button" onClick={build} disabled={busy}>
        {busy ? 'Planning…' : plan ? 'Re-plan my week' : 'Plan my week'}
      </button>

      {error ? <p className="error" role="alert">{error}</p> : null}
      {loading ? <p className="muted" role="status">Loading your plan…</p> : null}
      {!loading && !plan && !error ? (
        <p className="muted">
          No plan yet. Add an exam date to a course, then plan your week.
        </p>
      ) : null}

      {plan ? (
        <div style={{ marginBlockStart: '1.25rem' }}>
          <p>{plan.coachMessage}</p>
          {plan.sessions.length > 0 ? (
            <ul className="plain" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {plan.sessions.slice(0, 8).map((session) => (
                <li key={session.id} className="row" style={{ justifyContent: 'space-between' }}>
                  <span>
                    <span className="timestamp">{when(session.startsAt)}</span>{' '}
                    <strong>{session.topicName ?? 'Review'}</strong>
                    <span className="muted"> · {session.courseTitle}</span>
                    <span className="pill" style={{ marginInlineStart: '0.4rem' }}>
                      {session.activityType}
                    </span>
                  </span>
                  <button type="button" className="secondary" onClick={() => complete(session.id)}>
                    Done
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {plan.sessions.length > 8 ? (
            <p className="muted" style={{ marginBlockEnd: 0 }}>
              Showing the next 8 of {plan.sessions.length} planned sessions.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
