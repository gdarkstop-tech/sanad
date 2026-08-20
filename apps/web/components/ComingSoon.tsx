import Link from 'next/link';

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

/** The roadmap, in one place, so the demo can show the whole vision honestly. */
export function RoadmapGrid() {
  return (
    <div className="grid">
      <ComingSoon
        title="AI Voice Tutor"
        promise="Ask Sanad about your lectures using your voice."
        detail="It will answer through the same grounded retrieval as Ask Sanad — same citations, same refusal when your materials don’t cover the question. Waiting on a speech model that runs locally at no cost."
      />
      <ComingSoon
        title="YouTube import"
        promise="Add a lecture video or YouTube source and Sanad will turn it into searchable study material."
        detail="Uploading a video file already works. Importing from a URL needs reliable audio extraction and a licence position, which is real work rather than a demo trick."
      />
      <ComingSoon
        title="Full translation"
        promise="Read any lecture in Arabic, English or Chinese."
        detail="Transcripts already carry a language per segment. Translating them without breaking the link between a sentence and its timestamp needs a model Sanad does not yet run for free."
      />
      <ComingSoon
        title="Sanad Community"
        promise="Ask, discuss, and learn with your university community."
        detail="A social layer needs moderation and a privacy review before it touches student work."
      >
        <Link href="/community" className="soon-link">
          See the preview →
        </Link>
      </ComingSoon>
    </div>
  );
}
