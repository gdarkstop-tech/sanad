import { sql } from 'drizzle-orm';
import { courseEnrollments, courseOfferings, courses, type Database } from '@sanad/db';
import { embeddings, toVectorLiteral } from '../embeddings';
import type { Subject } from '../permissions';
import { normalizeForSearch } from '../text';

/**
 * Hybrid retrieval (AI_PIPELINE.md §6).
 *
 * Dense vectors alone are weak on exact technical tokens; lexical alone fails
 * across paraphrase and language. Both arms run and are fused with reciprocal
 * rank fusion, which needs no score calibration between them.
 *
 * The dense arm is optional: if the embedding model is unavailable the search
 * degrades to lexical-only and says so, rather than returning nothing.
 */

export interface RetrievedChunk {
  chunkId: string;
  score: number;
  sourceType: 'transcript' | 'material' | 'note';
  text: string;
  snippet: string;
  confidence: number | null;
  offeringId: string;
  courseTitle: string;
  lectureId: string | null;
  lectureTitle: string | null;
  materialId: string | null;
  materialTitle: string | null;
  tStartMs: number | null;
  tEndMs: number | null;
  pageNo: number | null;
  slideNo: number | null;
}

export interface RetrievalResult {
  chunks: RetrievedChunk[];
  topScore: number;
  mode: 'hybrid' | 'lexical';
}

const RRF_K = 60;
const CANDIDATES = 30;

/**
 * Cosine distance beyond which a dense hit is not evidence of anything.
 *
 * Vector search always returns its k nearest neighbours, however far away they
 * are — so without a floor, an out-of-scope question still produces confident
 * looking results. This floor, plus the term check below, is what makes
 * refusal meaningful rather than decorative.
 */
const MAX_DENSE_DISTANCE = Number(process.env.MAX_DENSE_DISTANCE ?? 0.75);

/** A dense hit this close counts as evidence even with no shared wording. */
const STRONG_DENSE_DISTANCE = Number(process.env.STRONG_DENSE_DISTANCE ?? 0.45);

/** Query terms shorter than this carry no topical signal. */
const DISTINCTIVE_TERM_LENGTH = 4;

/** RRF score when both arms rank a chunk first — used to normalize to 0..1. */
const MAX_FUSED = 2 / (RRF_K + 1);

/**
 * The permission boundary, expressed once.
 *
 * A student reaches only offerings they own or are enrolled in. Every retrieval
 * path goes through this, so no search or answer can surface another student's
 * material — §14 and §28 of the brief.
 */
function accessibleOfferings(subject: Subject, offeringId?: string) {
  const scope = offeringId
    ? sql`AND co.id = ${offeringId}`
    : sql``;
  return sql`
    SELECT co.id
    FROM ${courseOfferings} co
    JOIN ${courses} c ON c.id = co.course_id
    LEFT JOIN ${courseEnrollments} e
      ON e.offering_id = co.id AND e.user_id = ${subject.userId}
    WHERE c.deleted_at IS NULL
      AND (c.owner_user_id = ${subject.userId} OR e.user_id = ${subject.userId})
      ${scope}
  `;
}

export async function retrieve(
  db: Database,
  subject: Subject,
  query: string,
  options: { offeringId?: string; limit?: number } = {},
): Promise<RetrievalResult> {
  const limit = options.limit ?? 8;
  const normalized = normalizeForSearch(query);
  if (!normalized) return { chunks: [], topScore: 0, mode: 'lexical' };

  const provider = embeddings();
  let vector: number[] | null = null;
  if (await provider.isAvailable()) {
    const [embedded] = await provider.embed([query], 'query');
    vector = embedded ?? null;
  }

  const scope = accessibleOfferings(subject, options.offeringId);

  // Lexical arm: OR semantics over the normalized column, so a question phrased
  // as a sentence still matches on its content words. Index-time and query-time
  // normalization are literally the same function.
  const terms = normalized.split(' ').filter((term) => term.length >= 2);
  const tsquery = terms.join(' | ');
  const lexical = tsquery
    ? await db.execute<{ id: string; rank: number }>(sql`
        SELECT cc.id, ts_rank(to_tsvector('simple', cc.text_normalized),
                              to_tsquery('simple', ${tsquery})) AS rank
        FROM content_chunks cc
        WHERE cc.offering_id IN (${scope})
          AND to_tsvector('simple', cc.text_normalized) @@ to_tsquery('simple', ${tsquery})
        ORDER BY rank DESC
        LIMIT ${CANDIDATES}
      `)
    : [];

  const dense = vector
    ? await db.execute<{ id: string; distance: number }>(sql`
        SELECT cc.id, cc.embedding <=> ${toVectorLiteral(vector)}::vector AS distance
        FROM content_chunks cc
        WHERE cc.offering_id IN (${scope})
          AND cc.embedding IS NOT NULL
          AND cc.embedding <=> ${toVectorLiteral(vector)}::vector < ${MAX_DENSE_DISTANCE}
        ORDER BY distance ASC
        LIMIT ${CANDIDATES}
      `)
    : [];

  const denseDistance = new Map(dense.map((row) => [row.id, Number(row.distance)]));
  const distinctive = terms.filter((term) => term.length >= DISTINCTIVE_TERM_LENGTH);

  // Reciprocal rank fusion: rank-based, so the two arms' incomparable score
  // scales never have to be reconciled.
  const fused = new Map<string, number>();
  lexical.forEach((row, index) => {
    fused.set(row.id, (fused.get(row.id) ?? 0) + 1 / (RRF_K + index + 1));
  });
  dense.forEach((row, index) => {
    fused.set(row.id, (fused.get(row.id) ?? 0) + 1 / (RRF_K + index + 1));
  });

  if (fused.size === 0) {
    return { chunks: [], topScore: 0, mode: vector ? 'hybrid' : 'lexical' };
  }

  const ranked = [...fused.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
  const ids = ranked.map(([id]) => id);

  const rows = await db.execute<{
    id: string;
    source_type: 'transcript' | 'material' | 'note';
    text: string;
    confidence: number | null;
    offering_id: string;
    course_title: string;
    lecture_id: string | null;
    lecture_title: string | null;
    material_id: string | null;
    material_title: string | null;
    t_start_ms: number | null;
    t_end_ms: number | null;
    page_no: number | null;
    slide_no: number | null;
  }>(sql`
    SELECT cc.id, cc.source_type, cc.text, cc.confidence, cc.offering_id,
           c.title AS course_title,
           cc.lecture_id, l.title AS lecture_title,
           cc.material_id, m.title AS material_title,
           cc.t_start_ms, cc.t_end_ms, cc.page_no, cc.slide_no
    FROM content_chunks cc
    JOIN course_offerings co ON co.id = cc.offering_id
    JOIN courses c ON c.id = co.course_id
    LEFT JOIN lectures l ON l.id = cc.lecture_id
    LEFT JOIN materials m ON m.id = cc.material_id
    WHERE cc.id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
  `);

  const byId = new Map(rows.map((row) => [row.id, row]));
  const chunks: RetrievedChunk[] = [];

  for (const [id, score] of ranked) {
    const row = byId.get(id);
    if (!row) continue;

    /**
     * Evidence check. A chunk qualifies only if it shares a distinctive term
     * with the question, or is a strong dense match. Without this, the nearest
     * neighbour of an unrelated question would still be returned and cited —
     * which is exactly the hallucination this product refuses to do.
     */
    const haystack = row.text ? normalizeForSearch(row.text) : '';
    const sharesTerm = distinctive.some((term) => haystack.includes(term));
    const distance = denseDistance.get(id);
    const stronglySimilar = distance !== undefined && distance < STRONG_DENSE_DISTANCE;
    if (!sharesTerm && !stronglySimilar) continue;

    chunks.push({
      chunkId: row.id,
      // Normalized to 0..1 so the refusal threshold means something stable,
      // then down-weighted for low-confidence audio so shaky recognition does
      // not become a confident citation.
      score:
        (score / MAX_FUSED) * (row.confidence !== null && row.confidence < 0.6 ? 0.75 : 1),
      sourceType: row.source_type,
      text: row.text,
      snippet: snippetFor(row.text, normalized),
      confidence: row.confidence,
      offeringId: row.offering_id,
      courseTitle: row.course_title,
      lectureId: row.lecture_id,
      lectureTitle: row.lecture_title,
      materialId: row.material_id,
      materialTitle: row.material_title,
      tStartMs: row.t_start_ms,
      tEndMs: row.t_end_ms,
      pageNo: row.page_no,
      slideNo: row.slide_no,
    });
  }

  chunks.sort((a, b) => b.score - a.score);
  return {
    chunks,
    topScore: chunks[0]?.score ?? 0,
    mode: vector ? 'hybrid' : 'lexical',
  };
}

/** A window around the first matching term, so results are scannable. */
export function snippetFor(source: string, normalizedQuery: string, width = 220): string {
  // A snippet is always rendered on one line, so segment boundaries inside the
  // chunk are collapsed here rather than leaking into every caller.
  const text = source.replace(/\s+/g, ' ').trim();
  const terms = normalizedQuery.split(' ').filter((t) => t.length > 2);
  const haystack = normalizeForSearch(text);
  let index = -1;
  for (const term of terms) {
    index = haystack.indexOf(term);
    if (index !== -1) break;
  }
  if (index === -1) return text.slice(0, width).trim();

  const ratio = text.length / (haystack.length || 1);
  const approximate = Math.floor(index * ratio);
  const start = Math.max(0, approximate - Math.floor(width / 3));
  const prefix = start > 0 ? '…' : '';
  const suffix = start + width < text.length ? '…' : '';
  return prefix + text.slice(start, start + width).trim() + suffix;
}

/** Human-readable citation label: "Lecture 4 — 12:43" or "Slides — page 7". */
export function citationLabel(chunk: RetrievedChunk): string {
  if (chunk.sourceType === 'transcript' && chunk.tStartMs !== null) {
    return `${chunk.lectureTitle ?? 'Lecture'} — ${formatTimestamp(chunk.tStartMs)}`;
  }
  if (chunk.pageNo !== null) return `${chunk.materialTitle ?? 'Document'} — page ${chunk.pageNo}`;
  if (chunk.slideNo !== null) return `${chunk.materialTitle ?? 'Slides'} — slide ${chunk.slideNo}`;
  return chunk.materialTitle ?? chunk.lectureTitle ?? 'Course material';
}

export function formatTimestamp(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function deepLinkFor(chunk: RetrievedChunk): string | null {
  if (chunk.lectureId && chunk.tStartMs !== null) {
    return `/lectures/${chunk.lectureId}?t=${Math.floor(chunk.tStartMs / 1000)}`;
  }
  if (chunk.materialId) {
    // Slides carry their own anchor. Omitting it sent a "slide 3" citation to
    // the top of the deck, which is most of the way back to not citing at all.
    if (chunk.pageNo !== null) return `/materials/${chunk.materialId}?page=${chunk.pageNo}`;
    if (chunk.slideNo !== null) return `/materials/${chunk.materialId}?slide=${chunk.slideNo}`;
    return `/materials/${chunk.materialId}`;
  }
  return null;
}
