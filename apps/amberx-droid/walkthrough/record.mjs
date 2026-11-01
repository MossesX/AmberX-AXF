// Records the AmberX walkthrough against the live app (phone layout), one video per chapter, each scene held until its
// voice clip (tts.mjs) ends. Adapted from the AmberX Tour recorder (/opt/amberx-tour/recorder/record.mjs).
// Privacy: signs in as the hub's recorder account in a context that is never recorded; the recorded pages get demo data
// only (demo-hub.mjs: seed notes + approvals, every write kept in the browser), password / key / vault fields are
// blurred, and each scene's visible text is saved to texts/ for the secrets scan (check.mjs --scan).
// Writes $OUT/raw/<chapter>.webm, $OUT/timeline.json, $OUT/shots/, $OUT/texts/.
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { loadWalkthrough } from './load.mjs';
import { HUB, installDemoHub } from './demo-hub.mjs';

const OUT = process.env.OUT || '/out';
const { CHAPTERS, WALKTHROUGH } = await loadWalkthrough();
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
const VIEW = WALKTHROUGH.viewport;
const SCALE = 2;
const durations = JSON.parse(readFileSync(`${OUT}/durations.json`, 'utf8'));
const seed = JSON.parse(readFileSync(`${OUT}/seed.json`, 'utf8'));
for (const d of ['raw', 'shots', 'texts']) mkdirSync(`${OUT}/${d}`, { recursive: true });

// A touch dot (phone layout: no mouse pointer), the highlight ring, and the privacy blur.
const PAGE_SETUP = `addEventListener('DOMContentLoaded', () => {
  const st = document.createElement('style');
  st.textContent = 'input[type=password],[data-amberx-sensitive]{filter:blur(9px)!important}' +
    '#wt-dot{position:fixed;left:-40px;top:-40px;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;background:rgba(255,170,40,.28);border:2px solid rgba(255,170,40,.9);z-index:2147483647;pointer-events:none;transition:left .35s ease,top .35s ease,transform .12s}' +
    '#wt-ring{position:fixed;z-index:2147483646;pointer-events:none;border:3px solid #ffb02e;border-radius:10px;box-shadow:0 0 0 4000px rgba(0,0,0,.28),0 0 18px #ffb02e;transition:all .3s ease}' +
    '#wt-tag{position:fixed;z-index:2147483647;pointer-events:none;background:#ffb02e;color:#1b1203;font:700 14px/1.2 system-ui,sans-serif;padding:5px 9px;border-radius:8px;white-space:nowrap}';
  document.head.appendChild(st);
  const d = document.createElement('div'); d.id = 'wt-dot'; document.body.appendChild(d);
});`;

const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });

// Sign in once, never recorded. The password only ever goes into the hub's own form.
{
  const ctx = await browser.newContext({ viewport: VIEW });
  const page = await ctx.newPage();
  await page.goto(`${HUB}/auth/login?rd=/`, { waitUntil: 'domcontentloaded' });
  await page.fill('#u', process.env.HUB_USER || '');
  await page.fill('#p', process.env.HUB_PASS || '');
  await page.click("form[action='/auth/login'] button");
  await page.waitForURL((u) => !u.pathname.startsWith('/auth/login'), { timeout: 20000 });
  await ctx.storageState({ path: `${OUT}/state.json` });
  await ctx.close();
}

// Warm-up, never recorded: AmberX opens each new approval in a popup once. Let them all pop and close them here, so the
// recording starts calm and the Home chapter opens the held call on purpose.
{
  const ctx = await browser.newContext({ viewport: VIEW, isMobile: true, hasTouch: true, storageState: `${OUT}/state.json` });
  await installDemoHub(ctx, seed, []);
  const page = await ctx.newPage();
  await page.goto(WALKTHROUGH.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  for (let t = 0; t < 8; t++) {
    await page.waitForTimeout(2500);
    const c = page.getByRole('button', { name: 'Close dialog' }).filter({ visible: true });
    while (await c.count()) { await c.last().click({ timeout: 2000 }).catch(() => {}); await page.waitForTimeout(300); }
  }
  await ctx.storageState({ path: `${OUT}/state.json` });
  await ctx.close();
}

// One recorded context for every chapter (so a popup seen once stays seen); each chapter is its own page = its own video.
const ctx = await browser.newContext({
  viewport: VIEW, deviceScaleFactor: SCALE, isMobile: true, hasTouch: true, storageState: `${OUT}/state.json`,
  // Playwright's screencast comes at the viewport's CSS size and is never scaled up (a bigger size only pads it), so
  // record at that size; assemble.mjs scales it to 720×1600. SCALE only sharpens the per-scene screenshots.
  recordVideo: { dir: `${OUT}/raw/tmp`, size: { width: VIEW.width, height: VIEW.height } },
  permissions: ['microphone'],
});
await ctx.addInitScript(PAGE_SETUP);
const hubLog = [];
const demo = await installDemoHub(ctx, seed, hubLog);

function helpers(page, log) {
  const soft = async (what, fn) => { try { await fn(); } catch (e) { log.push(`  ! ${what}: ${String(e.message).split('\n')[0].slice(0, 160)}`); } };
  const loc = (sel) => page.locator(sel).filter({ visible: true }).first();
  const dot = (x, y, press = false) => page.evaluate(([x, y, press]) => {
    const d = document.getElementById('wt-dot'); if (!d) return;
    d.style.left = `${x}px`; d.style.top = `${y}px`; d.style.transform = press ? 'scale(.7)' : '';
  }, [x, y, press]).catch(() => {});
  const unring = () => page.evaluate(() => { document.getElementById('wt-ring')?.remove(); document.getElementById('wt-tag')?.remove(); }).catch(() => {});
  const ring = async (l, label) => {
    await l.scrollIntoViewIfNeeded({ timeout: 4000 });
    const b = await l.boundingBox();
    if (!b) return null;
    await page.evaluate(([b, label, vw]) => {
      const pad = 5;
      let r = document.getElementById('wt-ring'); if (!r) { r = document.createElement('div'); r.id = 'wt-ring'; document.body.appendChild(r); }
      Object.assign(r.style, { left: `${b.x - pad}px`, top: `${b.y - pad}px`, width: `${b.width + pad * 2}px`, height: `${b.height + pad * 2}px` });
      let t = document.getElementById('wt-tag'); if (!t) { t = document.createElement('div'); t.id = 'wt-tag'; document.body.appendChild(t); }
      t.textContent = label || ''; t.style.display = label ? '' : 'none';
      const below = b.y + b.height + pad + 8;
      t.style.top = `${below + 30 < innerHeight ? below : Math.max(4, b.y - pad - 34)}px`;
      t.style.left = `${Math.max(6, Math.min(b.x, vw - 10 - Math.min(260, label.length * 8 + 20)))}px`;
    }, [b, label ?? '', VIEW.width]);
    await dot(b.x + Math.min(b.width / 2, 60), b.y + b.height / 2);
    return b;
  };
  const h = {
    wait: (ms) => page.waitForTimeout(ms),
    hl: (sel, label) => soft(`hl ${sel}`, async () => { await ring(loc(sel), label); }),
    click: (sel, label) => soft(`click ${sel}`, async () => {
      const l = loc(sel); const b = await ring(l, label);
      await page.waitForTimeout(700);
      if (b) await dot(b.x + Math.min(b.width / 2, 60), b.y + b.height / 2, true);
      await l.click({ timeout: 5000 });
      await page.waitForTimeout(250); if (b) await dot(b.x + Math.min(b.width / 2, 60), b.y + b.height / 2);
      await page.waitForTimeout(900);
    }),
    type: (sel, text) => soft(`type ${sel}`, async () => { const l = loc(sel); await ring(l, ''); await l.click({ timeout: 4000 }); await l.pressSequentially(text, { delay: 45 }); }),
    clear: (sel) => soft(`clear ${sel}`, async () => { await loc(sel).fill(''); }),
    scroll: (dy) => soft('scroll', async () => {
      await unring();
      await page.mouse.move(VIEW.width / 2, VIEW.height / 2);
      for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, dy / 6); await page.waitForTimeout(70); }
      await page.waitForTimeout(300);
    }),
    navScroll: (dx) => soft('nav scroll', () => page.evaluate((dx) => document.querySelector('.fx-region--nav')?.scrollBy({ left: dx, behavior: 'smooth' }), dx)),
    // close whatever popped up (approval popups, sheets), never by deciding anything
    calm: () => soft('calm', async () => {
      await unring();
      for (let i = 0; i < 5; i++) {
        const c = page.getByRole('button', { name: 'Close dialog' }).filter({ visible: true });
        if (!(await c.count())) break;
        await c.last().click({ timeout: 2000 }); await page.waitForTimeout(350);
      }
    }),
    go: (title) => soft(`go ${title}`, async () => {
      await h.calm();
      const t = title === 'home' ? 'Home' : title;
      const l = page.locator(`.fx-nav__item[title="${t}"]`).first();
      await l.scrollIntoViewIfNeeded({ timeout: 4000 });
      const b = await l.boundingBox(); if (b) await dot(b.x + b.width / 2, b.y + b.height / 2, true);
      await l.evaluate((e) => e.click());
      await page.waitForTimeout(1600);
      await h.calm();
    }),
    // the held call's popup as it shows when a call first arrives: forget that it was shown (this browser only) and reload
    openHeld: () => soft('held popup', async () => {
      await h.calm();
      await page.evaluate((id) => {
        const k = 'approvals-banner.opened';
        localStorage.setItem(k, (localStorage.getItem(k) || '').split(',').filter((x) => x && x !== id).join(','));
      }, seed.approvals.pending.find((p) => p.status === 'held')?.id ?? '');
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.getByText(/until axHub runs it/).first().waitFor({ timeout: 9000 });
    }),
    // Settings is a drill-down list that remembers where it was: back up ("Back to …", "All settings") until the row is
    // on screen, then open it
    settingsTab: (name) => soft(`settings tab ${name}`, async () => {
      const row = () => page.locator('main button').filter({ visible: true }).filter({ hasText: new RegExp(`^\\s*${name}`) }).first();
      for (let i = 0; i < 4 && !(await row().count()); i++) {
        const back = page.locator('main').getByRole('button', { name: /^(All settings|Back to )/ }).filter({ visible: true });
        if (!(await back.count())) break;
        await back.first().click({ timeout: 3000 }); await page.waitForTimeout(800);
      }
      const l = row();
      await ring(l, name); await page.waitForTimeout(600); await l.click({ timeout: 4000 }); await page.waitForTimeout(1500); await unring();
    }),
    level: (label) => soft(`level ${label}`, async () => {
      const sel = page.locator('main select').filter({ visible: true }).first();
      await ring(sel, label); await page.waitForTimeout(700);
      await sel.selectOption({ label }); await page.waitForTimeout(1200);
    }),
    settings: async (tab, sub) => { await h.go('Settings'); await h.settingsTab(tab); if (sub) await h.settingsTab(sub); },
    menu: (top) => soft(`menu ${top}`, async () => {
      await h.calm();
      await page.keyboard.press('Escape'); await page.waitForTimeout(300);
      const l = page.getByRole('button', { name: top, exact: true }).first();
      await l.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
      await ring(l, top); await page.waitForTimeout(500);
      await l.click({ timeout: 4000, force: true }); await page.waitForTimeout(1200);
    }),
  };
  return h;
}

const visibleText = (page) => page.evaluate(() => {
  const out = [];
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  for (let n = walk.currentNode; n; n = walk.nextNode()) {
    if (n.tagName === 'INPUT' || n.tagName === 'TEXTAREA') { const r = n.getBoundingClientRect(); if (r.height > 0 && n.type !== 'password') out.push(n.value); }
  }
  return `${document.body.innerText}\n${out.join('\n')}`;
}).catch(() => '');

const timeline = [];
for (const ch of CHAPTERS) {
  if (ONLY.length && !ONLY.includes(ch.id)) continue;
  const page = await ctx.newPage();
  const t0 = Date.now();
  const log = [`## ${ch.id}`];
  const h = helpers(page, log);
  await page.goto(WALKTHROUGH.url, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch((e) => log.push(`  ! open: ${e.message}`));
  await page.waitForTimeout(5000);
  if (ch.start && ch.start !== 'home') await h.go(ch.start);
  const lead = (Date.now() - t0) / 1000;
  const scenes = [];
  for (let i = 0; i < ch.scenes.length; i++) {
    const s = ch.scenes[i];
    const dur = durations[`${ch.id}-${i}`] ?? 3;
    const start = (Date.now() - t0) / 1000;
    await Promise.race([s.act(h), page.waitForTimeout(Math.max(9000, dur * 1000))]).catch((e) => log.push(`  ! act ${i}: ${e.message}`));
    const left = start + dur + 0.6 - (Date.now() - t0) / 1000;
    if (left > 0) await page.waitForTimeout(left * 1000);
    const end = (Date.now() - t0) / 1000;
    scenes.push({ i, start, end, dur, say: s.say });
    writeFileSync(`${OUT}/texts/${ch.id}-${i}.txt`, await visibleText(page));
    await page.screenshot({ path: `${OUT}/shots/${ch.id}-${i}.jpg`, quality: 60 }).catch(() => {});
    log.push(`  ${i} ${start.toFixed(1)}-${end.toFixed(1)}s`);
  }
  const video = page.video();
  await page.close();
  renameSync(await video.path(), `${OUT}/raw/${ch.id}.webm`);
  timeline.push({ id: ch.id, title: ch.title, lead, scenes });
  console.log(log.join('\n'));
}
await ctx.close();
await browser.close();
rmSync(`${OUT}/state.json`, { force: true });
rmSync(`${OUT}/raw/tmp`, { recursive: true, force: true });
// ONLY=a,b re-records those chapters and keeps the rest of the last timeline
let merged = timeline;
if (ONLY.length) {
  let old = []; try { old = JSON.parse(readFileSync(`${OUT}/timeline.json`, 'utf8')); } catch { /* first run */ }
  merged = CHAPTERS.map((c) => timeline.find((t) => t.id === c.id) ?? old.find((t) => t.id === c.id)).filter(Boolean);
}
writeFileSync(`${OUT}/timeline.json`, JSON.stringify(merged, null, 1));
writeFileSync(`${OUT}/demo-hub.log`, [...new Set(hubLog)].join('\n'));
console.log(`demo hub: ${demo.blocked.length} writes and unplanned reads kept in the browser (demo-hub.log)`);
