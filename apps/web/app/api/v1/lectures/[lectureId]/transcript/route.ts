import { eq } from 'drizzle-orm';
import { getLecture } from '@sanad/core';
import { db, lectureEmphasis, transcriptSegments } from '@sanad/db';
import { requireUser, subjectOf } from '@/lib/auth';
import { handler, json } from '@/lib/http';

export const GET = handler(async (request, { params }) => {
  const user = await requireUser();
  const { lectureId } = await params;
  const lecture = await getLecture(db(), subjectOf(user), lectureId as string);

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

  const raw = new URL(request.url).searchParams.get('raw') === '1';

  return json({
    lecture: { id: lecture.id, title: lecture.title, status: lecture.status },
    segments: segments.map((s) => ({
      id: s.id,
      seq: s.seq,
      tStartMs: s.tStartMs,
      tEndMs: s.tEndMs,
      // The raw view is always available: no pipeline stage may destroy the
      // original recognition.
      text: raw ? s.rawText : s.displayText,
      language: s.primaryLanguage,
      isCodeSwitched: s.isCodeSwitched,
      confidence: s.confidence,
      confidenceBand: s.confidenceBand,
    })),
    emphasis: emphasis.map((e) => ({
      id: e.id,
      tStartMs: e.tStartMs,
      quote: e.quote,
      importanceType: e.importanceType,
      confidence: e.confidence,
    })),
  });
});
