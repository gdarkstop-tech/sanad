'use client';

import { useEffect } from 'react';

/**
 * Scrolls to a cited passage after the page loads.
 *
 * A citation link carries the anchor in the query string rather than the hash,
 * so the browser will not scroll on its own. Without this, opening
 * "week-4-slides.pdf — page 7" lands at the top of a long document and the
 * student has to go hunting for the sentence Sanad quoted — which is most of
 * the value of citing it in the first place.
 */
export function JumpToAnchor({ anchor }: { anchor: string }) {
  useEffect(() => {
    const target = document.getElementById(anchor);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [anchor]);

  return null;
}
