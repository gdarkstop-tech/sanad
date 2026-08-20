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

const WEEKDAY_EVENINGS = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
  weekday,
  startTime: '18:00',
  endTime: '22:00',
  kind: 'study' as const,
  isAvailable: true,
}));

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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ plan: Plan | null }>('/api/v1/me/study-plan')
      .then((data) => setPlan(data.plan))
      .catch(() => undefined);
  }, []);

  async function build() {
    setBusy(true);
    setError(null);
    try {
      // Sensible default availability so the coach is usable immediately;
      // the student can refine it later.
      await api('/api/v1/me/availability', {
        method: 'PUT',
        json: { windows: WEEKDAY_EVENINGS },
      });
      const data = await api<{ plan: Plan }>('/api/v1/me/study-plan', { method: 'POST' });
      setPlan(data.plan);
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }

  async function complete(id: string) {
    await api(`/api/v1/study-sessions/${id}/complete`, { method: 'POST' }).catch(() => undefined);
    const data = await api<{ plan: Plan | null }>('/api/v1/me/study-plan');
    setPlan(data.plan);
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
        </div>
      ) : null}
    </section>
  );
}
