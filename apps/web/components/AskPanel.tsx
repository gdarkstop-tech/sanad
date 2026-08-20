'use client';

import { useState, type FormEvent } from 'react';
import { api, messageFor } from '@/lib/client';
import { DerivedFromDemoNote } from '@/components/TranscriptSourceNote';

interface Citation {
  chunkId: string;
  label: string;
  quote: string;
  deepLink: string | null;
  tStartMs: number | null;
  pageNo: number | null;
}

interface AskResponse {
  answer: string;
  refused: boolean;
  citations: Citation[];
  meta: { topScore: number; generator: string; mode: string; latencyMs: number };
}

/**
 * Ask Sanad.
 *
 * A refusal is rendered as an answer, not an error — it is correct behaviour,
 * and the most important thing this product does. Sources are always shown
 * alongside an answer, never optionally.
 */
export function AskPanel({
  courseId,
  courseTitle,
  demoContent = false,
}: {
  courseId: string;
  courseTitle: string;
  /** True when any lecture in scope has a placeholder transcript. */
  demoContent?: boolean;
}) {
  const [result, setResult] = useState<AskResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const question = String(new FormData(event.currentTarget).get('question') ?? '').trim();
    if (question.length < 3) return;

    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await api<AskResponse>('/api/v1/ask', { method: 'POST', json: { question, courseId } }));
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2>Ask Sanad</h2>
      <p className="muted" style={{ marginBlockStart: 0 }}>
        Answers come only from {courseTitle}. If your materials don’t cover it, Sanad says so.
      </p>

      <DerivedFromDemoNote show={Boolean(demoContent)} />

      <form className="stack" onSubmit={onSubmit} style={{ maxWidth: 'none' }}>
        <div className="field">
          <label htmlFor="question">Your question</label>
          <input
            id="question"
            name="question"
            placeholder="What did the professor say about…"
            required
            minLength={3}
          />
        </div>
        <div className="row">
          <button type="submit" disabled={busy}>
            {busy ? 'Searching your materials…' : 'Ask'}
          </button>
        </div>
      </form>

      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}

      {result ? (
        <div style={{ marginBlockStart: '1.25rem' }} aria-live="polite">
          <div className={result.refused ? 'answer refused' : 'answer'}>
            {result.refused ? (
              <>
                <strong>No supporting material found</strong>
                <p style={{ marginBlockEnd: 0 }}>{result.answer}</p>
              </>
            ) : (
              <pre className="answer-text">{result.answer}</pre>
            )}
          </div>

          {result.citations.length > 0 ? (
            <>
              <h3 className="sources-heading">Sources</h3>
              <ul className="sources">
                {result.citations.map((citation) => (
                  <li key={citation.chunkId}>
                    {citation.deepLink ? (
                      <a href={citation.deepLink}>{citation.label}</a>
                    ) : (
                      <span>{citation.label}</span>
                    )}
                    <span className="quote">“{citation.quote}”</span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          <p className="muted meta-line">
            {result.meta.generator === 'none'
              ? 'No answer was generated — retrieval found insufficient evidence.'
              : `Evidence-based answer · ${result.meta.mode} retrieval · ${result.meta.latencyMs} ms`}
          </p>
        </div>
      ) : null}
    </section>
  );
}
