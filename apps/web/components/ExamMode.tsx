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
/**
 * The three MVP languages. Choosing one is honest about what it can deliver:
 * Sanad extracts study content from the material rather than writing it, and a
 * translated quotation is no longer a quotation, so anything other than the
 * language of the lecture says so instead of silently showing the original.
 */
const LANGUAGES = [
  { code: 'ar', label: 'العربية', english: 'Arabic' },
  { code: 'en', label: 'English', english: 'English' },
  { code: 'zh', label: '中文', english: 'Chinese' },
];

export function ExamMode({
  courseId,
  courseLanguage,
}: {
  courseId: string;
  courseLanguage: string;
}) {
  const [pack, setPack] = useState<ExamPack | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [language, setLanguage] = useState(courseLanguage);

  const target = LANGUAGES.find((l) => l.code === language);
  const source = LANGUAGES.find((l) => l.code === courseLanguage);
  const untranslated = language !== courseLanguage;

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
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <button type="button" onClick={generate} disabled={busy}>
          {busy ? 'Preparing…' : 'Prepare me for the exam'}
        </button>
        <div className="field">
          <label htmlFor="study-language">Study in</label>
          <select
            id="study-language"
            value={language}
            onChange={(event) => setLanguage(event.target.value)}
          >
            {LANGUAGES.map((option) => (
              <option key={option.code} value={option.code}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {untranslated ? (
        <p className="muted notice" role="status">
          Sanad cannot translate study content into {target?.english ?? language} yet, so
          this stays in {source?.english ?? courseLanguage} — the language the lecture was
          taught in. Everything below is quoted from your own material, and translating a
          quotation would break the link between a sentence and the moment it came from.
        </p>
      ) : null}

      {error ? <p className="error" role="alert">{error}</p> : null}

      {pack && pack.questions.length === 0 && pack.flashcards.length === 0 && !pack.summary ? (
        <p className="muted" style={{ marginBlockStart: '1rem' }}>
          There is nothing to build a pack from yet. Upload a document or a lecture
          recording for this course first — everything here is generated from the
          course’s own content, so it cannot be produced from nothing.
        </p>
      ) : null}

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
              {pack.flashcards.length > 6 ? (
                <p className="muted" style={{ marginBlockEnd: 0 }}>
                  Showing 6 of {pack.flashcards.length}.
                </p>
              ) : null}
            </div>
          ) : null}

          {pack.questions.length > 0 ? (
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
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
