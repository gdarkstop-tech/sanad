import Link from 'next/link';
import { roadmapFor } from '@sanad/contracts';

/**
 * A feature that is designed but not built.
 *
 * Deliberately inert: no fetch, no spinner, no disabled form that looks like it
 * would work if you were logged in differently. It states what the feature will
 * do and that it is not available, because a preview that behaves like a broken
 * feature is worse than no preview.
 */
export function ComingSoon({
  title,
  promise,
  detail,
  children,
}: {
  title: string;
  /** One sentence, in the student's language, about what they will get. */
  promise: string;
  /** Why it is not here yet. Honest, not apologetic. */
  detail?: string;
  children?: React.ReactNode;
}) {
  return (
    <section className="card soon">
      <div className="soon-head">
        <h2 style={{ margin: 0 }}>{title}</h2>
        <span className="pill pill-soon">Coming soon</span>
      </div>
      <p className="soon-promise">{promise}</p>
      {detail ? <p className="muted" style={{ marginBlockEnd: 0 }}>{detail}</p> : null}
      {children}
    </section>
  );
}

/**
 * The roadmap for one surface.
 *
 * The list is shared with the mobile app via `@sanad/contracts`, so a feature
 * cannot read as "coming soon" in one place and be implied to work in another.
 */
export function RoadmapGrid({
  surface,
  extra,
}: {
  surface: Parameters<typeof roadmapFor>[0];
  extra?: React.ReactNode;
}) {
  const items = roadmapFor(surface);
  if (items.length === 0) return null;

  return (
    <div className="grid">
      {items.map((item) => (
        <ComingSoon
          key={item.id}
          title={item.title}
          promise={item.promise}
          detail={item.detail}
        >
          {item.id === 'community-feed' ? (
            <Link href="/community" className="soon-link">
              See the preview →
            </Link>
          ) : null}
        </ComingSoon>
      ))}
      {extra}
    </div>
  );
}
