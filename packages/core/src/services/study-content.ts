import { and, desc, eq, inArray } from 'drizzle-orm';
import {
  contentChunks,
  flashcards,
  keywords,
  lectureEmphasis,
  questionOptions,
  questions,
  studyTopics,
  summaries,
  topicLinks,
  transcriptSegments,
  type Database,
} from '@sanad/db';
import { normalizeForSearch } from '../text';

/**
 * Study-content generation (§6 of the brief: the $0 requirement).
 *
 * Every generator here is deterministic and needs no model. That is not a
 * placeholder — it is what makes the product work at zero recurring cost, and
 * it has a property a language model does not: an extractive summary or a
 * cloze question **cannot state something the source does not say**.
 *
 * Each generator sits behind an interface so a local LLM can improve phrasing
 * later without touching storage, citations, or the API. Output is labelled
 * with its generator, so nothing is ever passed off as more than it is.
 */

export interface GeneratedItem {
  sourceChunkId: string;
}

export interface SummaryProvider {
  readonly name: string;
  summarize(chunks: ScoredChunk[], maxSentences: number): Promise<string>;
}

export interface FlashcardGenerator {
  readonly name: string;
  generate(chunks: ScoredChunk[], max: number): Promise<Array<{ front: string; back: string } & GeneratedItem>>;
}

export interface QuestionGenerator {
  readonly name: string;
  generate(
    chunks: ScoredChunk[],
    max: number,
  ): Promise<
    Array<
      {
        questionType: 'mcq' | 'short_answer' | 'written';
        stem: string;
        modelAnswer: string;
        options?: Array<{ text: string; isCorrect: boolean }>;
      } & GeneratedItem
    >
  >;
}

export interface ScoredChunk {
  id: string;
  text: string;
  weight: number;
  lectureId: string | null;
  emphasised: boolean;
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'are', 'was', 'were', 'has', 'have',
  'not', 'but', 'you', 'they', 'them', '其', 'we', 'our', 'its', 'it', 'is', 'of', 'to', 'in',
  'on', 'as', 'at', 'by', 'or', 'be', 'an', 'a',
  'من', 'في', 'على', 'الي', 'هذا', 'هذه', 'التي', 'الذي', 'ان', 'ده', 'دي', 'مع', 'عن', 'كل',
]);

function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[.!?؟])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 30);
}

function contentWords(text: string): string[] {
  return normalizeForSearch(text)
    .split(' ')
    .filter((word) => word.length >= 4 && !STOPWORDS.has(word));
}

/**
 * Sentences across a set of chunks, without repeats.
 *
 * Transcript chunks deliberately overlap by one segment so a definition
 * straddling a boundary is still retrievable. That overlap must not reach the
 * student: without this, the same sentence is summarized twice and turned into
 * two identical flashcards.
 */
function uniqueSentences(chunks: ScoredChunk[]): Array<{ chunk: ScoredChunk; sentence: string }> {
  const seen = new Set<string>();
  const out: Array<{ chunk: ScoredChunk; sentence: string }> = [];
  for (const chunk of chunks) {
    for (const sentence of sentencesOf(chunk.text)) {
      const key = normalizeForSearch(sentence);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push({ chunk, sentence });
    }
  }
  return out;
}

/**
 * Chooses the term a cloze card should blank.
 *
 * Not the rarest word. In speech the rarest word is usually filler — "today",
 * "okay", "anyway" — and blanking it produces a question that tests nothing.
 * A term the course keeps coming back to is the course's own vocabulary, so
 * recurrence is what is rewarded here, with length as the tiebreak because
 * technical terms are rarely short. Recurrence is capped so a word that
 * appears constantly cannot crowd out everything else.
 */
function keyTermOf(
  sentence: string,
  frequency: Map<string, number>,
  exclude: ReadonlySet<string> = new Set(),
): string | null {
  const score = (word: string): number =>
    Math.min(frequency.get(word) ?? 1, 4) * 2 + Math.min(word.length, 12);

  const words = contentWords(sentence).filter((word) => !exclude.has(word));
  if (words.length === 0) return null;
  return words.sort((a, b) => score(b) - score(a) || a.localeCompare(b))[0] ?? null;
}

/**
 * Extractive summarization: scores sentences by the course-relative frequency
 * of the content words they carry, then keeps the highest-scoring ones in their
 * original order so the summary still reads as a narrative.
 */
export class ExtractiveSummaryProvider implements SummaryProvider {
  readonly name = 'extractive';

  async summarize(chunks: ScoredChunk[], maxSentences = 6): Promise<string> {
    const frequency = new Map<string, number>();
    for (const chunk of chunks) {
      for (const word of contentWords(chunk.text)) {
        frequency.set(word, (frequency.get(word) ?? 0) + 1);
      }
    }

    const candidates: Array<{ sentence: string; score: number; order: number }> = [];
    let order = 0;
    for (const { chunk, sentence } of uniqueSentences(chunks)) {
      const words = contentWords(sentence);
      if (words.length === 0) continue;
      const score =
        (words.reduce((sum, word) => sum + (frequency.get(word) ?? 0), 0) / words.length) *
        chunk.weight;
      candidates.push({ sentence, score, order: order++ });
    }

    if (candidates.length === 0) return '';

    // Newline-separated, not space-joined. These are extracted sentences from
    // different moments in the material, and speech rarely carries terminal
    // punctuation — joining with a space would run them together into one
    // unreadable line, and adding a full stop would put punctuation in the
    // student's mouth that the source never had.
    return candidates
      .sort((a, b) => b.score - a.score)
      .slice(0, maxSentences)
      .sort((a, b) => a.order - b.order)
      .map((candidate) => candidate.sentence.trim())
      .join('\n');
  }
}

/**
 * Cloze flashcards: takes a sentence and blanks its most distinctive term.
 *
 * The card can only ever ask about words the source actually contains, which
 * is why this is safe to generate without review.
 */
export class ClozeFlashcardGenerator implements FlashcardGenerator {
  readonly name = 'cloze';

  async generate(chunks: ScoredChunk[], max = 12) {
    const frequency = new Map<string, number>();
    for (const chunk of chunks) {
      for (const word of contentWords(chunk.text)) {
        frequency.set(word, (frequency.get(word) ?? 0) + 1);
      }
    }

    const cards: Array<{ front: string; back: string; sourceChunkId: string }> = [];
    const used = new Set<string>();

    const ordered = [...chunks].sort((a, b) => b.weight - a.weight);
    for (const { chunk, sentence } of uniqueSentences(ordered)) {
      if (cards.length >= max) return cards;

      const candidate = keyTermOf(sentence, frequency, used);
      if (!candidate) continue;

      const pattern = new RegExp(`\\b${escapeRegex(candidate)}\\w*`, 'iu');
      const match = sentence.match(pattern);
      if (!match) continue;

      used.add(candidate);
      cards.push({
        front: sentence.replace(pattern, '_____'),
        back: match[0],
        sourceChunkId: chunk.id,
      });
    }
    return cards;
  }
}

/**
 * Deterministic question generation.
 *
 * MCQ distractors are drawn from *other chunks in the same course*, so they are
 * plausible and on-topic without being invented. A distractor from outside the
 * course would be trivially identifiable and would teach nothing.
 */
export class TemplateQuestionGenerator implements QuestionGenerator {
  readonly name = 'template';

  async generate(chunks: ScoredChunk[], max = 10) {
    const frequency = new Map<string, number>();
    for (const chunk of chunks) {
      for (const word of contentWords(chunk.text)) {
        frequency.set(word, (frequency.get(word) ?? 0) + 1);
      }
    }

    const pool = [...frequency.keys()];
    const generated: Array<{
      questionType: 'mcq' | 'short_answer' | 'written';
      stem: string;
      modelAnswer: string;
      options?: Array<{ text: string; isCorrect: boolean }>;
      sourceChunkId: string;
    }> = [];

    const ordered = [...chunks].sort((a, b) => b.weight - a.weight);

    // One question per chunk, from its first sentence — spreading questions
    // across the material rather than mining one passage. Overlapping chunks
    // are filtered first so the same sentence cannot be asked twice.
    const seenChunks = new Set<string>();
    for (const { chunk, sentence } of uniqueSentences(ordered)) {
      if (generated.length >= max) break;
      if (seenChunks.has(chunk.id)) continue;
      seenChunks.add(chunk.id);

      const key = keyTermOf(sentence, frequency);

      if (key && generated.length % 2 === 0) {
        const distractors = pool
          .filter((word) => word !== key && Math.abs(word.length - key.length) <= 4)
          .slice(0, 3);
        if (distractors.length === 3) {
          const options = [
            { text: key, isCorrect: true },
            ...distractors.map((text) => ({ text, isCorrect: false })),
          ];
          generated.push({
            questionType: 'mcq',
            stem: sentence.replace(new RegExp(`\\b${escapeRegex(key)}\\w*`, 'iu'), '_____'),
            modelAnswer: key,
            options,
            sourceChunkId: chunk.id,
          });
          continue;
        }
      }

      generated.push({
        questionType: chunk.emphasised ? 'written' : 'short_answer',
        stem: chunk.emphasised
          ? `The instructor flagged this as important. Explain it in your own words: “${sentence.slice(0, 160)}”`
          : `Explain what the material says here: “${sentence.slice(0, 160)}”`,
        modelAnswer: sentence,
        sourceChunkId: chunk.id,
      });
    }

    return generated;
  }
}

let summaryProvider: SummaryProvider = new ExtractiveSummaryProvider();
let flashcardGenerator: FlashcardGenerator = new ClozeFlashcardGenerator();
let questionGenerator: QuestionGenerator = new TemplateQuestionGenerator();

export function setStudyGenerators(next: {
  summary?: SummaryProvider;
  flashcards?: FlashcardGenerator;
  questions?: QuestionGenerator;
}): void {
  if (next.summary) summaryProvider = next.summary;
  if (next.flashcards) flashcardGenerator = next.flashcards;
  if (next.questions) questionGenerator = next.questions;
}

/**
 * Loads chunks for a scope and weights them.
 *
 * Instructor-flagged content is weighted up, which is what makes Exam Mode
 * prioritise what the professor actually said would matter.
 */
export async function loadScoredChunks(
  db: Database,
  scope: { offeringId: string; lectureId?: string },
  emphasisWeight = 2.5,
): Promise<ScoredChunk[]> {
  const filters = [eq(contentChunks.offeringId, scope.offeringId)];
  if (scope.lectureId) filters.push(eq(contentChunks.lectureId, scope.lectureId));

  const rows = await db
    .select({
      id: contentChunks.id,
      text: contentChunks.text,
      lectureId: contentChunks.lectureId,
      tStartMs: contentChunks.tStartMs,
      tEndMs: contentChunks.tEndMs,
    })
    .from(contentChunks)
    .where(and(...filters));

  const lectureIds = [...new Set(rows.map((r) => r.lectureId).filter((id): id is string => !!id))];
  const flags = lectureIds.length
    ? await db
        .select()
        .from(lectureEmphasis)
        .where(inArray(lectureEmphasis.lectureId, lectureIds))
    : [];

  return rows.map((row) => {
    // A chunk is emphasised when a flagged moment falls inside its time span.
    const emphasised = flags.some(
      (flag) =>
        flag.lectureId === row.lectureId &&
        row.tStartMs !== null &&
        row.tEndMs !== null &&
        flag.tStartMs >= row.tStartMs &&
        flag.tStartMs <= row.tEndMs,
    );
    return {
      id: row.id,
      text: row.text,
      lectureId: row.lectureId,
      emphasised,
      weight: emphasised ? emphasisWeight : 1,
    };
  });
}

export interface EnrichResult {
  summary: string;
  keywordCount: number;
  flashcardCount: number;
  questionCount: number;
  emphasisCount: number;
}

/**
 * Produces the archive entry's derived content: summary, keywords, topics,
 * flashcards and questions — all sourced, all regenerable.
 */
export async function enrichScope(
  db: Database,
  scope: { offeringId: string; lectureId?: string },
): Promise<EnrichResult> {
  const chunks = await loadScoredChunks(db, scope);
  if (chunks.length === 0) {
    return { summary: '', keywordCount: 0, flashcardCount: 0, questionCount: 0, emphasisCount: 0 };
  }

  const scopeType = scope.lectureId ? 'lecture' : 'offering';
  const scopeId = scope.lectureId ?? scope.offeringId;
  const chunkIds = chunks.map((chunk) => chunk.id);

  /*
   * Regeneration replaces, it does not accumulate.
   *
   * Enrichment runs per lecture after each recording and again per course when
   * Exam Mode opens, so without this the same sentence yields the same
   * flashcard twice. Clearing by source chunk is exact: it removes only what
   * this scope produced.
   */
  await db.delete(flashcards).where(inArray(flashcards.sourceChunkId, chunkIds));
  await db.delete(questions).where(inArray(questions.sourceChunkId, chunkIds));

  const summaryText = await summaryProvider.summarize(chunks, 6);
  if (summaryText) {
    await db
      .update(summaries)
      .set({ isCurrent: false })
      .where(and(eq(summaries.scopeType, scopeType), eq(summaries.scopeId, scopeId)));
    await db.insert(summaries).values({
      scopeType,
      scopeId,
      offeringId: scope.offeringId,
      content: summaryText,
      generator: summaryProvider.name,
    });
  }

  // Keywords: content words that recur across the scope.
  const frequency = new Map<string, number>();
  for (const chunk of chunks) {
    for (const word of new Set(contentWords(chunk.text))) {
      frequency.set(word, (frequency.get(word) ?? 0) + chunk.weight);
    }
  }
  const topTerms = [...frequency.entries()]
    .filter(([term, count]) => count > 1 && term.length >= 4)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);

  await db.delete(keywords).where(
    scope.lectureId
      ? eq(keywords.lectureId, scope.lectureId)
      : eq(keywords.offeringId, scope.offeringId),
  );
  if (topTerms.length > 0) {
    await db.insert(keywords).values(
      topTerms.map(([term, weight]) => ({
        offeringId: scope.offeringId,
        lectureId: scope.lectureId ?? null,
        term,
        weight,
      })),
    );
  }

  // Topics are derived from the course's own vocabulary — never enumerated.
  for (const [term, weight] of topTerms.slice(0, 8)) {
    const slug = term.replace(/[^a-z0-9؀-ۿ]+/gi, '-').slice(0, 60);
    if (!slug) continue;
    const [topic] = await db
      .insert(studyTopics)
      .values({ offeringId: scope.offeringId, name: term, slug, weight })
      .onConflictDoNothing()
      .returning({ id: studyTopics.id });

    const topicId =
      topic?.id ??
      (
        await db
          .select({ id: studyTopics.id })
          .from(studyTopics)
          .where(and(eq(studyTopics.offeringId, scope.offeringId), eq(studyTopics.slug, slug)))
          .limit(1)
      )[0]?.id;
    if (!topicId) continue;

    const related = chunks.filter((chunk) => normalizeForSearch(chunk.text).includes(term));
    if (related.length > 0) {
      await db
        .insert(topicLinks)
        .values(related.map((chunk) => ({ topicId, chunkId: chunk.id, relevance: 1 })))
        .onConflictDoNothing();
    }
  }

  const topicRows = await db
    .select()
    .from(studyTopics)
    .where(eq(studyTopics.offeringId, scope.offeringId));
  const topicFor = (text: string) =>
    topicRows.find((topic) => normalizeForSearch(text).includes(topic.name))?.id ?? null;

  const cards = await flashcardGenerator.generate(chunks, 12);
  if (cards.length > 0) {
    await db.insert(flashcards).values(
      cards.map((card) => ({
        offeringId: scope.offeringId,
        topicId: topicFor(card.front),
        front: card.front,
        back: card.back,
        // NOT NULL in the schema: an item that cannot name its source cannot
        // be stored.
        sourceChunkId: card.sourceChunkId,
        generator: flashcardGenerator.name,
      })),
    );
  }

  const generatedQuestions = await questionGenerator.generate(chunks, 10);
  for (const question of generatedQuestions) {
    const [row] = await db
      .insert(questions)
      .values({
        offeringId: scope.offeringId,
        topicId: topicFor(question.stem),
        questionType: question.questionType,
        stem: question.stem,
        modelAnswer: question.modelAnswer,
        sourceChunkId: question.sourceChunkId,
        generator: questionGenerator.name,
      })
      .returning({ id: questions.id });
    if (row && question.options?.length) {
      await db.insert(questionOptions).values(
        question.options.map((option, index) => ({
          questionId: row.id,
          seq: index,
          text: option.text,
          isCorrect: option.isCorrect,
        })),
      );
    }
  }

  return {
    summary: summaryText,
    keywordCount: topTerms.length,
    flashcardCount: cards.length,
    questionCount: generatedQuestions.length,
    emphasisCount: chunks.filter((chunk) => chunk.emphasised).length,
  };
}

export async function currentSummary(
  db: Database,
  scopeType: 'lecture' | 'offering',
  scopeId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ content: summaries.content })
    .from(summaries)
    .where(
      and(
        eq(summaries.scopeType, scopeType),
        eq(summaries.scopeId, scopeId),
        eq(summaries.isCurrent, true),
      ),
    )
    .orderBy(desc(summaries.generatedAt))
    .limit(1);
  return row?.content ?? null;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export { transcriptSegments };
