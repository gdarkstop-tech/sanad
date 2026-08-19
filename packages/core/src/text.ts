/**
 * Shared normalization (AI_PIPELINE.md §8).
 *
 * The same function must run at index time and at query time. Divergence
 * between the two is a silent retrieval failure that is miserable to debug,
 * which is why this lives in one place from the first commit — long before
 * retrieval exists to use it.
 */

const TASHKEEL = /[ؐ-ًؚ-ٰٟۖ-ۭ]/g;
const TATWEEL = /ـ/g;
const ARABIC_INDIC_DIGITS = /[٠-٩۰-۹]/g;

export function normalizeArabic(input: string): string {
  return input
    .normalize('NFC')
    .replace(TASHKEEL, '')
    .replace(TATWEEL, '')
    .replace(/[أإآٱ]/g, 'ا') // أ إ آ ٱ -> ا
    .replace(/ى/g, 'ي') // ى -> ي
    .replace(/ة/g, 'ه') // ة -> ه
    .replace(ARABIC_INDIC_DIGITS, (d) => {
      const code = d.codePointAt(0) as number;
      const base = code >= 0x06f0 ? 0x06f0 : 0x0660;
      return String(code - base);
    });
}

/** Normalization applied identically to indexed text and to queries. */
export function normalizeForSearch(input: string): string {
  return normalizeArabic(input)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}
