import { redirect } from 'next/navigation';
import { listExamDates, listLectures, listMaterials, readCourse } from '@sanad/core';
import { db } from '@sanad/db';
import { AppNav } from '@/components/AppNav';
import { AskPanel } from '@/components/AskPanel';
import { ComingSoon } from '@/components/ComingSoon';
import { CourseActivity } from '@/components/CourseActivity';
import { CourseWorkspace } from '@/components/CourseWorkspace';
import { ExamDateForm } from '@/components/ExamDateForm';
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
  const exams = await listExamDates(db(), subject, courseId);

  const upcoming = exams.filter((exam) => exam.examAt.getTime() >= Date.now());
  const lastLecture = lectures[0] ?? null;

  return (
    <main className="shell">
      <AppNav name={user.fullName} current="/dashboard" />

      <h1>{course.title}</h1>
      <p className="lede">
        {course.code ? `${course.code} · ` : ''}
        {lectures.length} lecture{lectures.length === 1 ? '' : 's'} · {materials.length} material
        {materials.length === 1 ? '' : 's'}
        {course.archivedAt ? ' · archived' : ''}
      </p>

      <div className="stack-lg">
        <CourseActivity
          courseId={courseId}
          lastLecture={
            lastLecture
              ? { id: lastLecture.id, title: lastLecture.title, status: lastLecture.status }
              : null
          }
          nextExam={
            upcoming[0]
              ? { title: upcoming[0].title, examAt: upcoming[0].examAt.toISOString() }
              : null
          }
          readyCount={lectures.filter((l) => l.segmentCount > 0).length}
          materialCount={materials.length}
        />

        <SearchPanel courseId={courseId} />
        <AskPanel courseId={courseId} courseTitle={course.title} />
        <ExamMode courseId={courseId} courseLanguage={course.primaryLanguage} />
        <ExamDateForm courseId={courseId} />

        <CourseWorkspace
          courseId={courseId}
          lectures={lectures.map((l) => ({
            id: l.id,
            title: l.title,
            occurredOn: l.occurredOn,
            status: l.status,
            segmentCount: l.segmentCount,
            hasRecording: l.hasRecording,
            folder: l.folder,
          }))}
          materials={materials.map((m) => ({
            id: m.id,
            title: m.title,
            type: m.materialType,
            pageCount: m.pageCount,
            processingStatus: m.processingStatus,
            processingError: m.processingError,
            folder: m.folder,
          }))}
        />

        <ComingSoon
          title="YouTube import"
          promise="Add a lecture video or YouTube source and Sanad will turn it into searchable study material."
          detail="Uploading a video file to this course already works — it is stored and transcribed like any recording. Importing from a URL needs reliable audio extraction and a licence position, so it is not here yet rather than here and fragile."
        />
      </div>
    </main>
  );
}
