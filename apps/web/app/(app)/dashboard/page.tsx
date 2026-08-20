import { redirect } from 'next/navigation';
import { listCourses } from '@sanad/core';
import { db } from '@sanad/db';
import { CourseList } from '@/components/CourseList';
import { SignOutButton } from '@/components/SignOutButton';
import { StudyCoach } from '@/components/StudyCoach';
import { currentUser, subjectOf } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const user = await currentUser();
  if (!user) redirect('/sign-in');

  const courses = await listCourses(db(), subjectOf(user));

  return (
    <main className="shell">
      <header className="topbar">
        <span className="brand">Sanad</span>
        <div className="row">
          <span className="muted">{user.fullName}</span>
          <SignOutButton />
        </div>
      </header>

      <h1>Your courses</h1>
      <p className="lede">
        Phase 1 foundation: accounts and courses. Lectures, materials, and search
        arrive in later phases.
      </p>

      <StudyCoach />

      <CourseList
        courses={courses.map((c) => ({
          id: c.id,
          title: c.title,
          code: c.code,
          primaryLanguage: c.primaryLanguage,
          isOwner: c.isOwner,
        }))}
      />
    </main>
  );
}
