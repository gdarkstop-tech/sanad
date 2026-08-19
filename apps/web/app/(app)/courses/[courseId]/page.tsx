import Link from 'next/link';
import { redirect } from 'next/navigation';
import { listLectures, listMaterials, readCourse } from '@sanad/core';
import { db } from '@sanad/db';
import { AskPanel } from '@/components/AskPanel';
import { CourseWorkspace } from '@/components/CourseWorkspace';
import { ExamMode } from '@/components/ExamMode';
import { SearchPanel } from '@/components/SearchPanel';
import { currentUser, subjectOf } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function CoursePage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect('/sign-in');
  const { courseId } = await params;
  const subject = subjectOf(user);

  const course = await readCourse(db(), subject, courseId);
  const lectures = await listLectures(db(), subject, courseId);
  const materials = await listMaterials(db(), subject, courseId);

  return (
    <main className="shell">
      <header className="topbar">
        <Link href="/dashboard" className="brand">Sanad</Link>
        <span className="muted">{user.fullName}</span>
      </header>

      <h1>{course.title}</h1>
      <p className="lede">
        {course.code ? `${course.code} · ` : ''}
        {lectures.length} lecture{lectures.length === 1 ? '' : 's'} · {materials.length} material
        {materials.length === 1 ? '' : 's'}
      </p>

      <div className="stack-lg">
        <SearchPanel courseId={courseId} />
        <AskPanel courseId={courseId} courseTitle={course.title} />
        <ExamMode courseId={courseId} />
        <CourseWorkspace
          courseId={courseId}
          lectures={lectures.map((l) => ({
            id: l.id,
            title: l.title,
            occurredOn: l.occurredOn,
            status: l.status,
            segmentCount: l.segmentCount,
            hasRecording: l.hasRecording,
          }))}
          materials={materials.map((m) => ({
            id: m.id,
            title: m.title,
            type: m.materialType,
            pageCount: m.pageCount,
            processingStatus: m.processingStatus,
            processingError: m.processingError,
          }))}
        />
      </div>
    </main>
  );
}
