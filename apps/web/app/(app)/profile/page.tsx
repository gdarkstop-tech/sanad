import { redirect } from 'next/navigation';
import { readProfile } from '@sanad/core';
import { db } from '@sanad/db';
import { AppNav } from '@/components/AppNav';
import { ProfileForm } from '@/components/ProfileForm';
import { currentUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function ProfilePage() {
  const user = await currentUser();
  if (!user) redirect('/sign-in');

  const profile = await readProfile(db(), user);

  return (
    <main className="shell">
      <AppNav name={user.fullName} current="/profile" />
      <h1>Profile</h1>
      <p className="lede">
        Sanad asks only for what it uses: who you are, and where you study.
      </p>
      <ProfileForm
        initial={{
          user: {
            fullName: profile.user.fullName,
            email: profile.user.email,
            emailVerified: profile.user.emailVerified,
            interfaceLocale: profile.user.interfaceLocale,
          },
          universityName: profile.universityName,
          facultyName: profile.facultyName,
          departmentName: profile.departmentName,
          academicYearLabel: profile.academicYearLabel,
          major: profile.major,
          studentNumber: profile.studentNumber,
        }}
      />
    </main>
  );
}
