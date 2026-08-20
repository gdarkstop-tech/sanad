import fs from 'node:fs/promises';
import {
  FixtureAsrProvider,
  createCourse,
  createLecture,
  enrichScope,
  generatePlan,
  recordAnswer,
  runPending,
  seedEmphasisCues,
  setAsrProvider,
  setAvailability,
  addExamDate,
  registerUser,
  storage,
  uploadDirect,
  type Subject,
} from '../packages/core/src/index';
import { createDatabase, loadRootEnv, materials, studyTopics } from '../packages/db/src/index';
import { eq } from 'drizzle-orm';

/**
 * Deterministic demo data.
 *
 * §35 of the brief: the demo must not depend on anything generating correctly
 * for the first time on stage. This seeds a complete, realistic account so the
 * whole story can be walked through with nothing left to chance.
 *
 * Two unrelated disciplines, because the product's claim is that it works for
 * any course — and a demo on one subject cannot show that. Neither subject
 * appears anywhere in application code; both are data, and CI enforces it.
 */

loadRootEnv();

const url = process.argv[2] ?? process.env.DATABASE_URL;
if (!url) {
  console.error('No DATABASE_URL set.');
  process.exit(1);
}

const db = createDatabase(url);
setAsrProvider(new FixtureAsrProvider());

const EMAIL = process.env.DEMO_EMAIL ?? 'demo@university.edu';
const PASSWORD = process.env.DEMO_PASSWORD ?? 'demo-password-1234';

/** Lecture transcripts, written as a real recognizer would emit them. */
const LECTURES: Record<string, Array<{ text: string; confidence: number }>> = {
  'Lecture 03 — Sorting and complexity': [
    { text: 'Today we continue with sorting algorithms and how we compare them', confidence: 0.95 },
        { text: 'Merge sort divides the array in half and merges the sorted halves back together', confidence: 0.93 },
    { text: 'الـ time complexity بتاعت merge sort هي n log n في كل الحالات', confidence: 0.88 },
    { text: 'Quick sort is usually faster in practice but its worst case is quadratic', confidence: 0.91 },
    { text: 'دي نقطة مهمة جدا ركزوا معايا في الفرق بين الاتنين', confidence: 0.87 },
    { text: 'The choice of pivot determines whether quick sort degrades to its worst case', confidence: 0.94 },
    { text: 'الفرق بين stable و unstable sorting ده مهم في الامتحان', confidence: 0.86 },
    // Deliberately uncertain: a real recognizer is not uniformly confident, and
    // the transcript marks what it is unsure of rather than presenting every
    // line as equally reliable.
    { text: 'ال heapsort كمان بيديك n log n بس مش stable', confidence: 0.54 },
    { text: 'A stable sort preserves the relative order of records with equal keys', confidence: 0.92 },
  ],
  'Lecture 04 — Hash tables': [
    { text: 'A hash table maps keys to buckets using a hash function', confidence: 0.96 },
    { text: 'Average lookup is constant time when the load factor stays low', confidence: 0.93 },
    { text: 'الـ collision بيحصل لما مفتاحين يروحوا لنفس الـ bucket', confidence: 0.85 },
    { text: 'Chaining stores colliding entries in a list attached to the bucket', confidence: 0.94 },
    { text: 'Open addressing probes for the next free slot instead of chaining', confidence: 0.9 },
    { text: 'الـ rehashing بيحصل لما الـ load factor يعدي الحد', confidence: 0.58 },
    { text: 'This is important for the exam: know when to resize the table', confidence: 0.95 },
  ],
  'Lecture 02 — Membrane transport': [
    { text: 'Cell membranes control which substances enter and leave the cell', confidence: 0.95 },
    { text: 'Passive transport moves substances down their concentration gradient without energy', confidence: 0.93 },
    { text: 'الـ osmosis هي حركة الماء عبر غشاء شبه منفذ', confidence: 0.87 },
    { text: 'Active transport requires ATP because it moves substances against the gradient', confidence: 0.94 },
    { text: 'دي مهمة في الامتحان: الفرق بين الـ active و الـ passive transport', confidence: 0.89 },
    { text: 'الـ facilitated diffusion بيستخدم carrier proteins من غير طاقة', confidence: 0.56 },
    { text: 'The sodium potassium pump is the classic example of active transport', confidence: 0.92 },
  ],
};

/** Minimal but valid PDFs, so extraction runs for real rather than being stubbed. */
function makePdf(pages: string[]): Buffer {
  const objects: string[] = [];
  const kids = pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ');
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  for (const page of pages) {
    const escaped = page.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
    const stream = `BT /F1 12 Tf 72 720 Td (${escaped}) Tj ET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${objects.length + 2} 0 R >>`,
    );
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  }
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

async function addLecture(
  subject: Subject,
  offeringId: string,
  title: string,
  lines: Array<{ text: string; confidence: number }>,
): Promise<void> {
  const lecture = await createLecture(db, subject, offeringId, { title });

  const audio = Buffer.concat([
    Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
    Buffer.from(`demo-audio-${title}`),
  ]);
  const { materialId } = await uploadDirect(db, subject, {
    clientRef: `demo-${title.replace(/\W/g, '').slice(0, 40)}`,
    offeringId,
    lectureId: lecture.id,
    filename: 'lecture.webm',
    mimeType: 'audio/webm',
    data: audio,
  });

  // The fixture reads a sidecar transcript, so the demo shows exactly this
  // content rather than whatever a synthesizer produced.
  const [row] = await db
    .select({ storageKey: materials.storageKey })
    .from(materials)
    .where(eq(materials.id, materialId));
  const localPath = storage().localPath(row!.storageKey);
  if (localPath) {
    await fs.writeFile(
      `${localPath}.transcript.json`,
      JSON.stringify(
        lines.map((line, index) => ({
          tStartMs: index * 12_000,
          tEndMs: index * 12_000 + 11_000,
          text: line.text,
          confidence: line.confidence,
        })),
      ),
    );
  }

  await runPending(db, { max: 40 });
  console.log(`  · ${title} (${lines.length} segments)`);
}

async function main(): Promise<void> {
  await seedEmphasisCues(db);

  const { user } = await registerUser(
    db,
    {
      email: EMAIL,
      password: PASSWORD,
      fullName: 'Demo Student',
      role: 'student',
      interfaceLocale: 'en',
      timezone: 'UTC',
      profile: {
        university: { name: 'Demo University', country: 'EG' },
        faculty: { name: 'Faculty of Science' },
      },
    },
    30,
  );
  const subject: Subject = { userId: user.id, role: user.role };
  console.log(`\nAccount: ${EMAIL} / ${PASSWORD}`);

  // Discipline 1
  const cs = await createCourse(db, subject, {
    title: 'Computer Science — Data Structures',
    code: 'CS201',
    primaryLanguage: 'ar',
    secondaryLanguages: ['en'],
  });
  console.log('\nComputer Science — Data Structures');
  await addLecture(subject, cs.id, 'Lecture 03 — Sorting and complexity', LECTURES['Lecture 03 — Sorting and complexity']!);
  await addLecture(subject, cs.id, 'Lecture 04 — Hash tables', LECTURES['Lecture 04 — Hash tables']!);
  await uploadDirect(db, subject, {
    clientRef: 'demo-cs-slides',
    offeringId: cs.id,
    filename: 'week-4-slides.pdf',
    mimeType: 'application/pdf',
    data: makePdf([
      'Hash table load factor is the ratio of stored entries to available buckets.',
      'Resizing rehashes every entry, which is why it is amortised rather than constant.',
      'Comparison sorts cannot beat n log n in the general case.',
    ]),
  });
  console.log('  · week-4-slides.pdf');

  // Discipline 2 — unrelated, because the claim is that any course works.
  const bio = await createCourse(db, subject, {
    title: 'Biology — Cell Structure',
    code: 'BIO110',
    primaryLanguage: 'ar',
    secondaryLanguages: ['en'],
  });
  console.log('\nBiology — Cell Structure');
  await addLecture(subject, bio.id, 'Lecture 02 — Membrane transport', LECTURES['Lecture 02 — Membrane transport']!);
  await uploadDirect(db, subject, {
    clientRef: 'demo-bio-slides',
    offeringId: bio.id,
    filename: 'membrane-handout.pdf',
    mimeType: 'application/pdf',
    data: makePdf([
      'Diffusion moves solutes from high concentration to low concentration.',
      'Osmosis is the diffusion of water across a selectively permeable membrane.',
    ]),
  });
  console.log('  · membrane-handout.pdf');

  await runPending(db, { max: 60 });
  await enrichScope(db, { offeringId: cs.id });
  await enrichScope(db, { offeringId: bio.id });

  // A little answer history, so weak topics and the coach have something real
  // to work from rather than showing an empty state on stage.
  const topics = await db.select().from(studyTopics).where(eq(studyTopics.offeringId, cs.id));
  for (const topic of topics.slice(0, 2)) {
    for (let i = 0; i < 4; i += 1) {
      await recordAnswer(db, subject, {
        offeringId: cs.id,
        topicId: topic.id,
        isCorrect: i === 0,
      });
    }
  }

  const examAt = new Date(Date.now() + 4 * 86_400_000);
  await addExamDate(db, subject, { offeringId: cs.id, title: 'Midterm', examAt });

  // A realistic week, not seven identical free evenings. The point of the coach
  // is that it plans *around* things, and a schedule with nothing to work
  // around cannot show that. Sunday is left entirely free of study windows so
  // the demo has a visible rest day.
  //   Mon  university + work      Tue  free
  //   Wed  gym                    Thu  university
  //   Fri  gym                    Sat  free       Sun  rest
  await setAvailability(db, subject, [
    { weekday: 1, startTime: '09:00', endTime: '15:00', kind: 'class', isAvailable: false },
    { weekday: 1, startTime: '16:00', endTime: '21:00', kind: 'work', isAvailable: false },
    { weekday: 2, startTime: '14:00', endTime: '22:00', kind: 'study', isAvailable: true },
    { weekday: 3, startTime: '18:00', endTime: '20:00', kind: 'gym', isAvailable: false },
    { weekday: 3, startTime: '20:00', endTime: '23:00', kind: 'study', isAvailable: true },
    { weekday: 4, startTime: '09:00', endTime: '15:00', kind: 'class', isAvailable: false },
    { weekday: 4, startTime: '17:00', endTime: '22:00', kind: 'study', isAvailable: true },
    { weekday: 5, startTime: '18:00', endTime: '20:00', kind: 'gym', isAvailable: false },
    { weekday: 6, startTime: '10:00', endTime: '20:00', kind: 'study', isAvailable: true },
  ]);
  const plan = await generatePlan(db, subject);

  console.log(`\nExam in 4 days · ${plan.sessions.length} study sessions planned`);
  console.log(`\nTry: search "collision", ask "What did the professor say about hash tables?",`);
  console.log(`     then ask something unrelated to see Sanad refuse.\n`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
