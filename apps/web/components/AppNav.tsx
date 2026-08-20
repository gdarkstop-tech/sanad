import Link from 'next/link';
import { SignOutButton } from '@/components/SignOutButton';

/** One header for every signed-in page, so navigation is not per-page guesswork. */
export function AppNav({ name, current }: { name: string; current: string }) {
  const items = [
    { href: '/dashboard', label: 'Courses' },
    { href: '/plan', label: 'Study plan' },
    { href: '/community', label: 'Community' },
    { href: '/profile', label: 'Profile' },
  ];

  return (
    <header className="topbar">
      <Link href="/dashboard" className="brand" style={{ textDecoration: 'none' }}>
        Sanad
      </Link>
      <nav className="nav">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={item.href === current ? 'page' : undefined}
          >
            {item.label}
          </Link>
        ))}
        <span className="muted">{name}</span>
        <SignOutButton />
      </nav>
    </header>
  );
}
