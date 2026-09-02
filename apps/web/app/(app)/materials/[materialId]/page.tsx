import Link from 'next/link';
import { redirect } from 'next/navigation';
import { readCourse, readMaterialExcerpts } from '@sanad/core';
import { db } from '@sanad/db';
import { AppNav } from '@/components/AppNav';
import { JumpToAnchor } from '@/components/JumpToAnchor';
import { currentUser, subjectOf } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * A document, as Sanad read it.
 *
 * This page exists so a citation can be checked. Sanad says "week-4-slides.pdf
 * — page 1"; opening that has to land on the actual sentence it quoted, or the
 * citation is a claim rather than evidence. The extracted text is shown, not
 * the original file, because the extracted text is what was searched and
 * quoted — showing the PDF would hide any extraction error rather than expose
 * it.
 */
export default async function MaterialPage({
  params,
  searchParams,
}: {
  params: Promise<{ materialId: string }>;
  searchParams: Promise<{ page?: string; slide?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect('/sign-in');

  const { materialId } = await params;
  const { page, slide } = await searchParams;
  const subject = subjectOf(user);

  const { material, excerpts } = await readMaterialExcerpts(db(), subject, materialId);
  const course = await readCourse(db(), subject, material.offeringId);

  const targetPage = page ? Number(page) : null;
  const targetSlide = slide ? Number(slide) : null;
  const anchorFor = (excerpt: (typeof excerpts)[number]): string =>
    excerpt.pageNo !== null
      ? `p-${excerpt.pageNo}`
      : excerpt.slideNo !== null
        ? `s-${excerpt.slideNo}`
        : `c-${excerpt.seq}`;
  const targetAnchor =
    targetPage !== null ? `p-${targetPage}` : targetSlide !== null ? `s-${targetSlide}` : null;

  return (
    <main className="shell">
      <AppNav name={user.fullName} current="/dashboard" />

      <p className="muted" style={{ marginBlockEnd: '0.3rem' }}>
        <Link href={`/courses/${material.offeringId}`}>{course.title}</Link>
      </p>
      <h1>{material.title}</h1>
      <p className="lede">
        <span className={`pill pill-${material.processingStatus}`}>
          {material.processingStatus}
        </span>{' '}
        {material.materialType.toUpperCase()}
        {material.pageCount ? ` · ${material.pageCount} pages` : ''}
        {excerpts.length > 0 ? ` · ${excerpts.length} extracted sections` : ''}
      </p>

      {targetAnchor ? <JumpToAnchor anchor={targetAnchor} /> : null}

      {material.processingError ? (
        <p className="error" role="alert">{material.processingError}</p>
      ) : null}

      <section className="card">
        <h2>What Sanad read</h2>
        <p className="muted" style={{ marginBlockStart: 0 }}>
          The extracted text, not the original file — this is what search and answers
          actually quote, so any extraction mistake is visible here rather than hidden.
        </p>

        {excerpts.length === 0 ? (
          <p className="muted">
            {material.processingStatus === 'ready'
              ? 'No text was extracted from this file. Images and scans have no text layer, and OCR is not available yet.'
              : 'Not processed yet. This page will show the extracted text once it is.'}
          </p>
        ) : (
          <ol className="plain excerpts">
            {excerpts.map((excerpt) => {
              const anchor = anchorFor(excerpt);
              return (
                <li
                  key={excerpt.id}
                  id={anchor}
                  className={anchor === targetAnchor ? 'excerpt cited' : 'excerpt'}
                >
                  {excerpt.label ? (
                    <span className="timestamp">{excerpt.label}</span>
                  ) : (
                    <span className="timestamp">section {excerpt.seq + 1}</span>
                  )}
                  <p dir="auto" style={{ marginBlock: '0.25rem 0' }}>{excerpt.text}</p>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </main>
  );
}
