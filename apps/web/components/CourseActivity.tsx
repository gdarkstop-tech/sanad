import Link from 'next/link';

/**
 * What has happened in this course lately.
 *
 * Everything here is read from tables that already exist — the last lecture,
 * the next exam, how much has been transcribed. Nothing is invented, and where
 * there is nothing to show it says so rather than filling the space.
 */
export function CourseActivity({
  courseId,
  lastLecture,
  nextExam,
  readyCount,
  materialCount,
}: {
  courseId: string;
  lastLecture: { id: string; title: string; status: string } | null;
  nextExam: { title: string; examAt: string } | null;
  readyCount: number;
  materialCount: number;
}) {
  const days = nextExam
    ? Math.ceil((new Date(nextExam.examAt).getTime() - Date.now()) / 86_400_000)
    : null;

  return (
    <section className="card">
      <h2 style={{ marginBlockStart: 0 }}>At a glance</h2>
      <ul className="plain activity">
        <li>
          <span className="muted">Most recent lecture</span>
          {lastLecture ? (
            <Link href={`/lectures/${lastLecture.id}`}>{lastLecture.title}</Link>
          ) : (
            <span className="muted">None yet — record or upload one</span>
          )}
        </li>
        <li>
          <span className="muted">Next exam</span>
          {nextExam && days !== null ? (
            <span>
              {nextExam.title} ·{' '}
              {days <= 0 ? 'today' : `${days} day${days === 1 ? '' : 's'} away`}
            </span>
          ) : (
            <span className="muted">No date set</span>
          )}
        </li>
        <li>
          <span className="muted">Ready to study</span>
          <span>
            {readyCount} transcribed lecture{readyCount === 1 ? '' : 's'} · {materialCount}{' '}
            document{materialCount === 1 ? '' : 's'}
          </span>
        </li>
        <li>
          <span className="muted">Course</span>
          <Link href={`/courses/${courseId}`}>Open everything</Link>
        </li>
      </ul>
    </section>
  );
}
