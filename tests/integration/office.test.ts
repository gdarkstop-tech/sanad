import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  ExtractionError,
  HashEmbeddingProvider,
  LocalDiskStorage,
  createCourse,
  docxExtractor,
  extractorFor,
  pptxExtractor,
  runPending,
  setEmbeddingProvider,
  setStorage,
  uploadDirect,
  type Subject,
} from '@sanad/core';
import { contentChunks, materialChunks, materials } from '@sanad/db';
import { makeDocx, makePptx } from '../fixtures/make-office';
import { createTestStudent, openTestDatabase, resetDatabase } from '../helpers';

/**
 * DOCX and PPTX ingestion.
 *
 * The point of supporting them is the anchor, not the text: a slide deck is
 * only worth ingesting if a citation can say "slide 7". These tests are
 * therefore as much about where the content lands as about whether it parses.
 */

const { db, close } = openTestDatabase();

afterAll(async () => {
  await close();
});

beforeEach(async () => {
  await resetDatabase();
  setStorage(new LocalDiskStorage(await fs.mkdtemp(path.join(os.tmpdir(), 'sanad-office-'))));
  setEmbeddingProvider(new HashEmbeddingProvider());
});

/**
 * Asserts on the message the *student* sees.
 *
 * `Error.message` is the internal one; `userMessage` is what the UI renders,
 * so that is the field a test about actionable failures has to check.
 */
async function userMessageOf(action: () => Promise<unknown>): Promise<string> {
  try {
    await action();
  } catch (error) {
    expect(error).toBeInstanceOf(ExtractionError);
    return (error as ExtractionError).userMessage;
  }
  throw new Error('Expected extraction to fail, but it succeeded.');
}

async function student(): Promise<Subject> {
  const { user } = await createTestStudent(db);
  return { userId: user.id, role: user.role };
}

describe('choosing an extractor', () => {
  it('routes Office files by MIME type and by extension', () => {
    expect(
      extractorFor(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'notes.docx',
      )?.name,
    ).toBe('docx');
    expect(extractorFor('application/octet-stream', 'notes.docx')?.name).toBe('docx');
    expect(
      extractorFor(
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'week3.pptx',
      )?.name,
    ).toBe('pptx');
    expect(extractorFor('application/octet-stream', 'week3.pptx')?.name).toBe('pptx');
  });

  it('still routes PDFs and text to their own extractors', () => {
    // The regression that matters: adding formats must not steal existing ones.
    expect(extractorFor('application/pdf', 'slides.pdf')?.name).toBe('unpdf');
    expect(extractorFor('text/plain', 'notes.txt')?.name).toBe('text');
  });
});

describe('DOCX extraction', () => {
  it('extracts paragraphs with character anchors', async () => {
    const result = await docxExtractor.extract(
      makeDocx([
        'Sampling theory requires a rate above twice the highest frequency.',
        'Aliasing appears when that condition is violated.',
      ]),
    );

    expect(result.extractor).toBe('docx');
    expect(result.units).toHaveLength(2);
    expect(result.units[0]?.text).toContain('Sampling theory');
    expect(result.units[1]?.text).toContain('Aliasing');

    // Every unit is anchored, because an unanchored chunk cannot be stored.
    for (const unit of result.units) {
      expect(unit.charStart).not.toBeNull();
      expect(unit.charEnd).toBeGreaterThan(unit.charStart as number);
    }
    // Offsets advance rather than repeating.
    expect(result.units[1]!.charStart).toBeGreaterThan(result.units[0]!.charStart as number);
  });

  it('does not claim page numbers it cannot know', async () => {
    // Pagination happens at render time and is not in the XML. Reporting a page
    // here would mean inventing a citation the document does not support.
    const result = await docxExtractor.extract(makeDocx(['One paragraph of body text here.']));
    expect(result.pageCount).toBeNull();
    expect(result.units[0]?.pageNo ?? null).toBeNull();
  });

  it('decodes XML entities rather than leaking markup', async () => {
    const result = await docxExtractor.extract(
      makeDocx(['Voltage & current: V < 5 and I > 2 in the "safe" region.']),
    );
    const text = result.units[0]?.text ?? '';
    expect(text).toContain('Voltage & current');
    expect(text).toContain('V < 5');
    expect(text).toContain('"safe"');
    expect(text).not.toContain('&amp;');
    expect(text).not.toContain('<w:');
  });

  it('detects the language of each paragraph', async () => {
    const result = await docxExtractor.extract(
      makeDocx([
        'This paragraph is written entirely in English for the test.',
        'هذه الفقرة مكتوبة بالكامل باللغة العربية من أجل الاختبار.',
      ]),
    );
    expect(result.units[0]?.language).toBe('en');
    expect(result.units[1]?.language).toBe('ar');
  });

  it('rejects a renamed legacy .doc with a message that says what to do', async () => {
    // A .doc is an OLE compound file, not a zip. Failing loudly beats storing
    // a material whose "text" is binary noise.
    const legacy = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00, 0x00]);
    const message = await userMessageOf(() => docxExtractor.extract(legacy));
    expect(message).toMatch(/older \.doc or \.ppt/i);
  });

  it('reports a document with no readable body', async () => {
    const message = await userMessageOf(() => docxExtractor.extract(makeDocx([])));
    expect(message).toMatch(/no selectable text/i);
  });
});

describe('PPTX extraction', () => {
  it('anchors every unit to its slide number', async () => {
    const result = await pptxExtractor.extract(
      makePptx([
        ['Course overview', 'What we will cover this term'],
        ['Combinational logic', 'Truth tables and minimisation'],
        ['Sequential logic', 'Flip-flops and state machines'],
      ]),
    );

    expect(result.extractor).toBe('pptx');
    expect(result.units.map((unit) => unit.slideNo)).toEqual([1, 2, 3]);
    expect(result.units[1]?.text).toContain('Combinational logic');
    expect(result.pageCount).toBe(3);
  });

  it('orders slide 10 after slide 9, not after slide 1', async () => {
    // `slide10.xml` sorts before `slide2.xml` as a string. Getting this wrong
    // would mean citations pointing at the wrong slide.
    const slides = Array.from({ length: 12 }, (_, index) => [`Slide number ${index + 1} content`]);
    const result = await pptxExtractor.extract(makePptx(slides));

    expect(result.units.map((unit) => unit.slideNo)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
    expect(result.units[9]?.text).toContain('Slide number 10');
  });

  it('joins the shapes on a slide into one retrievable unit', async () => {
    const result = await pptxExtractor.extract(
      makePptx([['Karnaugh maps', 'Group adjacent ones', 'Read off the minimal expression']]),
    );
    expect(result.units).toHaveLength(1);
    expect(result.units[0]?.text).toContain('Karnaugh maps');
    expect(result.units[0]?.text).toContain('minimal expression');
  });

  it('skips an empty slide rather than storing a chunk nothing can retrieve', async () => {
    const result = await pptxExtractor.extract(
      makePptx([['Title slide with text'], [], ['Third slide with text']]),
    );
    expect(result.units.map((unit) => unit.slideNo)).toEqual([1, 3]);
  });

  it('reports an image-only deck instead of producing nothing quietly', async () => {
    const message = await userMessageOf(() => pptxExtractor.extract(makePptx([[], []])));
    expect(message).toMatch(/no selectable text/i);
    expect(message).toMatch(/OCR is not available yet/i);
  });
});

describe('an uploaded deck end to end', () => {
  it('becomes slide-anchored content chunks the student can cite', async () => {
    const owner = await student();
    const course = await createCourse(db, owner, {
      title: 'Any Subject',
      primaryLanguage: 'en',
      secondaryLanguages: [],
    });

    const { materialId } = await uploadDirect(db, owner, {
      clientRef: `pptx-${Date.now()}`,
      offeringId: course.id,
      filename: 'week-3.pptx',
      mimeType:
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      data: makePptx([
        ['Propagation delay is the time for an output to settle after an input change'],
        ['Setup time is how long data must be stable before the clock edge'],
      ]),
    });

    await runPending(db, { max: 30 });

    const [material] = await db.select().from(materials).where(eq(materials.id, materialId));
    expect(material?.processingStatus).toBe('ready');
    expect(material?.materialType).toBe('pptx');
    expect(material?.pageCount).toBe(2);

    const extracted = await db
      .select()
      .from(materialChunks)
      .where(eq(materialChunks.materialId, materialId));
    expect(extracted.length).toBeGreaterThan(0);
    for (const chunk of extracted) expect(chunk.slideNo).not.toBeNull();

    const chunks = await db
      .select()
      .from(contentChunks)
      .where(and(eq(contentChunks.materialId, materialId), eq(contentChunks.sourceType, 'material')));
    expect(chunks.length).toBeGreaterThan(0);
    // The anchor is the whole reason for supporting this format.
    for (const chunk of chunks) expect(chunk.slideNo).not.toBeNull();
  });

  it('turns a Word document into character-anchored chunks', async () => {
    const owner = await student();
    const course = await createCourse(db, owner, {
      title: 'Any Subject',
      primaryLanguage: 'en',
      secondaryLanguages: [],
    });

    const { materialId } = await uploadDirect(db, owner, {
      clientRef: `docx-${Date.now()}`,
      offeringId: course.id,
      filename: 'handout.docx',
      mimeType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      data: makeDocx([
        'A multiplexer selects one of several inputs using its select lines.',
        'A demultiplexer performs the inverse operation on a single input.',
      ]),
    });

    await runPending(db, { max: 30 });

    const [material] = await db.select().from(materials).where(eq(materials.id, materialId));
    expect(material?.processingStatus).toBe('ready');
    expect(material?.materialType).toBe('docx');

    const chunks = await db
      .select()
      .from(contentChunks)
      .where(eq(contentChunks.materialId, materialId));
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) expect(chunk.charStart).not.toBeNull();
  });
});
