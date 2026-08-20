export interface TranscriptionSource {
  provider: string;
  model: string | null;
  isSynthetic: boolean;
}

/**
 * Says how a transcript was produced, when that matters.
 *
 * On a machine without whisper.cpp the pipeline falls back to a fixture
 * provider that *synthesizes* plausible lecture sentences from the audio's
 * hash. That is deliberate — it lets the whole pipeline be developed and
 * demonstrated without an engine installed — but on screen it is
 * indistinguishable from a real transcript, and a student must never mistake
 * placeholder text for what their professor said.
 *
 * Renders nothing when real recognition produced the transcript: a banner on
 * every lecture would train people to ignore it.
 */
export function TranscriptSourceNote({
  source,
  compact = false,
}: {
  source: TranscriptionSource | null | undefined;
  compact?: boolean;
}) {
  if (!source?.isSynthetic) return null;

  if (compact) {
    return (
      <span className="pill pill-synthetic" title="Placeholder text, not speech recognition">
        demo transcript
      </span>
    );
  }

  return (
    <p className="synthetic-note" role="status">
      <strong>This is a demo transcript, not speech recognition.</strong> No engine is
      installed on this machine, so Sanad generated placeholder sentences instead of
      transcribing the audio. The recording itself is stored untouched. Everything derived
      from this lecture — search results, answers, flashcards — comes from the placeholder
      text, not from what was actually said.
    </p>
  );
}

/**
 * A one-line warning for anything *derived* from a placeholder transcript.
 *
 * Search results, answers, flashcards and summaries are all built from the
 * transcript. If that transcript is synthetic, so is everything downstream, and
 * a citation pointing at a timestamp in placeholder text is more misleading
 * than the placeholder itself — it looks like evidence.
 *
 * Takes the answer from the course's own lectures rather than a global flag: a
 * course whose material is all PDFs has real content even on a machine with no
 * speech engine, and warning there would be false.
 */
export function DerivedFromDemoNote({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <p className="muted derived-note" role="status">
      Some of this course’s lectures have <strong>demo transcripts</strong> rather than real
      speech recognition, so results drawn from them are placeholder content. Documents
      (PDF, DOCX, PPTX, text) are read for real.
    </p>
  );
}
