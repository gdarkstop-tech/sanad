/**
 * Study-content language.
 *
 * Sanad's study material is **extracted**, not written: a summary is sentences
 * the professor said, a flashcard blanks a word the source contains. That is
 * what makes it safe to generate without review — it cannot state something the
 * material does not.
 *
 * The same property is why it cannot be translated for free. Translating an
 * extracted sentence makes it no longer a quotation, and a translated quotation
 * still anchored to a timestamp claims the professor said something they did
 * not say in those words. Doing it properly needs a model Sanad does not run at
 * $0, plus a way to keep the original alongside the translation so the citation
 * still resolves.
 *
 * So this module does one honest thing: it names the languages Sanad supports,
 * reports which of them can actually be generated today, and gives the UI the
 * words to explain the difference. No path here silently returns untranslated
 * content while claiming it was translated.
 */

export interface StudyLanguage {
  code: string;
  englishName: string;
  nativeName: string;
  direction: 'ltr' | 'rtl';
}

/**
 * The MVP languages. A row, not an enum: adding a fourth language is adding an
 * entry here and a translation provider, never a schema migration.
 */
export const STUDY_LANGUAGES: StudyLanguage[] = [
  { code: 'ar', englishName: 'Arabic', nativeName: 'العربية', direction: 'rtl' },
  { code: 'en', englishName: 'English', nativeName: 'English', direction: 'ltr' },
  { code: 'zh', englishName: 'Chinese', nativeName: '中文', direction: 'ltr' },
];

export function studyLanguage(code: string): StudyLanguage | null {
  return STUDY_LANGUAGES.find((language) => language.code === code) ?? null;
}

export interface TranslationProvider {
  readonly name: string;
  isAvailable(): Promise<boolean>;
  translate(texts: string[], targetLanguage: string): Promise<string[]>;
}

/**
 * The only provider that exists.
 *
 * It reports itself unavailable and refuses if called, rather than returning
 * the input unchanged. A provider that quietly passes text through would make
 * every caller believe translation happened.
 */
export class UnavailableTranslationProvider implements TranslationProvider {
  readonly name = 'none';

  async isAvailable(): Promise<boolean> {
    return false;
  }

  async translate(): Promise<string[]> {
    throw new Error(
      'No translation provider is configured. Sanad does not translate study content yet.',
    );
  }
}

let provider: TranslationProvider = new UnavailableTranslationProvider();

export function setTranslationProvider(next: TranslationProvider): void {
  provider = next;
}

export function translationProvider(): TranslationProvider {
  return provider;
}

export interface LanguageAvailability {
  /** The language the student asked to study in. */
  requested: string;
  /** The language the content is actually in — the language it was taught in. */
  actual: string;
  translated: boolean;
  /** Shown verbatim in the UI when `translated` is false. */
  notice: string | null;
}

/**
 * What a student will actually get if they pick a language.
 *
 * Called before rendering study content so the UI can say "this is in Arabic
 * because that is the language of the lecture" instead of silently showing
 * something other than what was chosen.
 */
export async function resolveStudyLanguage(
  requested: string,
  sourceLanguage: string,
): Promise<LanguageAvailability> {
  if (requested === sourceLanguage) {
    return { requested, actual: sourceLanguage, translated: false, notice: null };
  }

  if (await translationProvider().isAvailable()) {
    return { requested, actual: requested, translated: true, notice: null };
  }

  const target = studyLanguage(requested);
  const source = studyLanguage(sourceLanguage);
  return {
    requested,
    actual: sourceLanguage,
    translated: false,
    notice:
      `Sanad cannot translate study content into ${target?.englishName ?? requested} yet, ` +
      `so this is shown in ${source?.englishName ?? sourceLanguage} — the language it was taught in. ` +
      'Everything here is quoted from your own material, and translating a quotation ' +
      'would break the link between a sentence and the moment it came from.',
  };
}
