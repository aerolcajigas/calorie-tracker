// Renders icon.html -> icon-32/180/192/512.png, then drives the app at iPhone size against a MOCK API (3 months of fake
// entries in memory; add/update/remove/settings/scan all fake). Nothing touches the real sheet or the AI.
//   node Calories/web/preview.mjs [outDir]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../JobHunt/applybot/package.json', import.meta.url));
const { chromium } = require('playwright-core');
const here = (f) => new URL(f, import.meta.url);
const out = process.argv[2] || here('./').pathname.replace(/^\/([A-Za-z]:)/, '$1');
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
const iconHtml = readFileSync(here('./icon.html'), 'utf8');
for (const size of [180, 192, 512, 32]) {
  const p = await browser.newPage({ viewport: { width: size, height: size } });
  await p.setContent(iconHtml.replace('<body>', `<body style="zoom:${size / 512}">`), { waitUntil: 'networkidle' });
  writeFileSync(here(`./icon-${size}.png`), await p.screenshot());
  if (size === 512) writeFileSync(`${out}/icon-preview-512.png`, await p.screenshot());
  await p.close();
}

// Fake history: ~85 of the last 90 "my days", 3-5 foods each, eaten 1 PM to 5 AM Manila.
const foods = [['Chicken adobo with rice', '🍗', 615], ['Pandesal, 3 pcs', '🥖', 270], ['Iced coffee', '🧋', 180], ['Sinigang na baboy with rice', '🍲', 720],
  ['Jollibee Chickenjoy 1 pc + rice', '🍗', 560], ['Banana', '🍌', 105], ['Pancit canton', '🍜', 470], ['Siopao asado', '🥟', 320], ['Cup noodles', '🍜', 290]];
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const iso = (ms) => new Date(ms + 8 * 3600e3).toISOString().slice(0, 19) + '+08:00';
const entries = [];
const dayStartMs = (() => { const now = Date.now(); const m = new Date(now + 8 * 3600e3 - 10 * 3600e3); m.setUTCHours(0, 0, 0, 0); return m.getTime() - 8 * 3600e3 + 10 * 3600e3; })();
for (let d = 90; d >= 0; d--) {
  if (d > 0 && rnd() < 0.06) continue;
  const n = d === 0 ? 2 : 3 + Math.floor(rnd() * 3), base = dayStartMs - d * 86400e3;
  for (let i = 0; i < n; i++) {
    const [food, emoji, kcal] = foods[Math.floor(rnd() * foods.length)];
    const t = base + (3 + i * (16 / n) + rnd() * 2) * 3600e3; // 1 PM onward
    if (t > Date.now()) continue;
    entries.push({ id: `fake-${d}-${i}`, time: iso(t), food, kcal: Math.round(kcal * (0.85 + rnd() * 0.5)), emoji, portion: '', items: [], source: 'typed' });
  }
}
// A saved food added long ago must still show in Recent (saved foods always show), without counting toward a day.
const state = { entries, settings: { goal: 2000, dayStart: 10 },
  foods: [{ id: 'saved-burrito', time: '2026-01-01T12:00:00+08:00', food: 'Homemade burrito', kcal: 400, emoji: '🌯', portion: '', items: [] }] };
const calls = [];
const SCAN = { ok: true, title: 'Chicken adobo with rice', emoji: '🍗', confidence: 'medium', costUsd: 0.0005,
  note: 'Assumed about 1.5 cups of rice and skin-on chicken; more rice or oil would raise the total.',
  items: [{ name: 'White rice, cooked', portion: '1.5 cups', grams: 250, kcal: 325 }, { name: 'Chicken adobo, skin-on', portion: 'about 4 pcs', grams: 150, kcal: 290 }], kcal: 615 };

const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await ctx.route('https://cal.test/**', async (route) => {
  const url = new URL(route.request().url());
  if (url.pathname === '/api/cal') {
    const { action, p } = JSON.parse(route.request().postData() || '{}');
    calls.push(action);
    if (action === 'scan') { await new Promise((r) => setTimeout(r, 1200)); return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ r: SCAN }) }); }
    if (action === 'add') state.entries.push(...p.entries.filter((e) => !state.entries.some((x) => x.id === e.id)));
    if (action === 'update') state.entries = state.entries.map((x) => (x.id === p.entry.id ? p.entry : x));
    if (action === 'remove') state.entries = state.entries.filter((x) => x.id !== p.id);
    if (action === 'settings') state.settings = { goal: p.goal, dayStart: p.dayStart };
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ r: { ok: true, ...state } }) });
  }
  const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  try { return route.fulfill({ body: readFileSync(here('./' + file)), contentType: file.endsWith('.html') ? 'text/html' : undefined }); }
  catch { return route.fulfill({ status: 404, body: '' }); }
});
const page = await ctx.newPage();
const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const shot = async (name, full = false) => { await page.waitForTimeout(450); await page.screenshot({ path: `${out}/shot-${name}.png`, fullPage: full }); };
const check = (label, ok) => console.log(ok ? 'PASS' : 'FAIL', label);

await page.goto('https://cal.test/');
await page.waitForSelector('.entry');
await shot('day');
const tabs = await page.locator('.tabs').boundingBox();
check('tab bar sits on the bottom edge', Math.abs(tabs.y + tabs.height - 852) < 1);
const rows = await page.locator('.rc').evaluateAll((els) => els.map((e) => e.getBoundingClientRect()));
check('recent is a vertical list of 5', rows.length === 5 && rows.every((r, i) => !i || (r.top > rows[i - 1].top && r.left === rows[0].left)));
await page.locator('#moreRecent').tap();
check('saved food shows in Recent (Show all)', (await page.locator('.rc', { hasText: 'Homemade burrito' }).count()) === 1 && (await page.locator('.rc').count()) > 5);
await shot('day-all');
await page.locator('#moreRecent').tap();

// One tap on a recent food adds it; the total goes up.
const before = await page.locator('.entry').count();
await page.locator('.rc').first().tap();
await page.waitForTimeout(300);
check('recent tap adds an entry', (await page.locator('.entry').count()) === before + 1);
await shot('day-added');

// Photo: the form opens at once, the AI fills it in, every field stays editable.
await page.setInputFiles('#file', { name: 'food.jpg', mimeType: 'image/jpeg', buffer: readFileSync(here('./icon-512.png')) });
await page.waitForTimeout(250);
await shot('photo-reading');
await page.fill('#fFood', 'My adobo'); // typed while the AI was still reading: must survive
await page.waitForSelector('.ainote b');
check('AI filled calories (615)', (await page.inputValue('#fKcal')) === '615');
check('typed name kept over AI title', (await page.inputValue('#fFood')) === 'My adobo');
await shot('photo-filled');
await page.locator('.it .kin').first().fill('500'); // edit the rice line
check('editing a line updates the total', (await page.inputValue('#fKcal')) === '790');
check('amount slider starts at 100%', (await page.inputValue('#fAmt')) === '100' && (await page.textContent('#fPct')) === '100%');
await page.locator('#fAmt').fill('50');
check('slider at 50% halves the total', (await page.inputValue('#fKcal')) === '395' && (await page.textContent('#fPct')) === '50%');
await shot('photo-slider');
await page.locator('#fFull').tap();
check('tapping 100% resets it', (await page.inputValue('#fKcal')) === '790');
await page.locator('#fAmt').fill('50');
await page.fill('#fKcal', '420'); // own number wins
check('typed calories shows the breakdown hint', await page.locator('#fUseSum').isVisible());
await shot('photo-edited');
await page.locator('#fSave').tap();
await page.waitForTimeout(300);
check('photo entry saved with typed calories', state.entries.some((e) => e.food === 'My adobo' && e.kcal === 420 && e.items.length === 2));

// Type it in: picking a recent name fills its calories.
await page.locator('#typeBtn').tap(); await page.waitForTimeout(400);
await page.fill('#fFood', 'Banana');
await page.dispatchEvent('#fFood', 'input');
check('recent name fills calories', (await page.inputValue('#fKcal')) !== '');
await shot('typed');
await page.locator('[data-close]').tap(); await page.waitForTimeout(400);

// Edit + remove an entry.
await page.locator('.entry').first().tap(); await page.waitForTimeout(400);
await shot('edit');
await page.locator('#fDel').tap(); await page.locator('#fDel').tap(); await page.waitForTimeout(300);
check('remove sends remove', calls.includes('remove'));

// Trends.
await page.locator('[data-tab="trends"]').tap(); await page.waitForTimeout(500);
await shot('trends');
await page.evaluate(() => document.querySelector('#scroll').scrollTo(0, 99999)); await shot('trends-bottom');
await page.evaluate(() => document.querySelector('#scroll').scrollTo(0, 0));
const box = await page.locator('#plot').boundingBox();
await page.mouse.move(box.x + box.width * 0.7, box.y + 100);
await shot('trends-tip');
await page.locator('[data-r="30"]').tap();
await shot('trends-1m');

await page.locator('#gear').tap(); await shot('settings');
await page.goto('https://cal.test/pin.html'); await shot('pin');
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
