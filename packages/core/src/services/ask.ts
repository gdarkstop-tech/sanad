import { and, asc, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import {
  citations,
  courseOfferings,
  courses,
  qaMessages,
  type Database,
} from '@sanad/db';
import { Errors } from '../errors';
import type { Subject } from '../permissions';
import {
  citationLabel,
  deepLinkFor,
  formatTimestamp,
  retrieve,
  type RetrievedChunk,
} from './retrieval';

/**
 * Grounded question answering (AI_PIPELINE.md §6).
 *
 *   question → retrieve → GATE → compose → validate citations → render
 *
 * Never "ask a model and show what comes back". Two independent gates sit in
 * application code, and both are enforced here rather than requested in a
 * prompt.
 */

/**
 * Below this fused score, the question is treated as unsupported by the
 * student's materials and no generator runs at all.
 */
export const RETRIEVAL_THRESHOLD = Number(process.env.RETRIEVAL_THRESHOLD ?? 0.35);

export interface Citation {
  chunkId: string;
  label: string;
  quote: string;
  deepLink: string | null;
  sourceType: string;
  lectureId: string | null;
  materialId: string | null;
  tStartMs: number | null;
  pageNo: number | null;
  slideNo: number | null;
}

export interface Answer {
  answer: string;
  refused: boolean;
  refusalReason: string | null;
  citations: Citation[];
  topScore: number;
  generator: string;
  mode: 'hybrid' | 'lexical';
  latencyMs: number;
  /** The stored row, so the student can bookmark this exact answer. */
  messageId?: string | null;
}

export const REFUSAL_TEXT =
  "I couldn't find enough evidence for this in your course materials.";

/**
 * Answer generation.
 *
 * `AnswerComposer` exists so a local LLM can improve phrasing later without
 * touching retrieval, gating, citation validation, or the API. The default
 * composer is extractive and needs no model at all — which is what makes the
 * whole product work at $0 (§16 of the brief).
 */
export interface AnswerComposer {
  readonly name: string;
  compose(question: string, chunks: RetrievedChunk[]): Promise<string>;
}

/**
 * Extractive composer.
 *
 * Selects the sentences that actually carry the query terms and presents them
 * as quoted evidence. It does not paraphrase, so it cannot introduce a claim
 * the sources do not make — the failure mode this product exists to avoid.
 * Deliberately labelled as evidence rather than dressed up as generated prose.
 */
export class ExtractiveComposer implements AnswerComposer {
  readonly name = 'extractive';

  async compose(question: string, chunks: RetrievedChunk[]): Promise<string> {
    const terms = tokenize(question);
    const lines: string[] = [];

    for (const chunk of chunks.slice(0, 3)) {
      const sentence = bestSentence(chunk.text, terms);
      if (!sentence) continue;
      lines.push(`“${sentence}” — ${citationLabel(chunk)}`);
    }

    if (lines.length === 0) {
      const first = chunks[0];
      if (!first) return REFUSAL_TEXT;
      lines.push(`“${first.text.slice(0, 300).trim()}” — ${citationLabel(first)}`);
    }

    return [
      'From your course materials:',
      '',
      ...lines.map((line) => `• ${line}`),
    ].join('\n');
  }
}

let composer: AnswerComposer = new ExtractiveComposer();

export function setAnswerComposer(next: AnswerComposer): void {
  composer = next;
}

export function currentComposer(): AnswerComposer {
  return composer;
}

export async function ask(
  db: Database,
  subject: Subject,
  question: string,
  options: { offeringId?: string } = {},
): Promise<Answer> {
  const started = Date.now();
  const retrieval = await retrieve(db, subject, question, {
    ...(options.offeringId ? { offeringId: options.offeringId } : {}),
    limit: 8,
  });

  const base = {
    topScore: retrieval.topScore,
    mode: retrieval.mode,
  };

  // GATE 1 — insufficient evidence. The generator is never invoked, so there
  // is no partial answer to leak and no cost incurred.
  if (retrieval.chunks.length === 0 || retrieval.topScore < RETRIEVAL_THRESHOLD) {
    const answer: Answer = {
      ...base,
      answer: REFUSAL_TEXT,
      refused: true,
      refusalReason: 'below_threshold',
      citations: [],
      generator: 'none',
      latencyMs: Date.now() - started,
    };
    answer.messageId = await persist(db, subject, question, options.offeringId, answer, retrieval.chunks);
    return answer;
  }

  const text = await composer.compose(question, retrieval.chunks);

  // GATE 2 — citation validation. Only chunks that came back from *this*
  // retrieval may be cited; anything else is dropped. A composer cannot invent
  // a citation that survives this step.
  const retrievedIds = new Set(retrieval.chunks.map((chunk) => chunk.chunkId));
  const validated = retrieval.chunks
    .filter((chunk) => retrievedIds.has(chunk.chunkId))
    .slice(0, 5)
    .map(toCitation);

  if (validated.length === 0) {
    const answer: Answer = {
      ...base,
      answer: REFUSAL_TEXT,
      refused: true,
      refusalReason: 'no_valid_citations',
      citations: [],
      generator: composer.name,
      latencyMs: Date.now() - started,
    };
    answer.messageId = await persist(db, subject, question, options.offeringId, answer, retrieval.chunks);
    return answer;
  }

  const answer: Answer = {
    ...base,
    answer: text,
    refused: false,
    refusalReason: null,
    citations: validated,
    generator: composer.name,
    latencyMs: Date.now() - started,
  };
  answer.messageId = await persist(db, subject, question, options.offeringId, answer, retrieval.chunks);
  return answer;
}

function toCitation(chunk: RetrievedChunk): Citation {
  return {
    chunkId: chunk.chunkId,
    label: citationLabel(chunk),
    // Anchors are resolved from the row, never from generated text, so a
    // timestamp is always the row's timestamp.
    quote: chunk.snippet,
    deepLink: deepLinkFor(chunk),
    sourceType: chunk.sourceType,
    lectureId: chunk.lectureId,
    materialId: chunk.materialId,
    tStartMs: chunk.tStartMs,
    pageNo: chunk.pageNo,
    slideNo: chunk.slideNo,
  };
}

async function persist(
  db: Database,
  subject: Subject,
  question: string,
  offeringId: string | undefined,
  answer: Answer,
  retrieved: RetrievedChunk[],
): Promise<string | null> {
  const [message] = await db
    .insert(qaMessages)
    .values({
      userId: subject.userId,
      offeringId: offeringId ?? null,
      question,
      answer: answer.answer,
      refused: answer.refused,
      refusalReason: answer.refusalReason,
      topScore: answer.topScore,
      // Storing the retrieved set makes every displayed citation auditable
      // after the fact against exactly what retrieval returned.
      retrievedChunkIds: retrieved.map((chunk) => chunk.chunkId),
      generator: answer.generator,
      latencyMs: answer.latencyMs,
    })
    .returning({ id: qaMessages.id });

  if (!message) return null;
  if (answer.citations.length === 0) return message.id;

  await db.insert(citations).values(
    answer.citations.map((citation, index) => ({
      targetType: 'qa_message',
      targetId: message.id,
      chunkId: citation.chunkId,
      quote: citation.quote,
      anchor: {
        label: citation.label,
        lectureId: citation.lectureId,
        materialId: citation.materialId,
        tStartMs: citation.tStartMs,
        pageNo: citation.pageNo,
        slideNo: citation.slideNo,
        formatted: citation.tStartMs !== null ? formatTimestamp(citation.tStartMs) : null,
      },
      rank: index,
      validated: true,
    })),
  );

  return message.id;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 2);
}

/** Picks the sentence carrying the most query terms. */
function bestSentence(text: string, terms: string[]): string | null {
  const sentences = text
    .split(/(?<=[.!?؟])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20);
  if (sentences.length === 0) return text.trim().slice(0, 300) || null;

  let best = sentences[0]!;
  let bestScore = -1;
  for (const sentence of sentences) {
    const lower = sentence.toLowerCase();
    const score = terms.reduce((sum, term) => sum + (lower.includes(term) ? 1 : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      best = sentence;
    }
  }
  return best.slice(0, 320);
}

/**
 * How well the retrieved evidence supports an answer.
 *
 * Deliberately a word, not a percentage. A number like "87% confident" implies
 * a calibrated probability, and nothing here measures one — the score is a
 * fused rank, not a likelihood that the answer is correct. Publishing a number
 * with no defined meaning is the same class of mistake as inventing a citation.
 *
 * Both inputs are real: `topScore` is the fused retrieval score the threshold
 * is applied to, and `sourceCount` is how many distinct sources survived
 * citation validation. Independent corroboration is what "multiple sources"
 * means here, so it is counted, not guessed.
 */
export type EvidenceStrength = 'strong' | 'multiple' | 'limited' | 'insufficient';

export interface EvidenceAssessment {
  strength: EvidenceStrength;
  label: string;
  /** Plain-language reason, shown next to the label. */
  detail: string;
  sourceCount: number;
}

/** Above this, the top match is a close one rather than a scrape past the gate. */
export const STRONG_EVIDENCE_SCORE = 0.75;

export function assessEvidence(input: {
  refused: boolean;
  topScore: number;
  sourceCount: number;
}): EvidenceAssessment {
  const { refused, topScore, sourceCount } = input;

  if (refused || sourceCount === 0) {
    return {
      strength: 'insufficient',
      label: 'Insufficient evidence',
      detail: 'Your materials do not cover this, so Sanad did not answer.',
      sourceCount: 0,
    };
  }

  if (topScore >= STRONG_EVIDENCE_SCORE && sourceCount >= 2) {
    return {
      strength: 'strong',
      label: 'Strong source match',
      detail: `A close match, corroborated by ${sourceCount} sources.`,
      sourceCount,
    };
  }

  if (sourceCount >= 2) {
    return {
      strength: 'multiple',
      label: 'Multiple supporting sources',
      detail: `${sourceCount} sources support this, none of them an exact match.`,
      sourceCount,
    };
  }

  return {
    strength: 'limited',
    label: 'Limited evidence',
    detail: 'One source supports this. Worth checking it before relying on it.',
    sourceCount,
  };
}

export interface SavedAnswer {
  id: string;
  question: string;
  answer: string;
  offeringId: string | null;
  courseTitle: string | null;
  generator: string;
  savedAt: Date;
  askedAt: Date;
  citations: Array<{
    chunkId: string;
    label: string;
    quote: string | null;
    deepLink: string | null;
  }>;
}

/**
 * Bookmarks an answer the student wants to keep.
 *
 * Scoped to the caller inside the update itself, so a guessed id saves nothing
 * rather than saving somebody else's answer. Refusals cannot be saved: there is
 * nothing in one worth keeping, and a bookmarked "I don't know" would be a
 * confusing thing to find later.
 */
export async function setAnswerSaved(
  db: Database,
  subject: Subject,
  messageId: string,
  saved: boolean,
): Promise<{ id: string; savedAt: Date | null }> {
  const [existing] = await db
    .select({ id: qaMessages.id, refused: qaMessages.refused })
    .from(qaMessages)
    .where(and(eq(qaMessages.id, messageId), eq(qaMessages.userId, subject.userId)))
    .limit(1);
  if (!existing) throw Errors.notFound('Answer');
  if (saved && existing.refused) {
    throw Errors.validation('A refusal has nothing to save.');
  }

  const [updated] = await db
    .update(qaMessages)
    .set({ savedAt: saved ? new Date() : null })
    .where(and(eq(qaMessages.id, messageId), eq(qaMessages.userId, subject.userId)))
    .returning({ id: qaMessages.id, savedAt: qaMessages.savedAt });
  if (!updated) throw Errors.notFound('Answer');
  return updated;
}

/**
 * The student's saved answers, with the citations they were given.
 *
 * The citations come from the `citations` table rather than being recomputed,
 * so a saved answer shows the evidence it actually cited at the time — not
 * whatever retrieval would return today.
 */
export async function listSavedAnswers(
  db: Database,
  subject: Subject,
  limit = 50,
): Promise<SavedAnswer[]> {
  const rows = await db
    .select({ message: qaMessages, courseTitle: courses.title })
    .from(qaMessages)
    .leftJoin(courseOfferings, eq(courseOfferings.id, qaMessages.offeringId))
    .leftJoin(courses, eq(courses.id, courseOfferings.courseId))
    .where(and(eq(qaMessages.userId, subject.userId), isNotNull(qaMessages.savedAt)))
    .orderBy(desc(qaMessages.savedAt))
    .limit(Math.min(limit, 200));

  if (rows.length === 0) return [];

  const stored = await db
    .select()
    .from(citations)
    .where(
      and(
        eq(citations.targetType, 'qa_message'),
        inArray(
          citations.targetId,
          rows.map((row) => row.message.id),
        ),
      ),
    )
    .orderBy(asc(citations.rank));

  const byMessage = new Map<string, SavedAnswer['citations']>();
  for (const citation of stored) {
    const anchor = citation.anchor as {
      label?: string;
      lectureId?: string | null;
      materialId?: string | null;
      tStartMs?: number | null;
      pageNo?: number | null;
      slideNo?: number | null;
    };
    const list = byMessage.get(citation.targetId) ?? [];
    list.push({
      chunkId: citation.chunkId,
      label: anchor.label ?? 'Source',
      quote: citation.quote,
      deepLink: deepLinkFor({
        chunkId: citation.chunkId,
        lectureId: anchor.lectureId ?? null,
        materialId: anchor.materialId ?? null,
        tStartMs: anchor.tStartMs ?? null,
        pageNo: anchor.pageNo ?? null,
        slideNo: anchor.slideNo ?? null,
      } as Parameters<typeof deepLinkFor>[0]),
    });
    byMessage.set(citation.targetId, list);
  }

  return rows.map((row) => ({
    id: row.message.id,
    question: row.message.question,
    answer: row.message.answer,
    offeringId: row.message.offeringId,
    courseTitle: row.courseTitle,
    generator: row.message.generator,
    savedAt: row.message.savedAt!,
    askedAt: row.message.createdAt,
    citations: byMessage.get(row.message.id) ?? [],
  }));
}
