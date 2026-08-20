import { unzipSync } from 'fflate';
import { ExtractionError, detectLanguage, type ExtractedUnit, type Extractor } from './extract';

/**
 * DOCX and PPTX extraction.
 *
 * Both are ZIP archives of XML, so this reads them directly rather than
 * shelling out to a converter — no external binary, no service, no cost.
 *
 * The reason this is worth doing at all is the anchor. A slide deck extracted
 * as one blob of text produces citations that say "the slides"; extracted per
 * slide it produces "slide 7", which a student can actually turn to. PPTX gives
 * that for free, because a slide is a separate file inside the archive.
 *
 * DOCX has no reliable page structure — pagination happens at render time, not
 * in the XML — so it anchors by character offset, exactly as plain text does.
 * Claiming page numbers there would mean inventing them.
 */

const OOXML_MAGIC = [0x50, 0x4b]; // "PK"

function openArchive(data: Buffer, kind: string): Record<string, Uint8Array> {
  if (data.length < 4 || data[0] !== OOXML_MAGIC[0] || data[1] !== OOXML_MAGIC[1]) {
    throw new ExtractionError(
      `${kind} is not a zip container`,
      `This does not look like a ${kind} file. If it was renamed from an older .doc or .ppt, re-save it in the newer format.`,
    );
  }
  try {
    return unzipSync(new Uint8Array(data));
  } catch (error) {
    throw new ExtractionError(
      `${kind} archive could not be read: ${String(error)}`,
      `This ${kind} file could not be opened. If it is password-protected, remove the password and upload it again.`,
    );
  }
}

const DECODER = new TextDecoder('utf-8');

/**
 * Text from OOXML markup.
 *
 * `<w:t>` and `<a:t>` hold the runs. Paragraph and line breaks become spaces so
 * words either side of a break do not fuse into one token that search can never
 * match. Everything else is markup and is dropped.
 */
function textFromXml(xml: string): string {
  return xml
    .replace(/<(?:w|a):br\b[^>]*\/?>/g, ' ')
    .replace(/<\/(?:w:p|a:p)>/g, ' ')
    .replace(/<(?:w|a):t(?:\s[^>]*)?>([\s\S]*?)<\/(?:w|a):t>/g, (_, run: string) => `${run} `)
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Paragraph-level text, so a document splits into units rather than one blob. */
function paragraphsFromXml(xml: string): string[] {
  const paragraphs = xml.match(/<w:p\b[\s\S]*?<\/w:p>/g) ?? [];
  return paragraphs.map(textFromXml).filter((text) => text.length > 0);
}

export const docxExtractor: Extractor = {
  name: 'docx',

  supports(mimeType: string, filename: string): boolean {
    return (
      mimeType ===
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      /\.docx$/i.test(filename)
    );
  },

  async extract(data: Buffer) {
    const files = openArchive(data, 'DOCX');
    const document = files['word/document.xml'];
    if (!document) {
      throw new ExtractionError(
        'DOCX has no word/document.xml',
        'This Word file has no readable document body. Try re-saving it as .docx.',
      );
    }

    const paragraphs = paragraphsFromXml(DECODER.decode(document));
    if (paragraphs.length === 0) {
      throw new ExtractionError(
        'DOCX contains no text',
        'This document has no selectable text. If the content is images of text, OCR is not available yet.',
      );
    }

    // Character offsets are the anchor. They are computed over the same joined
    // text the units are cut from, so a citation's range always addresses the
    // text it was taken from.
    const units: ExtractedUnit[] = [];
    let cursor = 0;
    let seq = 0;
    for (const paragraph of paragraphs) {
      units.push({
        seq: seq++,
        text: paragraph,
        charStart: cursor,
        charEnd: cursor + paragraph.length,
        language: detectLanguage(paragraph),
      });
      cursor += paragraph.length + 1;
    }

    return { extractor: 'docx', units, pageCount: null };
  },
};

/** `ppt/slides/slide12.xml` → 12. Ordering by filename would put 10 before 2. */
function slideNumber(path: string): number | null {
  const match = path.match(/^ppt\/slides\/slide(\d+)\.xml$/);
  return match ? Number(match[1]) : null;
}

export const pptxExtractor: Extractor = {
  name: 'pptx',

  supports(mimeType: string, filename: string): boolean {
    return (
      mimeType ===
        'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
      /\.pptx$/i.test(filename)
    );
  },

  async extract(data: Buffer) {
    const files = openArchive(data, 'PPTX');

    const slides = Object.keys(files)
      .map((path) => ({ path, number: slideNumber(path) }))
      .filter((entry): entry is { path: string; number: number } => entry.number !== null)
      .sort((a, b) => a.number - b.number);

    if (slides.length === 0) {
      throw new ExtractionError(
        'PPTX has no slides',
        'This presentation has no readable slides. Try re-saving it as .pptx.',
      );
    }

    const units: ExtractedUnit[] = [];
    let seq = 0;
    for (const slide of slides) {
      const text = textFromXml(DECODER.decode(files[slide.path]!));
      // An empty slide is skipped rather than stored: a chunk with no text
      // cannot be retrieved and would only pad the count.
      if (text.length === 0) continue;
      units.push({
        seq: seq++,
        text,
        slideNo: slide.number,
        language: detectLanguage(text),
      });
    }

    if (units.length === 0) {
      throw new ExtractionError(
        'PPTX slides contain no text',
        'These slides have no selectable text — they look like images. OCR is not available yet.',
      );
    }

    return { extractor: 'pptx', units, pageCount: slides.length };
  },
};
