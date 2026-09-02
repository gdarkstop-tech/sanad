import Link from 'next/link';
import { SignOutButton } from '@/components/SignOutButton';

/** One header for every signed-in page, so navigation is not per-page guesswork. */
export function AppNav({ name, current }: { name: string; current: string }) {
  // Five entries, in the order a student's day runs: their courses, finding
  // something in them, the plan around them, the roadmap, their account.
  // Search and Exam Mode also live inside a course, because that is where they
  // are scoped — a top-level Exam Mode would need a course picker first.
  const items = [
    { href: '/dashboard', label: 'Courses' },
    { href: '/search', label: 'Search' },
    { href: '/plan', label: 'Study plan' },
    { href: '/saved', label: 'Saved' },
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
