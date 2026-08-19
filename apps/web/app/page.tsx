import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';

export default async function Home() {
  const user = await currentUser().catch(() => null);
  redirect(user ? '/dashboard' : '/sign-in');
}
