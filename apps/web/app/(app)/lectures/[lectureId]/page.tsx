import { eq } from 'drizzle-orm';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { formatTimestamp, getLecture } from '@sanad/core';
import { db, lectureEmphasis, transcriptSegments } from '@sanad/db';
import { AskPanel } from '@/components/AskPanel';
import { currentUser, subjectOf } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * The lecture workspace: transcript, emphasis and Ask Sanad in one place, so
 * everything visibly belongs to the same lecture.
 */
export default async function LecturePage({
  params,
}: {
  params: Promise<{ lectureId: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect('/sign-in');
  const { lectureId } = await params;

  const lecture = await getLecture(db(), subjectOf(user), lectureId);
  const segments = await db()
    .select()
    .from(transcriptSegments)
    .where(eq(transcriptSegments.lectureId, lecture.id))
    .orderBy(transcriptSegments.seq);
  const emphasis = await db()
    .select()
    .from(lectureEmphasis)
    .where(eq(lectureEmphasis.lectureId, lecture.id))
    .orderBy(lectureEmphasis.tStartMs);

  return (
    <main className="shell">
      <header className="topbar">
        <Link href="/dashboard" className="brand">Sanad</Link>
        <Link href={`/courses/${lecture.offeringId}`}>Back to course</Link>
      </header>

      <h1>{lecture.title}</h1>
      <p className="lede">
        <span className={`pill pill-${lecture.status}`}>{lecture.status}</span>
        {segments.length > 0 ? ` · ${segments.length} transcript segments` : ' · no transcript yet'}
      </p>

      <div className="stack-lg">
        {emphasis.length > 0 ? (
          <section className="card emphasis">
            <h2>Flagged by the instructor</h2>
            <ul className="plain">
              {emphasis.map((item) => (
                <li key={item.id}>
                  <span className="pill pill-exam_relevant">{item.importanceType.replace('_', ' ')}</span>{' '}
                  <span className="timestamp">{formatTimestamp(item.tStartMs)}</span>
                  <div className="quote">“{item.quote}”</div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="card">
          <h2>Transcript</h2>
          {segments.length === 0 ? (
            <p className="muted">
              No transcript yet. Upload a recording for this lecture and it will be
              transcribed automatically.
            </p>
          ) : (
            <ol className="transcript">
              {segments.map((segment) => (
                <li key={segment.id} id={`t-${Math.floor(segment.tStartMs / 1000)}`}>
                  <span className="timestamp">{formatTimestamp(segment.tStartMs)}</span>
                  <span
                    className={segment.confidenceBand === 'low' ? 'seg uncertain' : 'seg'}
                    dir="auto"
                    title={
                      segment.confidenceBand === 'low'
                        ? 'Sanad was not confident about this passage'
                        : undefined
                    }
                  >
                    {segment.displayText}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <AskPanel courseId={lecture.offeringId} courseTitle={lecture.title} />
      </div>
    </main>
  );
}
