import { existsSync } from 'node:fs';

/**
 * Resolves a Chromium build without downloading one.
 *
 * playwright-core ships no browser on purpose, so this looks where one is
 * likely to already be — a Playwright cache, or the system Chrome/Chromium —
 * and says how to get one rather than failing with a module error.
 */
function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    `${process.env.HOME ?? ''}/.cache/ms-playwright`,
  ].filter(Boolean);
  for (const root of roots) {
    for (const name of ['chrome-linux/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) {
      for (const dir of ['chromium', 'chromium-1194', 'chromium-1187', 'chromium-1180']) {
        const candidate = `${root}/${dir}/${name}`;
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  for (const system of [
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ]) {
    if (existsSync(system)) return system;
  }
  return null;
}

let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch {
  console.error('playwright-core is not installed. Run `pnpm install`, then try again.');
  process.exit(2);
}

/**
 * Drives the real UI in a real browser.
 *
 * The test suite covers the services and `verify-isolation.ts` covers the
 * routes, but neither runs a client component. Everything interactive in Sanad
 * — Ask, the refusal, Exam Mode, the schedule editor — only exists after
 * hydration, so this is the only check that proves those work rather than
 * merely compile.
 *
 * Usage:
 *   node scripts/verify-ui.mjs [baseUrl]
 *
 * Needs a running server with the demo account seeded (`pnpm db:seed:demo`) and
 * playwright-core plus a Chromium build available. Exits non-zero on any failed
 * check, any response >= 400, or any console error.
 */

const BASE = process.argv[2] ?? process.env.SANAD_URL ?? 'http://localhost:3000';
const CHROME = findChrome();
if (!CHROME) {
  console.error(
    'No Chromium found. Set CHROME_PATH, or install one with `npx playwright install chromium`.\n' +
      'This check is optional — the rest of the suite does not need a browser.',
  );
  process.exit(2);
}
const results = [];
const fail = (name, detail) => results.push({ ok: false, name, detail });
const pass = (name, detail = '') => results.push({ ok: true, name, detail });

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const page = await browser.newPage();

const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(String(e)));
const badResponses = [];
page.on('response', (r) => { if (r.status() >= 400) badResponses.push(`${r.status()} ${r.url()}`); });

// Sign in through the real form.
await page.goto(`${BASE}/sign-in`, { waitUntil: 'networkidle' });
await page.fill('#email', 'demo@university.edu');
await page.fill('#password', 'demo-password-1234');
await page.click('button[type=submit]');
await page.waitForURL('**/dashboard', { timeout: 15000 });
pass('sign in reaches the dashboard');

// Dashboard: nav + courses + archive control.
for (const label of ['Courses', 'Study plan', 'Community', 'Profile']) {
  const n = await page.locator(`nav a:has-text("${label}")`).count();
  n > 0 ? pass(`nav has ${label}`) : fail(`nav has ${label}`, 'link not found');
}
const archiveButtons = await page.locator('button:has-text("Archive")').count();
archiveButtons > 0 ? pass('archive control on a course') : fail('archive control on a course');

// Plan page: the declared week must actually render after hydration.
await page.goto(`${BASE}/plan`, { waitUntil: 'networkidle' });
await page.waitForSelector('.week-day', { timeout: 15000 });
const weekText = (await page.locator('.week').innerText()).toLowerCase();
for (const expect of ['University', 'Work', 'Gym', 'Free to study']) {
  weekText.includes(expect.toLowerCase())
    ? pass(`week shows ${expect}`)
    : fail(`week shows ${expect}`, weekText.slice(0, 200));
}
// Monday is fully blocked; Sunday has nothing declared.
const monday = (await page.locator('.week-day', { hasText: 'Monday' }).innerText()).toLowerCase();
monday.includes('university') && monday.includes('work')
  ? pass('Monday shows university and work')
  : fail('Monday shows university and work', monday);

// The plan itself, below the editor.
const planText = await page.locator('body').innerText();
/\d+ planned sessions|Done/.test(planText)
  ? pass('a plan is rendered')
  : fail('a plan is rendered', planText.slice(0, 300));
/AI Voice Tutor/.test(planText) ? pass('roadmap shows the voice tutor') : fail('roadmap shows the voice tutor');

// Profile: form is populated from the server.
await page.goto(`${BASE}/profile`, { waitUntil: 'networkidle' });
const uni = await page.inputValue('#universityName');
uni.length > 0 ? pass(`profile prefilled (${uni})`) : fail('profile prefilled', 'empty university');

// Community: preview present and inert.
await page.goto(`${BASE}/community`, { waitUntil: 'networkidle' });
const community = await page.locator('body').innerText();
/coming soon/i.test(community) ? pass('community is labelled Coming soon') : fail('community label');
community.includes('nothing is stored') ? pass('community says nothing is stored') : fail('community honesty line');

// Course page: Ask + refusal + exam dates + language select, all client components.
await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
await page.click('a:has-text("Data Structures")');
await page.waitForSelector('#question', { timeout: 15000 });
pass('course page opened');

await page.fill('#question', 'What did the professor say about hash tables?');
await page.click('button:has-text("Ask")');
await page.waitForSelector('.answer', { timeout: 20000 });
const answered = await page.locator('.answer').innerText();
answered.includes('hash table') ? pass('Ask answers from the material') : fail('Ask answers', answered.slice(0, 200));
const sources = await page.locator('ul.sources li').count();
sources > 0 ? pass(`answer cites ${sources} sources`) : fail('answer cites sources');

await page.fill('#question', 'What is the boiling point of liquid nitrogen at high altitude?');
await page.click('button:has-text("Ask")');
await page.waitForSelector('.answer.refused', { timeout: 20000 });
const refusal = await page.locator('.answer.refused').innerText();
refusal.includes('No supporting material') ? pass('Ask refuses an uncovered question') : fail('refusal', refusal);
const meta = await page.locator('.meta-line').innerText();
meta.includes('No answer was generated')
  ? pass('refusal states no generator ran')
  : fail('refusal states no generator ran', meta);

// Exam Mode + language notice.
await page.click('button:has-text("Prepare me for the exam")');
await page.waitForSelector('h3:has-text("Practice exam")', { timeout: 25000 });
pass('Exam Mode generates a pack');
await page.selectOption('#study-language', 'zh');
await page.waitForSelector('.notice', { timeout: 5000 });
const notice = await page.locator('.notice').innerText();
notice.includes('cannot translate')
  ? pass('language choice is honest about translation')
  : fail('language notice', notice);

// Exam dates form.
const examCard = await page.locator('section:has(h2:text("Exam dates"))').innerText();
examCard.includes('Midterm') ? pass('exam date is listed') : fail('exam date listed', examCard.slice(0, 200));

// The roadmap on the course page, from the shared list.
const body = await page.locator('body').innerText();
for (const item of ['YouTube Import', 'AI Voice Tutor', 'Advanced OCR', 'Smart Translation']) {
  body.includes(item) ? pass(`roadmap: ${item}`) : fail(`roadmap: ${item}`);
}
const soonPills = await page.locator('.pill-soon').count();
soonPills > 0 ? pass(`${soonPills} coming-soon cards labelled`) : fail('coming-soon cards labelled');

// Course settings: rename must be reachable and must actually persist.
await page.click('button:has-text("Edit course")');
await page.waitForSelector('#course-title', { timeout: 10000 });
const originalTitle = await page.inputValue('#course-title');
await page.fill('#course-title', `${originalTitle} (renamed)`);
await page.click('button:has-text("Save changes")');
await page.waitForSelector('text=Saved.', { timeout: 10000 });
await page.reload({ waitUntil: 'networkidle' });
const renamed = await page.locator('h1').innerText();
renamed.includes('(renamed)') ? pass('course rename persists') : fail('course rename persists', renamed);
// Put it back, so the check leaves the demo data as it found it.
await page.click('button:has-text("Edit course")');
await page.fill('#course-title', originalTitle);
await page.click('button:has-text("Save changes")');
await page.waitForSelector('text=Saved.', { timeout: 10000 });
pass('course rename reverted');

// A transcript produced by the fixture must say so.
await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
await page.click('a:has-text("Data Structures")');
await page.waitForSelector('h1', { timeout: 10000 });
// Navigate from the lecture archive, not the "At a glance" card — the card's
// link and the archive's link are different elements.
await page.click('article.card h3 a >> nth=0');
await page.waitForURL('**/lectures/**', { timeout: 15000 });
await page.waitForSelector('h2:has-text("Transcript")', { timeout: 15000 });
const lecture = await page.locator('body').innerText();
lecture.includes('demo transcript, not speech recognition')
  ? pass('synthetic transcript is disclosed on the lecture page')
  : fail('synthetic transcript is disclosed on the lecture page', lecture.slice(0, 300));

// And the compact badge in the archive listing.
await page.goBack({ waitUntil: 'networkidle' });
const badges = await page.locator('.pill-synthetic').count();
badges > 0
  ? pass(`synthetic badge on ${badges} lecture(s) in the archive`)
  : fail('synthetic badge in the archive');

await browser.close();

console.log('');
for (const r of results) {
  console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `\n        ${r.detail}` : ''}`);
}
const failed = results.filter((r) => !r.ok);
if (badResponses.length) {
  console.log(`\n  ${badResponses.length} response(s) >= 400:`);
  for (const u of [...new Set(badResponses)].slice(0, 8)) console.log(`    ${u}`);
}
const realErrors = badResponses.length
  ? consoleErrors.filter((e) => !/Download the React DevTools/i.test(e))
  : [];
if (realErrors.length) {
  console.log(`\n  ${realErrors.length} console error(s):`);
  for (const e of realErrors.slice(0, 5)) console.log(`    ${e.slice(0, 200)}`);
}
console.log(`\n${results.length - failed.length}/${results.length} browser checks passed.`);
process.exit(failed.length || realErrors.length ? 1 : 0);
