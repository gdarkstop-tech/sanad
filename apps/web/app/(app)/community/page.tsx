import { redirect } from 'next/navigation';
import { AppNav } from '@/components/AppNav';
import { ComingSoon } from '@/components/ComingSoon';
import { currentUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * Sanad Community — a preview.
 *
 * Every post below is written into this file. Nothing is fetched, nothing is
 * stored, and no control does anything, because a preview that behaves like a
 * broken feature is worse than an honest one. The sample is here so the shape
 * of the idea is arguable — what a question looks like, where a TA answers,
 * how an AI reply is marked — not to imply the backend exists.
 */

/**
 * Sample posts.
 *
 * Deliberately subject-neutral: naming a discipline here would put a subject
 * into application code, which CI rejects and which the product's whole claim
 * is against. It also implies content exists for that subject when none does.
 * What the preview is showing is the *shape* of the interaction — a question, a
 * TA answer, an AI reply that cites a lecture — not a particular course.
 */
const SAMPLE = [
  {
    kind: 'question',
    author: 'Second-year student',
    time: '2 hours ago',
    course: 'One of your courses',
    body: 'The professor said this condition has to be strictly greater than, not greater than or equal. Does anyone know why the boundary case fails?',
    replies: [
      {
        author: 'Teaching assistant',
        badge: 'TA',
        body: 'At the boundary the result is not guaranteed — you can construct a case where it breaks. That is why it is stated as a strict inequality.',
      },
      {
        author: 'Sanad',
        badge: 'AI',
        body: 'Related moment in your Lecture 06 at 24:15 — the professor covers exactly this boundary case.',
      },
    ],
  },
  {
    kind: 'discussion',
    author: 'Third-year student',
    time: 'yesterday',
    course: 'Another course you follow',
    body: 'Sharing my summary of everything from this week. Corrections welcome — I am not certain about the third step.',
    replies: [
      {
        author: 'Classmate',
        badge: null,
        body: 'Step three looks right to me, but I would double-check it against the lecture around the 30-minute mark.',
      },
    ],
  },
  {
    kind: 'video',
    author: 'Teaching assistant',
    time: '3 days ago',
    course: 'One of your courses',
    body: 'Posted a 6-minute walkthrough of the problems that came up in the past three exams.',
    replies: [],
  },
];

export default async function CommunityPage() {
  const user = await currentUser();
  if (!user) redirect('/sign-in');

  return (
    <main className="shell">
      <AppNav name={user.fullName} current="/community" />

      <h1>Sanad Community</h1>

      <ComingSoon
        title="Ask, discuss, and learn with your university community"
        promise="Post a question about a lecture, answer someone else’s, and share what you worked out — with your course, your faculty, or your whole university."
        detail="Not built yet. A social layer means moderation, abuse handling and a privacy review before it goes anywhere near student work, and that is not a week of work. Everything below is a static preview written into the page: nothing is loaded, nothing is stored, and no button does anything."
      />

      <h2 style={{ marginBlockStart: '1.6rem' }}>What it will look like</h2>
      <p className="muted" aria-hidden="true">Preview content — not real posts.</p>

      <div className="feed" aria-label="Preview of the community feed">
        {SAMPLE.map((post, index) => (
          <article key={index} className="card feed-post">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span>
                <strong>{post.author}</strong>
                <span className="muted"> · {post.course}</span>
              </span>
              <span className="muted" style={{ fontSize: '0.82rem' }}>{post.time}</span>
            </div>
            <p style={{ marginBlock: '0.6rem' }}>{post.body}</p>
            <span className="pill">{post.kind}</span>

            {post.replies.length > 0 ? (
              <ul className="plain feed-replies">
                {post.replies.map((reply, replyIndex) => (
                  <li key={replyIndex}>
                    <span className={reply.badge === 'AI' ? 'pill pill-ai' : 'pill'}>
                      {reply.badge ?? 'Student'}
                    </span>{' '}
                    <strong>{reply.author}</strong>
                    <p style={{ marginBlock: '0.3rem 0' }}>{reply.body}</p>
                  </li>
                ))}
              </ul>
            ) : null}
          </article>
        ))}
      </div>

      <p className="muted" style={{ marginBlockStart: '1.2rem' }}>
        When this is built, an answer from Sanad will follow the same rules as Ask Sanad:
        it cites the lecture it came from, it is always badged as AI, and it says nothing
        when the material does not support an answer.
      </p>
    </main>
  );
}
