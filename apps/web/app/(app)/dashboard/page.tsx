import { redirect } from 'next/navigation';
import { listCourses } from '@sanad/core';
import { db } from '@sanad/db';
import { AppNav } from '@/components/AppNav';
import { CourseList } from '@/components/CourseList';
import { currentUser, subjectOf } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const user = await currentUser();
  if (!user) redirect('/sign-in');

  // Archived courses come down too, so the list can offer to show them without
  // a second request. They are filtered out of the active grid client-side.
  const courses = await listCourses(db(), subjectOf(user), { includeArchived: true });

  return (
    <main className="shell">
      <AppNav name={user.fullName} current="/dashboard" />

      <h1>Your courses</h1>
      <p className="lede">
        Record a lecture, upload the slides, then search it, question it, and revise
        from it. Every answer points back to the moment it came from.
      </p>

      <CourseList
        courses={courses.map((c) => ({
          id: c.id,
          title: c.title,
          code: c.code,
          primaryLanguage: c.primaryLanguage,
          isOwner: c.isOwner,
          archivedAt: c.archivedAt ? c.archivedAt.toISOString() : null,
        }))}
      />
    </main>
  );
}
