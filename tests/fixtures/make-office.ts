import { zipSync, strToU8 } from 'fflate';

/**
 * Builds genuinely valid DOCX and PPTX files.
 *
 * Real archives with real OOXML inside, parsed by the real extractor. A mocked
 * zip would test the mock, and the parts most likely to surprise us — entry
 * naming, slide ordering, XML entity handling — only exist in a real file.
 */

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
</Types>`;

export function makeDocx(paragraphs: string[]): Buffer {
  const body = paragraphs
    .map((text) => `<w:p><w:r><w:t>${escapeXml(text)}</w:t></w:r></w:p>`)
    .join('');

  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${body}</w:body>
</w:document>`;

  return Buffer.from(
    zipSync({
      '[Content_Types].xml': strToU8(CONTENT_TYPES),
      'word/document.xml': strToU8(document),
    }),
  );
}

/**
 * One entry per slide, named the way PowerPoint names them.
 *
 * Ten or more slides is the case worth building: `slide10.xml` sorts before
 * `slide2.xml` as a string, so a real deck is what proves the extractor orders
 * by number rather than by filename.
 */
export function makePptx(slides: string[][]): Buffer {
  const entries: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(CONTENT_TYPES),
  };

  slides.forEach((lines, index) => {
    const shapes = lines
      .map(
        (line) =>
          `<p:sp><p:txBody><a:p><a:r><a:t>${escapeXml(line)}</a:t></a:r></a:p></p:txBody></p:sp>`,
      )
      .join('');

    entries[`ppt/slides/slide${index + 1}.xml`] = strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
       xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld><p:spTree>${shapes}</p:spTree></p:cSld>
</p:sld>`,
    );
  });

  return Buffer.from(zipSync(entries));
}
