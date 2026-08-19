import { citationLabel, deepLinkFor, retrieve } from '@sanad/core';
import { db } from '@sanad/db';
import { requireUser, subjectOf } from '@/lib/auth';
import { handler, json } from '@/lib/http';

/**
 * Unified search. Scoped to courses the caller owns or is enrolled in — the
 * permission filter is inside the retrieval query itself, not bolted on after.
 */
export const GET = handler(async (request) => {
  const user = await requireUser();
  const url = new URL(request.url);
  const q = url.searchParams.get('q') ?? '';
  const courseId = url.searchParams.get('course_id') ?? undefined;
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 20), 50);

  if (!q.trim()) return json({ query: q, results: [], mode: 'lexical' });

  const result = await retrieve(db(), subjectOf(user), q, {
    ...(courseId ? { offeringId: courseId } : {}),
    limit,
  });

  return json({
    query: q,
    mode: result.mode,
    results: result.chunks.map((chunk) => ({
      chunkId: chunk.chunkId,
      score: Number(chunk.score.toFixed(5)),
      sourceType: chunk.sourceType,
      snippet: chunk.snippet,
      label: citationLabel(chunk),
      course: { id: chunk.offeringId, title: chunk.courseTitle },
      lecture: chunk.lectureId ? { id: chunk.lectureId, title: chunk.lectureTitle } : null,
      material: chunk.materialId ? { id: chunk.materialId, title: chunk.materialTitle } : null,
      anchor: {
        tStartMs: chunk.tStartMs,
        pageNo: chunk.pageNo,
        slideNo: chunk.slideNo,
      },
      deepLink: deepLinkFor(chunk),
    })),
  });
});
