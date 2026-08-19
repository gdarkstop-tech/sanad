import { normalizeForSearch } from '../text';

/**
 * Extraction (AI_PIPELINE.md §5).
 *
 * One extractor per type behind a common interface, so a new format is added
 * without touching the pipeline. Every unit carries its citation anchor from
 * birth — there is no later step that "adds anchors", because a unit without
 * one cannot be stored (DATABASE.md §6).
 */

export interface ExtractedUnit {
  seq: number;
  text: string;
  pageNo?: number | null;
  slideNo?: number | null;
  charStart?: number | null;
  charEnd?: number | null;
  language?: string | null;
}

export interface ExtractionResult {
  extractor: string;
  units: ExtractedUnit[];
  pageCount?: number | null;
}

export interface Extractor {
  readonly name: string;
  supports(mimeType: string, filename: string): boolean;
  extract(data: Buffer): Promise<ExtractionResult>;
}

export class ExtractionError extends Error {
  constructor(
    message: string,
    /** Shown to the student, so it must say what to do next. */
    readonly userMessage: string,
  ) {
    super(message);
    this.name = 'ExtractionError';
  }
}

/** Detects the dominant script so chunks can be language-tagged. */
export function detectLanguage(text: string): string | null {
  const arabic = (text.match(/[؀-ۿ]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  if (arabic === 0 && latin === 0) return null;
  if (arabic > 0 && latin > 0) {
    const ratio = arabic / (arabic + latin);
    if (ratio > 0.8) return 'ar';
    if (ratio < 0.2) return 'en';
    return 'mixed';
  }
  return arabic > 0 ? 'ar' : 'en';
}

export const pdfExtractor: Extractor = {
  name: 'unpdf',
  supports: (mimeType, filename) =>
    mimeType === 'application/pdf' || filename.toLowerCase().endsWith('.pdf'),
  async extract(data: Buffer): Promise<ExtractionResult> {
    const { extractText, getDocumentProxy } = await import('unpdf');
    let pages: string[];
    let pageCount: number;

    try {
      const pdf = await getDocumentProxy(new Uint8Array(data));
      const result = await extractText(pdf, { mergePages: false });
      pages = Array.isArray(result.text) ? result.text : [String(result.text)];
      pageCount = result.totalPages ?? pages.length;
    } catch (error) {
      throw new ExtractionError(
        `PDF parse failed: ${String(error)}`,
        'This PDF could not be read. It may be corrupted or password-protected.',
      );
    }

    const units: ExtractedUnit[] = [];
    pages.forEach((pageText, index) => {
      const text = pageText.replace(/\s+/g, ' ').trim();
      if (!text) return;
      units.push({
        seq: units.length,
        text,
        pageNo: index + 1,
        language: detectLanguage(text),
      });
    });

    if (units.length === 0) {
      // A scanned PDF has pages but no text layer. Say which, because the
      // student's next action differs: re-export vs. wait for OCR support.
      throw new ExtractionError(
        'PDF has no text layer',
        'This PDF has no selectable text — it looks like a scan. OCR is not available yet, so try a text-based version.',
      );
    }

    return { extractor: 'unpdf', units, pageCount };
  },
};

export const textExtractor: Extractor = {
  name: 'text',
  supports: (mimeType, filename) =>
    mimeType.startsWith('text/') || /\.(txt|md)$/i.test(filename),
  async extract(data: Buffer): Promise<ExtractionResult> {
    const whole = data.toString('utf8');
    if (!whole.trim()) {
      throw new ExtractionError('Empty text file', 'This file contains no text.');
    }

    // Paragraph boundaries, with character offsets kept as the anchor.
    const units: ExtractedUnit[] = [];
    let cursor = 0;
    for (const block of whole.split(/\n{2,}/)) {
      const start = whole.indexOf(block, cursor);
      cursor = start + block.length;
      const text = block.replace(/\s+/g, ' ').trim();
      if (!text) continue;
      units.push({
        seq: units.length,
        text,
        charStart: start,
        charEnd: cursor,
        language: detectLanguage(text),
      });
    }

    return { extractor: 'text', units };
  },
};

const EXTRACTORS: Extractor[] = [pdfExtractor, textExtractor];

export function extractorFor(mimeType: string, filename: string): Extractor | null {
  return EXTRACTORS.find((e) => e.supports(mimeType, filename)) ?? null;
}

/**
 * Groups extracted units into retrieval-sized chunks.
 *
 * Overlap matters: a definition that straddles a boundary is a definition
 * retrieval cannot find. Page boundaries are never crossed, so a chunk always
 * has exactly one page anchor.
 */
export interface Chunk {
  seq: number;
  text: string;
  textNormalized: string;
  pageNo: number | null;
  slideNo: number | null;
  charStart: number | null;
  charEnd: number | null;
  language: string | null;
}

const TARGET_CHARS = 1200;
const OVERLAP_CHARS = 180;

export function chunkUnits(units: ExtractedUnit[]): Chunk[] {
  const chunks: Chunk[] = [];

  const byPage = new Map<string, ExtractedUnit[]>();
  for (const unit of units) {
    const key = `${unit.pageNo ?? ''}|${unit.slideNo ?? ''}`;
    const list = byPage.get(key) ?? [];
    list.push(unit);
    byPage.set(key, list);
  }

  for (const group of byPage.values()) {
    const first = group[0];
    if (!first) continue;

    let buffer = '';
    let charStart = first.charStart ?? null;

    const flush = (charEnd: number | null) => {
      const text = buffer.trim();
      if (!text) return;
      chunks.push({
        seq: chunks.length,
        text,
        textNormalized: normalizeForSearch(text),
        pageNo: first.pageNo ?? null,
        slideNo: first.slideNo ?? null,
        charStart,
        charEnd,
        language: detectLanguage(text),
      });
    };

    for (const unit of group) {
      const candidate = buffer ? `${buffer} ${unit.text}` : unit.text;
      if (candidate.length > TARGET_CHARS && buffer) {
        flush(unit.charStart ?? null);
        buffer = buffer.slice(-OVERLAP_CHARS) + ' ' + unit.text;
        charStart = unit.charStart ?? charStart;
      } else {
        buffer = candidate;
      }
    }
    flush(group[group.length - 1]?.charEnd ?? null);
  }

  return chunks.map((chunk, index) => ({ ...chunk, seq: index }));
}
