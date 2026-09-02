import Link from 'next/link';
import type { StudentOverview } from '@sanad/core';

/**
 * The student's own numbers.
 *
 * Everything here is counted from the database. Where there is nothing to
 * count, the tile says so rather than showing a zero dressed up as progress.
 */
export function OverviewPanel({ overview }: { overview: StudentOverview }) {
  const tiles = [
    {
      label: 'Courses',
      value: String(overview.courses.active),
      note: overview.courses.archived > 0 ? `${overview.courses.archived} archived` : 'active',
    },
    {
      label: 'Lectures',
      value: String(overview.lectures.total),
      note:
        overview.lectures.total === 0
          ? 'none yet'
          : `${overview.lectures.withTranscript} with a transcript`,
    },
    {
      label: 'Documents',
      value: String(overview.materials),
      note: overview.materials === 0 ? 'none uploaded' : 'uploaded',
    },
    {
      label: 'Study sessions',
      value: String(overview.study.completed),
      note:
        overview.study.upcoming > 0
          ? `${overview.study.upcoming} planned`
          : 'completed',
    },
    {
      label: 'Questions asked',
      value: String(overview.questionsAsked),
      note: overview.savedAnswers > 0 ? `${overview.savedAnswers} saved` : 'so far',
    },
  ];

  return (
    <>
      <div className="tiles">
        {tiles.map((tile) => (
          <div key={tile.label} className="tile">
            <span className="tile-value">{tile.value}</span>
            <span className="tile-label">{tile.label}</span>
            <span className="muted tile-note">{tile.note}</span>
          </div>
        ))}
      </div>

      <div className="grid" style={{ marginBlockStart: '1rem' }}>
        <section className="card">
          <h2 style={{ marginBlockStart: 0 }}>Exams ahead</h2>
          {overview.nextExams.length === 0 ? (
            <p className="muted">
              No exam dates yet. Add one on a course page — the study coach plans backwards
              from them.
            </p>
          ) : (
            <ul className="plain">
              {overview.nextExams.map((exam) => (
                <li key={exam.id} className="row" style={{ justifyContent: 'space-between' }}>
                  <span>
                    <strong>{exam.courseTitle}</strong>
                    <span className="muted"> · {exam.title}</span>
                  </span>
                  <span className="timestamp">
                    {exam.daysAway === 0 ? 'today' : `${exam.daysAway}d`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <h2 style={{ marginBlockStart: 0 }}>Needs work</h2>
          {overview.weakTopics.length === 0 ? (
            <p className="muted">
              Nothing flagged. Weak topics appear once you have answered enough exam
              questions for the result to mean something.
            </p>
          ) : (
            <ul className="plain">
              {overview.weakTopics.map((topic) => (
                <li key={topic.id} className="row" style={{ justifyContent: 'space-between' }}>
                  <span>
                    {topic.name}
                    {topic.courseTitle ? (
                      <span className="muted"> · {topic.courseTitle}</span>
                    ) : null}
                  </span>
                  <span className="pill pill-failed">
                    {Math.round(topic.masteryScore * 100)}%
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <h2 style={{ marginBlockStart: 0 }}>Recent lectures</h2>
          {overview.recentLectures.length === 0 ? (
            <p className="muted">No lectures yet.</p>
          ) : (
            <ul className="plain">
              {overview.recentLectures.map((lecture) => (
                <li key={lecture.id}>
                  <Link href={`/lectures/${lecture.id}`}>{lecture.title}</Link>
                  <span className="muted"> · {lecture.courseTitle}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
