'use client';

import { useState } from 'react';
import { api, messageFor } from '@/lib/client';

interface ExamPack {
  examId: string;
  summary: string | null;
  keywords: string[];
  emphasis: Array<{
    quote: string;
    lectureTitle: string | null;
    lectureId: string;
    tStartMs: number;
    timestamp: string;
    importanceType: string;
  }>;
  weakTopics: Array<{ id: string; name: string; masteryScore: number }>;
  flashcards: Array<{ id: string; front: string; back: string }>;
  questions: Array<{
    id: string;
    type: string;
    stem: string;
    modelAnswer: string | null;
    options: Array<{ id: string; text: string; isCorrect: boolean }>;
    sourceLabel: string;
  }>;
}

/** Exam Mode: everything generated from this course's own content, each item sourced. */
export function ExamMode({ courseId }: { courseId: string }) {
  const [pack, setPack] = useState<ExamPack | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const data = await api<{ exam: ExamPack }>(`/api/v1/courses/${courseId}/exam`, {
        method: 'POST',
        json: { questionCount: 10 },
      });
      setPack(data.exam);
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2>Exam Mode</h2>
      <p className="muted" style={{ marginBlockStart: 0 }}>
        Builds a study pack from this course’s own lectures and materials. Every item
        shows where it came from.
      </p>
      <button type="button" onClick={generate} disabled={busy}>
        {busy ? 'Preparing…' : 'Prepare me for the exam'}
      </button>

      {error ? <p className="error" role="alert">{error}</p> : null}

      {pack ? (
        <div className="stack-lg" style={{ marginBlockStart: '1.5rem' }}>
          {pack.emphasis.length > 0 ? (
            <div>
              <h3>What the instructor flagged</h3>
              <ul className="sources">
                {pack.emphasis.map((item, index) => (
                  <li key={index}>
                    <a href={`/lectures/${item.lectureId}?t=${Math.floor(item.tStartMs / 1000)}`}>
                      {item.lectureTitle ?? 'Lecture'} — {item.timestamp}
                    </a>
                    <span className="quote">“{item.quote}”</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {pack.summary ? (
            <div>
              <h3>Course summary</h3>
              {/* One extracted sentence per line: HTML would otherwise collapse
                  them into a single run-on paragraph. */}
              {pack.summary.split('\n').map((line, index) => (
                <p key={index} className="summary-line">
                  {line}
                </p>
              ))}
            </div>
          ) : null}

          {pack.keywords.length > 0 ? (
            <div>
              <h3>Key terms</h3>
              <div className="row">
                {pack.keywords.map((term) => (
                  <span key={term} className="pill">{term}</span>
                ))}
              </div>
            </div>
          ) : null}

          {pack.weakTopics.length > 0 ? (
            <div>
              <h3>Your weak areas</h3>
              <div className="row">
                {pack.weakTopics.map((topic) => (
                  <span key={topic.id} className="pill pill-failed">
                    {topic.name} · {Math.round(topic.masteryScore * 100)}%
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {pack.flashcards.length > 0 ? (
            <div>
              <h3>Flashcards</h3>
              <ul className="plain">
                {pack.flashcards.slice(0, 6).map((card) => (
                  <li key={card.id} className="card" style={{ marginBlockEnd: '0.6rem' }}>
                    <div>{card.front}</div>
                    <button
                      type="button"
                      className="secondary"
                      style={{ marginBlockStart: '0.5rem' }}
                      onClick={() => setRevealed((r) => ({ ...r, [card.id]: !r[card.id] }))}
                    >
                      {revealed[card.id] ? card.back : 'Reveal'}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div>
            <h3>Practice exam</h3>
            <ol className="plain" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {pack.questions.map((question, index) => (
                <li key={question.id} className="card">
                  <strong>
                    {index + 1}. <span className="pill">{question.type.replace('_', ' ')}</span>
                  </strong>
                  <p style={{ marginBlock: '0.5rem' }}>{question.stem}</p>
                  {question.options.length > 0 ? (
                    <ul className="plain">
                      {question.options.map((option) => (
                        <li key={option.id}>
                          <label className="row" style={{ gap: '0.4rem' }}>
                            <input type="radio" name={question.id} style={{ width: 'auto' }} />
                            {option.text}
                          </label>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <button
                    type="button"
                    className="secondary"
                    style={{ marginBlockStart: '0.5rem' }}
                    onClick={() => setRevealed((r) => ({ ...r, [question.id]: !r[question.id] }))}
                  >
                    {revealed[question.id] ? 'Hide answer' : 'Show model answer'}
                  </button>
                  {revealed[question.id] ? (
                    <p className="quote">{question.modelAnswer}</p>
                  ) : null}
                  <p className="muted" style={{ marginBlockEnd: 0, fontSize: '0.82rem' }}>
                    Source: {question.sourceLabel}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </div>
      ) : null}
    </section>
  );
}
