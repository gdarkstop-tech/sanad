/**
 * Draws the Android launcher icons.
 *
 * There is no image tooling in this repo and no reason to add one: the icon is
 * a handful of rectangles, and Chromium — already a dependency for the UI
 * checks — renders SVG to PNG perfectly well. Re-run after editing the mark.
 *
 *   node scripts/make-app-icon.mjs
 *
 * The mark is a pillar (sanad — a support) beside three lines of a transcript,
 * with the cited line picked out. That is the product in one glyph: text, and
 * the thing holding it up.
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';

const OUT = path.join(import.meta.dirname, '..', 'apps', 'mobile', 'assets');
const GROUND = '#0d1415';
const ACCENT = '#4dc4cd';
const SOFT = '#a3b3b3';

/** @param {number} scale 1 = fills the canvas; adaptive icons need the safe zone. */
function mark(scale) {
  const lines = [
    { y: 300, w: 420, fill: SOFT },
    { y: 460, w: 520, fill: ACCENT },
    { y: 620, w: 340, fill: SOFT },
  ];
  // The drawing's own bounds run x 240-920, y 270-770; centring it on the canvas
  // is what stops the mark sitting up and to the left inside the launcher circle.
  const dx = 512 - (240 + 920) / 2;
  const dy = 512 - (270 + 770) / 2;
  return `
    <g transform="translate(512 512) scale(${scale}) translate(${-512 + dx} ${-512 + dy})">
      <rect x="240" y="270" width="86" height="500" rx="43" fill="${ACCENT}"/>
      ${lines
        .map(
          (l) =>
            `<rect x="400" y="${l.y}" width="${l.w}" height="86" rx="43" fill="${l.fill}" opacity="${
              l.fill === ACCENT ? 1 : 0.55
            }"/>`,
        )
        .join('\n      ')}
    </g>`;
}

function svg({ background, scale }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
    ${background ? `<rect width="1024" height="1024" fill="${background}"/>` : ''}
    ${mark(scale)}
  </svg>`;
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });

for (const [name, options] of [
  // The launcher icon: full bleed on the app's own ground.
  ['icon.png', { background: GROUND, scale: 1 }],
  // The adaptive foreground is masked and zoomed by the launcher, so the mark
  // sits inside the safe zone and the ground colour comes from app.json.
  ['adaptive-icon.png', { background: null, scale: 0.62 }],
]) {
  await page.setContent(
    `<body style="margin:0;background:${options.background ?? 'transparent'}">${svg(options)}</body>`,
  );
  const png = await page.screenshot({ omitBackground: options.background === null });
  await writeFile(path.join(OUT, name), png);
  console.log(`wrote ${name}`);
}

await browser.close();
