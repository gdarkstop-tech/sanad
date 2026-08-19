'use client';

import { useRouter } from 'next/navigation';

export function SignOutButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      className="secondary"
      onClick={async () => {
        await fetch('/api/v1/auth/logout', { method: 'POST' });
        router.push('/sign-in');
        router.refresh();
      }}
    >
      Sign out
    </button>
  );
}
