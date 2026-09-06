import type { ReactNode } from 'react';
import { currentUser } from '@/lib/auth';
import './globals.css';

export const metadata = {
  title: 'Sanad',
  description: 'AI academic companion',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
};

/** Right-to-left locales. Adding one is a list entry, not a code change. */
const RTL_LOCALES = new Set(['ar', 'he', 'fa', 'ur']);

export default async function RootLayout({ children }: { children: ReactNode }) {
  const user = await currentUser().catch(() => null);
  const locale = user?.interfaceLocale ?? process.env.DEFAULT_LOCALE ?? 'en';
  const dir = RTL_LOCALES.has(locale.split('-')[0] ?? '') ? 'rtl' : 'ltr';

  return (
    <html lang={locale} dir={dir}>
      {/*
        Extensions like Grammarly add their own attributes to <body> before
        React hydrates, and React reports the difference as an error. It is
        their edit, not ours, and nothing downstream is affected — but a red
        console error during a demo is read as a broken app. This suppresses
        the warning for this element's own attributes only; mismatches in the
        page below are still reported.
      */}
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
