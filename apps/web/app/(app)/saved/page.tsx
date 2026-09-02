import Link from 'next/link';
import { redirect } from 'next/navigation';
import { listSavedAnswers } from '@sanad/core';
import { db } from '@sanad/db';
import { AppNav } from '@/components/AppNav';
import { currentUser, subjectOf } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * Answers the student chose to keep.
 *
 * The citations shown are the ones stored with the answer, not recomputed —
 * a saved answer shows the evidence it actually cited at the time, which is
 * the only version worth keeping.
 */
export default async function SavedPage() {
  const user = await currentUser();
  if (!user) redirect('/sign-in');

  const answers = await listSavedAnswers(db(), subjectOf(user));

  return (
    <main className="shell">
      <AppNav name={user.fullName} current="/saved" />
      <h1>Saved answers</h1>
      <p className="lede">
        Kept with the sources they were given, so you can check them later.
      </p>

      {answers.length === 0 ? (
        <p className="muted">
          Nothing saved yet. Ask Sanad something and press <strong>☆ Save this answer</strong>.
        </p>
      ) : (
        <div className="stack-lg">
          {answers.map((entry) => (
            <article key={entry.id} className="card">
              <h2 style={{ marginBlockStart: 0, fontSize: '1.05rem' }} dir="auto">
                {entry.question}
              </h2>
              <p className="muted" style={{ marginBlock: '0.2rem 0.7rem' }}>
                {entry.courseTitle ?? 'All courses'} ·{' '}
                {new Date(entry.savedAt).toLocaleDateString()}
              </p>
              <pre className="answer-text" dir="auto">{entry.answer}</pre>

              {entry.citations.length > 0 ? (
                <>
                  <h3 className="sources-heading">Sources</h3>
                  <ul className="sources">
                    {entry.citations.map((citation) => (
                      <li key={citation.chunkId}>
                        {citation.deepLink ? (
                          <Link href={citation.deepLink}>{citation.label}</Link>
                        ) : (
                          <span>{citation.label}</span>
                        )}
                        {citation.quote ? (
                          <span className="quote" dir="auto">“{citation.quote}”</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
