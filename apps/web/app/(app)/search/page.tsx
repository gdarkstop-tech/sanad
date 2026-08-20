import { redirect } from 'next/navigation';
import { listCourses, listLectures } from '@sanad/core';
import { db } from '@sanad/db';
import { AppNav } from '@/components/AppNav';
import { SearchPanel } from '@/components/SearchPanel';
import { currentUser, subjectOf } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * Search across everything the student owns.
 *
 * The retrieval query is already scoped by the permission filter, so leaving
 * the course off widens the search to this student's material and no further.
 */
export default async function SearchPage() {
  const user = await currentUser();
  if (!user) redirect('/sign-in');

  const subject = subjectOf(user);
  const courses = await listCourses(db(), subject, { includeArchived: true });
  const active = courses.filter((course) => !course.archivedAt).length;

  const lectureLists = await Promise.all(
    courses.map((course) => listLectures(db(), subject, course.id)),
  );
  const demoContent = lectureLists
    .flat()
    .some((lecture) => lecture.transcription?.isSynthetic);

  return (
    <main className="shell">
      <AppNav name={user.fullName} current="/search" />
      <h1>Search</h1>
      <p className="lede">
        Across every lecture and document in your {active} course{active === 1 ? '' : 's'} —
        including archived ones. Each result links to the second of the lecture or the page
        of the document it came from.
      </p>

      {courses.length === 0 ? (
        <p className="muted">
          Nothing to search yet. Create a course and add a lecture or a document first.
        </p>
      ) : (
        <SearchPanel demoContent={demoContent} />
      )}
    </main>
  );
}
