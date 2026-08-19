'use client';

import { useRouter } from 'next/navigation';
import { api } from '@/lib/client';

export function SignOutButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      className="secondary"
      onClick={async () => {
        await api('/api/v1/auth/logout', { method: 'POST' }).catch(() => undefined);
        router.push('/sign-in');
        router.refresh();
      }}
    >
      Sign out
    </button>
  );
}
