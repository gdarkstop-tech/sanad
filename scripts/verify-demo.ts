/**
 * Checks that every beat docs/DEMO.md claims actually behaves that way.
 *
 * A demo script is a set of promises made to a room. This walks them against a
 * running server so a seed change, a threshold change or a renamed roadmap
 * entry breaks here rather than on stage.
 *
 * Usage:
 *   pnpm verify:demo [baseUrl]
 *
 * Needs a running server with the demo seeded (`pnpm demo:reset`).
 */

const BASE = process.argv[2] ?? process.env.SANAD_URL ?? 'http://localhost:3000';
const EMAIL = process.env.DEMO_EMAIL ?? 'demo@university.edu';
const PASSWORD = process.env.DEMO_PASSWORD ?? 'demo-password-1234';

const cookies = new Map<string, string>();
const failures: string[] = [];

function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? `   [${detail}]` : ''}`);
  if (!ok) failures.push(name);
}

function capture(response: Response): void {
  for (const raw of response.headers.getSetCookie?.() ?? []) {
    const pair = raw.split(';')[0]?.trim();
    if (!pair?.includes('=')) continue;
    const at = pair.indexOf('=');
    cookies.set(pair.slice(0, at), pair.slice(at + 1));
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (cookies.size > 0) {
    headers.cookie = [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }
  const csrf = cookies.get('sanad_csrf');
  if (csrf) headers['x-csrf-token'] = csrf;

  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  capture(response);
  const text = await response.text();
  try {
    return (text ? JSON.parse(text) : {}) as T;
  } catch {
    return text as T;
  }
}

/** Page text with entities decoded, so "&" in a feature name still matches. */
async function pageText(path: string): Promise<string> {
  const html = await call<string>('GET', path);
  return String(html)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&(?:nbsp|#160);/g, ' ')
    .replace(/&#x27;|&apos;/g, "'");
}

interface Course { id: string; title: string }
interface Lecture { id: string; title: string }
interface Segment { tStartMs: number; text: string; confidenceBand: string | null }
interface Citation { label: string }

async function main(): Promise<number> {
  capture(await fetch(`${BASE}/sign-in`));
  const login = await call<{ user?: { email: string } }>('POST', '/api/v1/auth/login', {
    email: EMAIL,
    password: PASSWORD,
  });
  check('Beat A: sign in', login.user?.email === EMAIL);
  if (!login.user) {
    console.error('\nCould not sign in. Run `pnpm demo:reset` first.');
    return 2;
  }

  const { courses } = await call<{ courses: Course[] }>('GET', '/api/v1/courses');
  check('Beat B: two unrelated courses', courses.length === 2, courses.map((c) => c.title).join(', '));
  const cs = courses.find((c) => c.title.includes('Data Structures'));
  if (!cs) {
    console.error('\nThe seeded Data Structures course is missing.');
    return 2;
  }

  const { lectures } = await call<{ lectures: Lecture[] }>(
    'GET',
    `/api/v1/courses/${cs.id}/lectures`,
  );
  const lecture = lectures.find((l) => l.title.includes('Hash tables')) ?? lectures[0]!;

  const transcript = await call<{
    lecture: { transcription: { isSynthetic: boolean } | null };
    segments: Segment[];
    emphasis: Array<{ tStartMs: number }>;
  }>('GET', `/api/v1/lectures/${lecture.id}/transcript`);

  const starts = transcript.segments.slice(0, 3).map((s) => s.tStartMs);
  check('Beat D: timestamps at 0:00, 0:12, 0:24', starts.join(',') === '0,12000,24000', starts.join(','));
  check(
    'Beat D: Arabic/English code-switching',
    transcript.segments.some((s) => /[؀-ۿ]/.test(s.text) && /[A-Za-z]/.test(s.text)),
  );
  check('Beat D: instructor-flagged moment at 1:12', transcript.emphasis.some((e) => e.tStartMs === 72000));
  check(
    'Beat D: uncertain passage at 1:00',
    transcript.segments.some((s) => s.tStartMs === 60000 && s.confidenceBand === 'low'),
  );
  check('Beat D: transcript provenance reported', transcript.lecture.transcription?.isSynthetic === true);
  check(
    'Beat D: lecture page discloses the demo transcript',
    (await pageText(`/lectures/${lecture.id}`)).includes('demo transcript, not speech recognition'),
  );

  const search = await call<{ results: Array<{ label: string }> }>(
    'GET',
    `/api/v1/search?q=open+addressing&course_id=${cs.id}`,
  );
  const labels = search.results.map((r) => r.label);
  check('Beat E: search finds a slide', labels.some((l) => /slide \d+/i.test(l)), labels.join(' | '));
  check('Beat E: search finds lecture moments', labels.some((l) => /\d+:\d{2}/.test(l)), labels.join(' | '));

  const answer = await call<{ refused: boolean; citations: Citation[]; meta: { generator: string } }>(
    'POST',
    '/api/v1/ask',
    { question: 'What is chaining in a hash table?', courseId: cs.id },
  );
  const cited = answer.citations.map((c) => c.label);
  check('Beat F: answered from the material', answer.refused === false);
  // Every anchor kind the product claims, in one answer.
  check('Beat F: cites a lecture timestamp', cited.some((l) => /\d+:\d{2}/.test(l)), cited.join(' | '));
  check('Beat F: cites a document page', cited.some((l) => /page \d+/i.test(l)), cited.join(' | '));
  check('Beat F: cites a presentation slide', cited.some((l) => /slide \d+/i.test(l)), cited.join(' | '));
  check('Beat F: cites a Word document', cited.some((l) => /\.docx/i.test(l)), cited.join(' | '));

  const refusal = await call<{ refused: boolean; citations: unknown[]; meta: { generator: string } }>(
    'POST',
    '/api/v1/ask',
    {
      question: 'What is the boiling point of liquid nitrogen at high altitude?',
      courseId: cs.id,
    },
  );
  check('Beat G: refuses', refusal.refused === true);
  check('Beat G: generator was never invoked', refusal.meta.generator === 'none', refusal.meta.generator);
  check('Beat G: no citations invented', refusal.citations.length === 0);

  const { exam } = await call<{
    exam: {
      summary: string | null;
      keywords: string[];
      flashcards: unknown[];
      questions: Array<{ sourceLabel?: string }>;
      emphasis: unknown[];
    };
  }>('POST', `/api/v1/courses/${cs.id}/exam`, { questionCount: 5 });
  check('Beat H: summary', Boolean(exam.summary));
  check('Beat H: key terms', exam.keywords.length > 0);
  check('Beat H: flashcards', exam.flashcards.length > 0);
  check(
    'Beat H: every question names a source',
    exam.questions.length > 0 && exam.questions.every((q) => Boolean(q.sourceLabel)),
  );
  check('Beat H: instructor-flagged moments', exam.emphasis.length > 0);

  const { plan } = await call<{ plan: { sessions: Array<{ startsAt: string }> } | null }>(
    'GET',
    '/api/v1/me/study-plan',
  );
  const sessions = plan?.sessions ?? [];
  const days = new Set(
    sessions.map((s) => new Date(s.startsAt).toLocaleDateString('en-GB', { weekday: 'short' })),
  );
  check('Beat I: a plan exists', sessions.length > 0);
  // The seeded week: university + work on Monday, gym only on Friday, Sunday
  // undeclared. All three must come out empty, or the scheduler is ignoring
  // commitments — which is the whole claim of this beat.
  check('Beat I: Monday empty (university + work)', !days.has('Mon'), [...days].join(','));
  check('Beat I: Friday empty (gym only)', !days.has('Fri'), [...days].join(','));
  check('Beat I: Sunday empty (rest day)', !days.has('Sun'), [...days].join(','));
  const { exams } = await call<{ exams: unknown[] }>('GET', '/api/v1/me/exam-dates');
  check('Beat I: exam date present', exams.length > 0);

  const surfaces = (
    await Promise.all([pageText('/plan'), pageText(`/courses/${cs.id}`), pageText('/community')])
  ).join('\n');
  const roadmap = [
    'AI Voice Tutor',
    'YouTube Import',
    'Video Understanding',
    'Community Feed',
    'Instructor & TA Community',
    'Live Translation',
    'Smart Translation',
    'Collaborative Study',
    'AI Study Groups',
    'Advanced OCR',
    'Live Transcription',
  ];
  const missing = roadmap.filter((item) => !surfaces.includes(item));
  check(`Beat J: all ${roadmap.length} roadmap items shown`, missing.length === 0, missing.join(', '));
  check('Beat J: labelled Coming soon', /coming soon/i.test(surfaces));

  console.log('');
  if (failures.length > 0) {
    console.error(`${failures.length} demo beat(s) FAILED:`);
    for (const failure of failures) console.error(`  - ${failure}`);
    return 1;
  }
  console.log('Every beat in docs/DEMO.md behaves as documented.');
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(2);
  },
);
