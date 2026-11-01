// UI check for the Walkthrough entry and player on the live AmberX (signed in as the recorder account, demo data only,
// like record.mjs) after a recording is published. Phone (412×915) and desktop (1280×800):
// Home shows the Walkthrough card, the AmberX menu and Help list it, the player loads every chapter from chapters.json,
// a chapter jump seeks the video, captions are attached. Saves screenshots for UI Review.
//   UI_CHECK=1 bash rebuild.sh   (runs it after publishing), or in the recorder image: OUT=/out node ui-check.mjs
import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';
import { HUB, installDemoHub } from './demo-hub.mjs';

const BASE = process.env.BASE || 'https://amberx.amberxai.com/';
const OUT = process.env.OUT || '/out';
const seed = JSON.parse(readFileSync(`${OUT}/seed.json`, 'utf8'));
const index = JSON.parse(readFileSync(`${OUT}/publish/chapters.json`, 'utf8'));
mkdirSync(`${OUT}/ui`, { recursive: true });
let failed = 0;
const ok = (cond, what) => { console.log(`${cond ? '  ✓' : '  ✗'} ${what}`); if (!cond) failed++; };

const browser = await chromium.launch();
let state;
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${HUB}/auth/login?rd=/`, { waitUntil: 'domcontentloaded' });
  await page.fill('#u', process.env.HUB_USER || '');
  await page.fill('#p', process.env.HUB_PASS || '');
  await page.click("form[action='/auth/login'] button");
  await page.waitForURL((u) => !u.pathname.startsWith('/auth/login'), { timeout: 20000 });
  state = await ctx.storageState();
  await ctx.close();
}
for (const [name, view, mobile] of [['phone', { width: 412, height: 915 }, true], ['desktop', { width: 1280, height: 800 }, false]]) {
  console.log(`## ${name}`);
  const ctx = await browser.newContext({ viewport: view, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1, storageState: state });
  await installDemoHub(ctx, seed, []);
  await ctx.addInitScript(() => { try { localStorage.setItem('approvals-banner.autoOpen', 'off'); } catch { /* fine */ } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  const card = page.getByRole('button', { name: 'Watch the walkthrough' }).first();
  ok(await card.isVisible().catch(() => false) || (await card.count()) > 0, 'Home shows the Walkthrough card');
  await card.scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/ui/home-card-${name}.png` });
  const items = {};
  for (const m of ['AmberX', 'Help']) {
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: m, exact: true }).first().click({ force: true, timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(700);
    items[m] = await page.locator('[role=menuitem]').allInnerTexts();
    if (m === 'Help') await page.screenshot({ path: `${OUT}/ui/help-menu-${name}.png` });
  }
  await page.keyboard.press('Escape');
  ok(items.AmberX?.some((t) => t.startsWith('Walkthrough')), 'AmberX menu lists Walkthrough');
  ok(items.Help?.some((t) => t.startsWith('Watch the walkthrough')), 'Help lists Watch the walkthrough');
  await page.keyboard.press('Escape');
  await card.evaluate((e) => e.click());
  await page.waitForSelector('.axp-walkthrough__chapter', { timeout: 10000 }).catch(() => {});
  ok(await page.getByRole('heading', { name: 'AmberX walkthrough' }).isVisible(), 'the player page opens');
  ok((await page.locator('.axp-walkthrough__chapter').count()) === index.chapters.length, `the player lists all ${index.chapters.length} chapters`);
  ok((await page.locator('.axp-walkthrough__tick').count()) === index.chapters.length, 'chapter marks on the timeline');
  ok((await page.locator('video track[kind=captions]').count()) === 1, 'captions attached');
  // Playwright's Chromium has no H.264 decoder (Chrome and Android's WebView do), so check what the server sends instead
  const v = await page.request.get(new URL('api/walkthrough/walkthrough.mp4', BASE).href, { headers: { range: 'bytes=0-1023' } });
  ok(v.status() === 206 && v.headers()['content-type'] === 'video/mp4' && (await v.body()).length === 1024, `the video streams from /api/walkthrough/ (${v.status()}, Range)`);
  ok(await page.locator('video').evaluate((e) => e.poster.endsWith('/api/walkthrough/poster.jpg')), 'the poster is the recorded one');
  const third = index.chapters[2];
  await page.locator('.axp-walkthrough__chapter').nth(2).locator('.axp-walkthrough__jump').first().click();
  await page.waitForTimeout(800);
  const t = await page.locator('video').evaluate((v) => { v.pause(); return v.currentTime; });
  ok(Math.abs(t - third.start) < 1.5, `a chapter jump seeks the video (${t.toFixed(1)}s, chapter at ${third.start}s)`);
  ok(await page.getByText(`Chapter 3 of ${index.chapters.length}`).isVisible(), 'now playing shows the chapter');
  await page.locator('video').evaluate((v) => { v.currentTime = 4; });
  await page.waitForTimeout(1200);
  await page.evaluate(() => { scrollTo(0, 0); document.querySelectorAll('main, .fx-main__inner').forEach((e) => e.scrollTo(0, 0)); });
  await page.screenshot({ path: `${OUT}/ui/player-${name}.png` });
  ok(!errors.length, `no page errors${errors.length ? `: ${errors[0]}` : ''}`);
  await ctx.close();
}
await browser.close();
console.log(failed ? `✗ ${failed} UI check(s) failed` : '✓ walkthrough UI checks passed');
process.exit(failed ? 1 : 0);
