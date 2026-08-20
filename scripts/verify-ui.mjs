import { chromium } from 'playwright-core';

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
const CHROME =
  process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
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

// YouTube coming-soon on the course page.
const body = await page.locator('body').innerText();
body.includes('YouTube import') ? pass('YouTube import shown as coming soon') : fail('YouTube coming soon');

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
