/**
 * Cross-student isolation, probed over real HTTP against a running server.
 *
 * `tests/integration/isolation.test.ts` proves the same property at the service
 * layer. This exists because that is a different claim: here the request goes
 * through middleware, session lookup, CSRF and the route handler, so a route
 * that forgets its permission check fails here even when the service beneath it
 * is correct.
 *
 * Usage:
 *   pnpm exec tsx scripts/verify-isolation.ts [baseUrl] [ownerEmail] [ownerPassword]
 *
 * Exits non-zero if any check fails. Nothing is mutated in the owner's account.
 */

const BASE = process.argv[2] ?? process.env.SANAD_URL ?? 'http://localhost:3000';
const OWNER_EMAIL = process.argv[3] ?? process.env.DEMO_EMAIL ?? 'demo@university.edu';
const OWNER_PASSWORD = process.argv[4] ?? process.env.DEMO_PASSWORD ?? 'demo-password-1234';

interface Reply {
  status: number;
  body: Record<string, unknown>;
}

/**
 * A client with its own cookie jar.
 *
 * Cookies are tracked by hand rather than left to fetch: the session and CSRF
 * cookies are marked Secure, and two independent students must not share a jar.
 */
class Client {
  private readonly cookies = new Map<string, string>();

  async prime(): Promise<void> {
    // A normal page load is what issues the CSRF cookie.
    this.capture(await fetch(`${BASE}/sign-in`));
  }

  private capture(response: Response): void {
    for (const raw of response.headers.getSetCookie?.() ?? []) {
      const pair = raw.split(';')[0]?.trim();
      if (!pair?.includes('=')) continue;
      const index = pair.indexOf('=');
      this.cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
  }

  async call(method: string, path: string, body?: unknown): Promise<Reply> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (this.cookies.size > 0) {
      headers.cookie = [...this.cookies].map(([key, value]) => `${key}=${value}`).join('; ');
    }
    const csrf = this.cookies.get('sanad_csrf');
    if (csrf) headers['x-csrf-token'] = csrf;

    const response = await fetch(`${BASE}${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    this.capture(response);

    const text = await response.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      parsed = { raw: text.slice(0, 200) };
    }
    return { status: response.status, body: parsed };
  }
}

const failures: string[] = [];

function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `   [${detail}]` : ''}`);
  if (!ok) failures.push(name);
}

/** Refused means refused: 403 or 404, never a body with the owner's data. */
function refused(reply: Reply): boolean {
  return reply.status === 403 || reply.status === 404;
}

async function main(): Promise<number> {
  const owner = new Client();
  await owner.prime();
  const login = await owner.call('POST', '/api/v1/auth/login', {
    email: OWNER_EMAIL,
    password: OWNER_PASSWORD,
  });
  if (login.status !== 200) {
    console.error(`Could not sign in as ${OWNER_EMAIL} (HTTP ${login.status}).`);
    console.error('Seed the demo account first: pnpm db:seed:demo');
    return 2;
  }

  const courses = (await owner.call('GET', '/api/v1/courses')).body.courses as
    | Array<{ id: string; title: string }>
    | undefined;
  const course = courses?.[0];
  if (!course) {
    console.error('The owner account has no courses, so there is nothing to protect.');
    return 2;
  }

  const lectures = (await owner.call('GET', `/api/v1/courses/${course.id}/lectures`)).body
    .lectures as Array<{ id: string }> | undefined;
  const materials = (await owner.call('GET', `/api/v1/courses/${course.id}/materials`)).body
    .materials as Array<{ id: string }> | undefined;
  const lectureId = lectures?.[0]?.id;
  const materialId = materials?.[0]?.id;
  if (!lectureId || !materialId) {
    console.error('The owner account has no lecture or material to protect.');
    return 2;
  }

  console.log(`\nOwner: ${OWNER_EMAIL}`);
  console.log(`  course   ${course.id} (${course.title})`);
  console.log(`  lecture  ${lectureId}`);
  console.log(`  material ${materialId}`);

  const intruder = new Client();
  await intruder.prime();
  const email = `isolation-probe.${Date.now()}@university.edu`;
  const registration = await intruder.call('POST', '/api/v1/auth/register', {
    email,
    password: 'correct-horse-battery',
    fullName: 'Isolation Probe',
    universityName: 'Probe University',
  });
  if (registration.status !== 200 && registration.status !== 201) {
    console.error(
      `Could not register the second student (HTTP ${registration.status}). ` +
        'Rate limiting may be in effect; wait for the window to pass.',
    );
    return 2;
  }
  console.log(`\nSecond student: ${email}`);
  console.log('\nHolding the owner’s ids, the second student:');

  const list = await intruder.call('GET', '/api/v1/courses');
  const visible = (list.body.courses as Array<{ id: string }> | undefined) ?? [];
  check(
    'does not see the course in a listing',
    !visible.some((entry) => entry.id === course.id),
    `HTTP ${list.status}`,
  );

  for (const [name, path] of [
    ['cannot open the course', `/api/v1/courses/${course.id}`],
    ['cannot list its lectures', `/api/v1/courses/${course.id}/lectures`],
    ['cannot list its materials', `/api/v1/courses/${course.id}/materials`],
    ['cannot open the lecture', `/api/v1/lectures/${lectureId}`],
    ['cannot read the transcript', `/api/v1/lectures/${lectureId}/transcript`],
    ['cannot open the material', `/api/v1/materials/${materialId}`],
  ] as const) {
    const reply = await intruder.call('GET', path);
    check(name, refused(reply), `HTTP ${reply.status}`);
  }

  const destroy = await intruder.call('DELETE', `/api/v1/courses/${course.id}`);
  check('cannot delete the course', refused(destroy), `HTTP ${destroy.status}`);

  const broad = await intruder.call('GET', '/api/v1/search?q=the');
  const broadHits = (broad.body.results as unknown[] | undefined) ?? [];
  check(
    'finds none of the owner’s content in an unscoped search',
    broad.status === 200 && broadHits.length === 0,
    `HTTP ${broad.status}, ${broadHits.length} hits`,
  );

  const scoped = await intruder.call('GET', `/api/v1/search?q=the&course_id=${course.id}`);
  const scopedHits = (scoped.body.results as unknown[] | undefined) ?? [];
  check(
    'finds nothing when scoping search to the owner’s course',
    refused(scoped) || scopedHits.length === 0,
    `HTTP ${scoped.status}, ${scopedHits.length} hits`,
  );

  const asked = await intruder.call('POST', '/api/v1/ask', {
    question: 'Summarize everything in my course materials.',
  });
  check(
    'is refused by Ask rather than answered from the owner’s material',
    asked.status === 200 && asked.body.refused === true,
    `HTTP ${asked.status}, refused=${String(asked.body.refused)}`,
  );

  const askedScoped = await intruder.call('POST', '/api/v1/ask', {
    question: 'Summarize everything in my course materials.',
    courseId: course.id,
  });
  const scopedCitations = (askedScoped.body.citations as unknown[] | undefined) ?? [];
  check(
    'is refused by Ask even when naming the owner’s course',
    refused(askedScoped) ||
      (askedScoped.body.refused === true && scopedCitations.length === 0),
    `HTTP ${askedScoped.status}, refused=${String(askedScoped.body.refused)}`,
  );

  const exam = await intruder.call('POST', `/api/v1/courses/${course.id}/exam`, {
    questionCount: 5,
  });
  check('cannot generate an exam from it', refused(exam), `HTTP ${exam.status}`);

  const upload = await intruder.call('POST', '/api/v1/uploads', {
    clientRef: `isolation-probe-${Date.now()}`,
    offeringId: course.id,
    filename: 'planted.pdf',
    mimeType: 'application/pdf',
    totalBytes: 1024,
    checksumSha256: 'a'.repeat(64),
  });
  check('cannot upload into it', refused(upload), `HTTP ${upload.status}`);

  // The positive control: without it, a server that refused everything would
  // pass every check above.
  const ownerTranscript = await owner.call('GET', `/api/v1/lectures/${lectureId}/transcript`);
  const segments = (ownerTranscript.body.segments as unknown[] | undefined) ?? [];
  check(
    'meanwhile the owner still reads their own transcript',
    ownerTranscript.status === 200 && segments.length > 0,
    `HTTP ${ownerTranscript.status}, ${segments.length} segments`,
  );

  console.log('');
  if (failures.length > 0) {
    console.error(`${failures.length} isolation check(s) FAILED:`);
    for (const failure of failures) console.error(`  - ${failure}`);
    return 1;
  }
  console.log('All isolation checks passed over HTTP.');
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(2);
  },
);
