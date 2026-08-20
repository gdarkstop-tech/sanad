import { redirect } from 'next/navigation';
import { AppNav } from '@/components/AppNav';
import { RoadmapGrid } from '@/components/ComingSoon';
import { PlanWorkspace } from '@/components/PlanWorkspace';
import { currentUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function PlanPage() {
  const user = await currentUser();
  if (!user) redirect('/sign-in');

  return (
    <main className="shell">
      <AppNav name={user.fullName} current="/plan" />
      <h1>Study plan</h1>
      <p className="lede">
        Sanad plans your week around your real commitments and your exam dates. The
        schedule is computed — the same inputs always give the same plan.
      </p>

      <PlanWorkspace />

      <h2 style={{ marginBlockStart: '2rem' }}>On the roadmap</h2>
      <RoadmapGrid />
    </main>
  );
}
