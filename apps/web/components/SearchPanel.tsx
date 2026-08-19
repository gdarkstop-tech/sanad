'use client';

import { useState, type FormEvent } from 'react';
import { api, messageFor } from '@/lib/client';

interface Result {
  chunkId: string;
  snippet: string;
  label: string;
  sourceType: string;
  deepLink: string | null;
}

/** Unified search across transcripts and materials for one course. */
export function SearchPanel({ courseId }: { courseId?: string }) {
  const [results, setResults] = useState<Result[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const q = String(new FormData(event.currentTarget).get('q') ?? '').trim();
    if (!q) return;
    setBusy(true);
    setError(null);
    try {
      const params = new URLSearchParams({ q });
      if (courseId) params.set('course_id', courseId);
      const data = await api<{ results: Result[] }>(`/api/v1/search?${params}`);
      setResults(data.results);
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2>Search</h2>
      <form onSubmit={onSubmit} className="row" style={{ gap: '0.5rem' }}>
        <input name="q" placeholder="Search lectures and materials" style={{ flex: 1 }} />
        <button type="submit" disabled={busy}>{busy ? '…' : 'Search'}</button>
      </form>

      {error ? <p className="error" role="alert">{error}</p> : null}

      {results !== null ? (
        results.length === 0 ? (
          <p className="muted" style={{ marginBlockStart: '1rem' }}>
            Nothing in your materials matches that.
          </p>
        ) : (
          <ul className="sources" style={{ marginBlockStart: '1rem' }}>
            {results.map((result) => (
              <li key={result.chunkId}>
                {result.deepLink ? (
                  <a href={result.deepLink}>{result.label}</a>
                ) : (
                  <span>{result.label}</span>
                )}
                <span className="quote">{result.snippet}</span>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </section>
  );
}
