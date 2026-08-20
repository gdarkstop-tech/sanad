/**
 * The roadmap, in one place.
 *
 * Web and mobile render the same list from the same data, so a feature cannot
 * be described as "coming soon" on one surface and quietly implied to work on
 * the other. Nothing here is wired to anything: a Coming Soon card makes no
 * request and has no control that does something, because a preview that
 * behaves like a broken feature is worse than no preview.
 *
 * Moving an entry out of this list is the *last* step of building it, never the
 * first.
 */

export interface RoadmapItem {
  id: string;
  title: string;
  /** One line, in the student's language, about what they will get. */
  promise: string;
  /** Why it is not here yet. Honest, not apologetic. */
  detail: string;
  /** Where it shows up, so neither app has to hardcode its own list. */
  surfaces: Array<'plan' | 'course' | 'community' | 'lecture'>;
}

export const ROADMAP: RoadmapItem[] = [
  {
    id: 'voice-tutor',
    title: 'AI Voice Tutor',
    promise: 'Talk to Sanad naturally using your voice.',
    detail:
      'It will answer through the same grounded retrieval as Ask Sanad — same citations, and the same refusal when your materials do not cover the question. Waiting on speech models that run locally at no cost.',
    surfaces: ['plan', 'course'],
  },
  {
    id: 'youtube-import',
    title: 'YouTube Import',
    promise: 'Import a lecture or video directly from YouTube.',
    detail:
      'Uploading a video file already works. Importing from a URL needs reliable audio extraction and a licence position, so it is not here yet rather than here and fragile.',
    surfaces: ['plan', 'course'],
  },
  {
    id: 'video-understanding',
    title: 'Video Understanding',
    promise: 'Pull slides, diagrams and spoken content out of an uploaded video.',
    detail:
      'Video files upload and are stored today. Reading what is on screen — not just what is said — needs frame analysis that has not been built.',
    surfaces: ['course'],
  },
  {
    id: 'community-feed',
    title: 'Community Feed',
    promise: 'Post, discuss, and get replies from other students.',
    detail:
      'A social layer needs moderation, abuse handling and a privacy review before it goes anywhere near student work.',
    surfaces: ['plan', 'community'],
  },
  {
    id: 'staff-community',
    title: 'Instructor & TA Community',
    promise: 'Teaching staff answer questions from their own students.',
    detail:
      'The roles and course-staff tables exist; the portal, the permissions review and the verification flow do not. Student data stays student-owned until that is properly designed.',
    surfaces: ['community'],
  },
  {
    id: 'live-translation',
    title: 'Live Translation',
    promise: 'Read a lecture in a language other than the one it was taught in.',
    detail:
      'Transcripts already carry a language per segment. Translating them without breaking the link between a sentence and its timestamp needs a model Sanad does not yet run for free.',
    surfaces: ['plan', 'lecture'],
  },
  {
    id: 'smart-translation',
    title: 'Smart Translation',
    promise: 'Arabic, English and Chinese study material, with more languages after that.',
    detail:
      'You can already choose a study language, and Sanad tells you when it cannot translate rather than silently showing the original. Generating the translation is the part that is missing.',
    surfaces: ['course'],
  },
  {
    id: 'collaborative-study',
    title: 'Collaborative Study',
    promise: 'Revise together with classmates on the same material.',
    detail:
      'Needs shared ownership of course content, which is deliberately not how Sanad stores anything today — every course belongs to one student.',
    surfaces: ['community'],
  },
  {
    id: 'ai-study-groups',
    title: 'AI Study Groups',
    promise: 'Sanad groups students who are stuck on the same topic and finds a time everyone is free.',
    detail:
      'The scheduler and the mastery model already compute both halves for one student. Doing it across students needs the community layer first.',
    surfaces: ['community'],
  },
  {
    id: 'advanced-ocr',
    title: 'Advanced OCR',
    promise: 'Read handwritten notes and scanned documents.',
    detail:
      'A scanned PDF is currently reported as such with a message you can act on, rather than silently producing nothing. Reading it needs an OCR engine that runs locally.',
    surfaces: ['course'],
  },
  {
    id: 'live-transcription',
    title: 'Live Transcription',
    promise: 'Watch the transcript appear while the lecture is happening.',
    detail:
      'A deliberate no for now: a live tier has to transcribe faster than audio arrives, on a laptop CPU, and no engine has been measured doing that on real lecture audio. Recording first also lets a slower, more accurate model run.',
    surfaces: ['plan', 'lecture'],
  },
];

export function roadmapFor(surface: RoadmapItem['surfaces'][number]): RoadmapItem[] {
  return ROADMAP.filter((item) => item.surfaces.includes(surface));
}
