#!/usr/bin/env node
/**
 * The console stays put over a refresh (build fix-refreshing-console-jumps-back): Playwright against the console,
 * desktop and phone. Brett goes deep into a screen (Libraries → Library templates → a category → a template), scrolls
 * down, and the page is refreshed every way it can be:
 *
 *   1. a plain reload (the browser's, the phone's pull-down, the Android app's own);
 *   2. a refresh pushed from the server (console-commands `refresh`, the real stream message), soft;
 *   3. the same, hard (caches cleared, `?axf-refresh=` in the address for one load);
 *   4. a pull-down at the top of the page (the drag itself must save the place: a WebView may skip pagehide).
 *
 * After each one the same screen, tab, category, selected template and scroll offset must be back, must stay (no late
 * jump to the top), and the page must still scroll under a real wheel / touch gesture. Then: a deep link
 * (`?axf-open=`) wins over the saved place and becomes the place, a second browser tab starts on its own place, and
 * leftover scroll locks (inline overflow / pointer-events / inert / a fixed body) are cleared when the page is shown.
 *
 *   node scripts/place-refresh.e2e.mjs              (build first: npm run build; serves dist/ with vite preview)
 *   PLACE_E2E_URL=http://127.0.0.1:7461/            (test a running console instead; its /api is still mocked)
 *   PLACE_E2E_PORT=7098 · PW_CHROMIUM=<chromium path> · PLAYWRIGHT_DIR=<dir with node_modules/playwright>
 *   PLACE_E2E_SHOTS=<dir>                           (desktop + phone screenshots: before and after each refresh)
 *
 * The backend is mocked: /api/me as admin with no axHub, /api/plugins with console-commands on and its stream held
 * open by the test (that is how the refresh is pushed), everything else answers 404 (the views read dist/data).
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = join(APP, '../..');
const PORT = Number(process.env.PLACE_E2E_PORT) || 7098;
const SHOTS = process.env.PLACE_E2E_SHOTS || '';
const PLACE_KEY = 'axf:console:place@1';
/** Pixels an offset may be off by: banners arriving above the pane move it a little (scroll anchoring). */
const SLACK = 4;
/** A load whose data shows up later than this (ms after navigation start) is past what the scroll restore waits for. */
const LATE_MS = 4000;

let playwright;
for (const base of [APP, ROOT, process.env.PLAYWRIGHT_DIR, '/tmp/sc-pw', '/tmp/axf-pw-overlay'].filter(Boolean)) { try { playwright = createRequire(join(base, 'node_modules', 'x.js'))('playwright'); break; } catch { try { playwright = createRequire(join(base, 'x.js'))('playwright'); break; } catch { /* next */ } } }
if (!playwright) { try { playwright = await import('playwright'); } catch { console.error('playwright not found (npm i -D playwright, or PLAYWRIGHT_DIR)'); process.exit(2); } }

const ME = { wall: false, hub: '', appearanceHub: 'off', user: null, admin: true, role: 'admin', themes: true, plugins: [] };
const PLUGINS = { items: [{ folder: 'console-commands', id: 'console-commands', name: 'Console commands', enabled: true, server: 'loaded', error: null }] };
const VIEWPORTS = {
  // short on purpose: one category of templates is a short page, and the test needs room to scroll
  desktop: { viewport: { width: 1280, height: 480 }, deviceScaleFactor: 1 },
  phone: { viewport: { width: 390, height: 560 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};

let checks = 0;
const ok = (c, what) => { if (!c) throw new Error(`✗ ${what}`); checks++; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The mocked backend of one browser tab. The console-commands stream is held open; `push(fields)` sends one
 * console-command@1 message down it (waiting for the tab to connect first) and resolves with the tab's ack.
 */
async function mockBackend(page) {
  const held = [];
  const waiting = [];
  let seq = 0;
  const acks = new Map();
  const frame = (m) => `event: message\ndata: ${JSON.stringify(m)}\n\n`;
  const send = (route, m) => route.fulfill({ status: 200, contentType: 'text/event-stream', body: `: connected\n\n${frame(m)}` });
  await page.route('**/api/**', async (r) => {
    const req = r.request();
    const u = new URL(req.url());
    const json = (body, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (u.pathname === '/api/me') return json(ME);
    if (u.pathname === '/api/plugins') return json(PLUGINS);
    if (req.method() === 'GET' && u.pathname === '/api/events') return r.abort();
    if (u.pathname === '/api/plugins/console-commands/stream') {
      const m = waiting.shift();
      if (m) return send(r, m).catch(() => undefined);
      held.push(r); // answered by the next push; a reload drops it
      return undefined;
    }
    if (u.pathname === '/api/plugins/console-commands/ack') {
      let body = {};
      try { body = req.postDataJSON() ?? {}; } catch { /* not JSON */ }
      acks.get(body.id)?.(body);
      return json({ ok: true });
    }
    if (u.pathname.startsWith('/api/plugins/console-commands/')) return json({ ok: true });
    // 404 = no backend: the views read dist/data at once. (A 5xx would put every read behind the console's back-off,
    // and data that takes longer than the restore's give-up time is, by design, not scrolled back to.)
    return json({ ok: false, detail: 'no backend (e2e)' }, 404);
  });
  return {
    async push(fields) {
      const m = { $axf: 'console-command@1', id: `e2e-${++seq}-${Date.now().toString(36)}`, by: 'e2e', at: new Date().toISOString(), ...fields };
      const acked = new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(`✗ the console never acked the pushed ${fields.op}`)), 30_000);
        acks.set(m.id, (body) => { clearTimeout(t); resolve(body); });
      });
      // the newest held request is the live page's; older ones belong to pages that are gone
      let sent = false;
      while (held.length && !sent) { const route = held.pop(); try { await send(route, m); sent = true; } catch { /* that page is gone */ } }
      held.length = 0;
      if (!sent) waiting.push(m);
      return acked;
    },
  };
}

const ready = (page) => page.waitForFunction(() => typeof window.axfConsoleControl === 'function' && typeof window.axfConsoleControlState === 'function' && !!document.querySelector('.fx-main'), null, { timeout: 30_000, polling: 100 });

/** Where the person is, read from what the page shows: screen, the open tab, category, selected template, scroll. */
const placeOf = (page) => page.evaluate(() => {
  const visible = (el) => !!el && el.getClientRects().length > 0;
  const main = [...document.querySelectorAll('.fx-main')].filter(visible).pop() ?? null;
  const scroller = main && main.scrollHeight > main.clientHeight + 1 ? main : document.scrollingElement;
  const inner = [...document.querySelectorAll('.fx-main [data-axf-view]')].filter(visible).pop() ?? null;
  const chips = [...(inner?.querySelectorAll('button.fx-chip.is-selected') ?? [])].filter(visible).map((c) => c.textContent.trim());
  return {
    view: window.axfConsoleControlState().screen,
    shown: inner?.getAttribute('data-axf-view') ?? null,
    tab: chips[0] ?? null,
    category: chips[1] ?? null,
    selected: inner?.querySelector('.lt-card.is-selected strong')?.textContent.trim() ?? null,
    scrollTop: Math.round(scroller?.scrollTop ?? 0),
  };
});

/** How far the main pane can scroll, and scroll it there (as the person would have: a scroll event fires). */
const scrollMain = (page, top) => page.evaluate((y) => {
  const main = [...document.querySelectorAll('.fx-main')].filter((el) => el.getClientRects().length > 0).pop();
  const scroller = main && main.scrollHeight > main.clientHeight + 1 ? main : document.scrollingElement;
  scroller.scrollTo({ top: y, behavior: 'instant' });
  return { top: Math.round(scroller.scrollTop), max: scroller.scrollHeight - scroller.clientHeight };
}, top);

/**
 * Wait until the page shows `want` (the restore retries while data loads), then make sure it stays there.
 *
 * The restore gives up on scroll after PLACE_RESTORE_TIMEOUT (5 s, src/views/placeRestore.ts) by design. On a machine
 * busy enough that the screen's data shows up later than that, everything but the offset is back and the offset is
 * still saved (so the refresh did save it): that load is reported, the pane is scrolled back there and the page
 * reloaded (at most twice), so putting the offset back is checked on a timely load.
 */
async function expectPlace(page, want, what) {
  let got = null;
  const rest = (p) => p && same({ ...p, scrollTop: 0 }, { ...want, scrollTop: 0 });
  const near = (p) => rest(p) && Math.abs(p.scrollTop - want.scrollTop) <= SLACK;
  for (let attempt = 0; ; attempt++) {
    for (let i = 0; i < 100; i++) { got = await placeOf(page).catch(() => null); if (near(got)) break; await sleep(100); }
    if (near(got) || attempt >= 2 || !rest(got)) break;
    const contentAt = await page.evaluate(() => window.__placeE2E?.contentAt ?? null);
    const kept = (await saved(page))?.scroll?.['view:libraries/scroll:main']?.top ?? 0;
    if (!(contentAt > LATE_MS) || Math.abs(kept - want.scrollTop) > SLACK) break;
    console.log(`  ${what}: the data took ${(contentAt / 1000).toFixed(1)} s to show (busy machine, past the restore's give-up time); the offset was still saved, scrolling there and reloading once more`);
    await scrollMain(page, want.scrollTop); // the next reload saves what is on screen
    await sleep(400);
    await page.reload();
    await ready(page);
  }
  ok(near(got), `${what}: the place is back (want ${JSON.stringify(want)}, got ${JSON.stringify(got)}, saved ${JSON.stringify(await saved(page).catch(() => null))})`);
  await sleep(1200); // past the restore's settle time and any late scroll-to-top
  got = await placeOf(page);
  ok(near(got), `${what}: the place stays (want ${JSON.stringify(want)}, got ${JSON.stringify(got)}, saved ${JSON.stringify(await saved(page).catch(() => null))})`);
}

/** A real scroll gesture over the main pane (wheel on the desktop, a finger drag on the phone) must move it, then put it back. */
async function expectScrolls(page, form, what) {
  const before = (await placeOf(page)).scrollTop;
  const { max } = await scrollMain(page, before);
  const down = max - before >= before; // towards the side with more room
  const box = await page.evaluate(() => { const r = [...document.querySelectorAll('.fx-main')].filter((el) => el.getClientRects().length > 0).pop().getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; });
  if (form === 'phone') {
    // a finger drag, point by point (headless Chromium does not run the synthesized scroll gesture for touch)
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x, y: box.y }] });
    for (let k = 1; k <= 10; k++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: box.x, y: box.y + (down ? -15 : 15) * k }] }); await sleep(16); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  } else {
    await page.mouse.move(box.x, box.y);
    await page.mouse.wheel(0, down ? 150 : -150);
  }
  let after = before;
  for (let i = 0; i < 30 && Math.abs(after - before) < 40; i++) { await sleep(100); after = (await placeOf(page)).scrollTop; }
  ok(down ? after > before + 40 : after < before - 40, `${what}: the page still scrolls (${before} → ${after} of ${max})`);
  // nothing on the way holds the pointer or the page
  const locks = await page.evaluate(() => [document.documentElement, document.body, document.getElementById('root')].map((el) => { const s = getComputedStyle(el); return el.hasAttribute('inert') || s.pointerEvents === 'none' || s.position === 'fixed'; }));
  ok(!locks.includes(true), `${what}: no lock on the page roots`);
  await scrollMain(page, before);
  await sleep(350); // the offset is saved again (debounced)
}

const saved = (page) => page.evaluate((k) => JSON.parse(sessionStorage.getItem(k) ?? 'null'), PLACE_KEY);
const shot = async (page, name) => { if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: join(SHOTS, `place-refresh-${name}.png`) }); } };

/** Pick a template card that is not the selected one (the n-th such), by clicking it. Returns its name. */
const pickTemplate = (page, n = 0) => page.evaluate(async (i) => {
  const cards = [...document.querySelectorAll('.lt-card:not(.is-selected)')].filter((el) => el.getClientRects().length > 0);
  const card = cards[Math.min(i, cards.length - 1)];
  card.click();
  // its details are drawn (the page is another height now) before anything is measured
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null))));
  return card.querySelector('strong').textContent.trim();
}, n);

let server = null;
const stop = () => { try { server?.kill('SIGTERM'); } catch { /* gone */ } };
process.on('exit', stop);

let browser;
try {
  let base = process.env.PLACE_E2E_URL;
  if (!base) {
    server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { cwd: APP, stdio: 'ignore' });
    base = `http://127.0.0.1:${PORT}/`;
  }
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { try { up = (await fetch(base)).ok; } catch { await sleep(500); } }
  ok(up, `console at ${base} (is dist/ built?)`);
  browser = await playwright.chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});

  for (const [form, opts] of Object.entries(VIEWPORTS)) {
    const context = await browser.newContext(opts);
    // when the screen's data first showed, per page load (see expectPlace)
    await context.addInitScript(() => {
      const mark = { contentAt: null };
      window.__placeE2E = mark;
      const seen = () => { if (mark.contentAt === null && document.querySelector('.lt-card')) { mark.contentAt = Math.round(performance.now()); observer.disconnect(); } };
      const observer = new MutationObserver(seen);
      observer.observe(document, { childList: true, subtree: true });
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const backend = await mockBackend(page);
    await page.goto(base);
    await ready(page);
    const start = (await placeOf(page)).view;
    ok(start && start !== 'libraries', `${form}: a first visit opens the start screen (${start})`);

    /* ---- go deep: Libraries → Library templates → a category → a template, scrolled down ---- */
    const opened = await page.evaluate(() => window.axfConsoleControl({ verb: 'open', address: 'view:libraries' }));
    ok(opened?.ok, `${form}: Libraries opens (${JSON.stringify(opened).slice(0, 200)})`);
    await page.locator('.fx-main button.fx-chip', { hasText: 'Library templates' }).click();
    await page.waitForFunction(() => !!document.querySelector('.lt-card'), null, { timeout: 15_000, polling: 100 });
    // the category with the most templates (not "All"), so there is more than one row to choose from
    const category = await page.evaluate(async () => {
      const chips = [...document.querySelectorAll('.fx-main button.fx-chip')].filter((c) => c.getClientRects().length > 0).slice(4); // 3 tabs + "All"
      let best = null;
      for (const chip of chips) {
        chip.click();
        await new Promise((r) => requestAnimationFrame(() => r(null)));
        const count = document.querySelectorAll('.lt-card').length;
        if (!best || count > best.count) best = { chip, count, name: chip.textContent.trim() };
      }
      best.chip.click();
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      return { name: best.name, count: best.count };
    });
    ok(category.count >= 2, `${form}: a template category is picked (${JSON.stringify(category)})`);
    const template = await pickTemplate(page, 5);
    const room = await scrollMain(page, 0);
    ok(room.max >= 120, `${form}: the screen is long enough to scroll (${room.max}px)`);
    await scrollMain(page, Math.round(room.max * 0.7));
    await sleep(400); // the debounced save
    const deep = await placeOf(page);
    ok(deep.view === 'libraries' && deep.shown === 'libraries' && deep.tab === 'Library templates' && deep.category === category.name && deep.selected === template && deep.scrollTop >= 80,
      `${form}: deep in a screen (${JSON.stringify(deep)})`);
    const stored = await saved(page);
    ok(stored?.view === 'view:libraries' && stored.scroll?.['view:libraries/scroll:main']?.top === deep.scrollTop, `${form}: the place is saved as it changes (${JSON.stringify(stored)})`);
    await shot(page, `${form}-1-before`);

    /* ---- 1. a plain reload ---- */
    await page.reload();
    await ready(page);
    await expectPlace(page, deep, `${form} reload`);
    await expectScrolls(page, form, `${form} reload`);
    await shot(page, `${form}-2-after-reload`);

    /* ---- 2. a refresh pushed from the server, soft: changed a moment before it arrives ---- */
    const template2 = await pickTemplate(page, 0);
    await scrollMain(page, Math.round((await scrollMain(page, 0)).max * 0.4)); // the other template: the page is another height
    const soft = await placeOf(page);
    ok(soft.selected === template2 && soft.scrollTop >= 30 && soft.scrollTop !== deep.scrollTop, `${form} pushed refresh: another template and offset first (${JSON.stringify(soft)})`);
    let loaded = page.waitForEvent('load', { timeout: 30_000 });
    let ack = await backend.push({ op: 'refresh' }); // no wait for the debounce: the refresh itself must save
    ok(ack.ok === true && /keeping the place/.test(String(ack.message)), `${form} pushed refresh: acked before the page goes (${JSON.stringify({ ok: ack.ok, message: ack.message })})`);
    await loaded;
    await ready(page);
    await expectPlace(page, soft, `${form} pushed refresh`);
    await expectScrolls(page, form, `${form} pushed refresh`);
    await shot(page, `${form}-3-after-pushed-refresh`);

    /* ---- 3. the same, hard ---- */
    const template3 = await pickTemplate(page, 1);
    await scrollMain(page, Math.round((await scrollMain(page, 0)).max * 0.9));
    const hard = await placeOf(page);
    ok(hard.selected === template3 && hard.scrollTop >= 30, `${form} pushed hard refresh: another template and offset first (${JSON.stringify(hard)})`);
    loaded = page.waitForEvent('load', { timeout: 30_000 });
    ack = await backend.push({ op: 'refresh', hard: true });
    ok(ack.ok === true, `${form} pushed hard refresh: acked`);
    await loaded;
    await ready(page);
    await expectPlace(page, hard, `${form} pushed hard refresh`);
    ok(!new URL(page.url()).searchParams.has('axf-refresh'), `${form} pushed hard refresh: the one-time value is out of the address (${page.url()})`);
    await expectScrolls(page, form, `${form} pushed hard refresh`);

    /* ---- 4. pull-down at the top of the page: the drag saves, before any reload ---- */
    if (opts.hasTouch) {
      await scrollMain(page, 0);
      await sleep(400);
      const pulled = await page.evaluate((key) => {
        const read = () => JSON.parse(sessionStorage.getItem(key) ?? 'null');
        const cards = [...document.querySelectorAll('.lt-card:not(.is-selected)')];
        const card = cards[cards.length - 1];
        card.click(); // a change the debounce has not written yet
        const name = card.querySelector('strong').textContent.trim();
        const target = document.querySelector('.fx-pagehead') ?? document.querySelector('.fx-main');
        const r = target.getBoundingClientRect();
        const x = Math.round(r.left + 40), y = Math.round(r.top + 10);
        const touch = (dy) => new Touch({ identifier: 1, target, clientX: x, clientY: y + dy, pageX: x, pageY: y + dy });
        const fire = (type, dy, end = false) => target.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, composed: true, touches: end ? [] : [touch(dy)], targetTouches: end ? [] : [touch(dy)], changedTouches: [touch(dy)] }));
        const before = read();
        fire('touchstart', 0);
        fire('touchmove', 6);
        const short = read(); // not a pull yet
        fire('touchmove', 48);
        const after = read(); // read in the same task: only the drag can have written it
        fire('touchend', 48, true);
        return { name, before: before?.selection?.['view:libraries/list:libraries.templates'], short: short?.selection?.['view:libraries/list:libraries.templates'], after: after?.selection?.['view:libraries/list:libraries.templates'], view: after?.view };
      }, PLACE_KEY);
      ok(same(pulled.before, pulled.short), `${form} pull-down: a few pixels are not a pull (${JSON.stringify(pulled)})`);
      ok(!same(pulled.before, pulled.after) && pulled.after?.length === 1 && pulled.view === 'view:libraries', `${form} pull-down: the drag saved the place at once (${JSON.stringify(pulled)})`);
      const top = { ...deep, selected: pulled.name, scrollTop: 0 };
      await expectScrolls(page, form, `${form} pull-down let go`); // a pull that did not refresh leaves the page scrolling
      await scrollMain(page, 0);
      await sleep(350);
      await page.reload(); // the browser's pull-to-refresh is a plain reload
      await ready(page);
      await expectPlace(page, top, `${form} pull-down refresh`);
      await expectScrolls(page, form, `${form} pull-down refresh`);
      await shot(page, `${form}-4-after-pull-down`);
    }

    /* ---- leftover locks are cleared when the page is shown again (after an update, from the back/forward cache) ---- */
    const cleared = await page.evaluate(async () => {
      const root = document.getElementById('root');
      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
      document.body.style.pointerEvents = 'none';
      document.body.style.position = 'fixed';
      root.style.touchAction = 'none';
      root.setAttribute('inert', '');
      document.body.classList.add('axf-dnd-dragging');
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null))));
      return { html: document.documentElement.style.overflow, body: `${document.body.style.overflow}|${document.body.style.pointerEvents}|${document.body.style.position}`, root: root.style.touchAction, inert: root.hasAttribute('inert'), drag: document.body.classList.contains('axf-dnd-dragging') };
    });
    ok(same(cleared, { html: '', body: '||', root: '', inert: false, drag: false }), `${form}: leftover scroll locks are cleared when the page is shown (${JSON.stringify(cleared)})`);
    await expectScrolls(page, form, `${form} after leftover locks`);

    /* ---- a second browser tab keeps its own place ---- */
    const other = await context.newPage();
    await mockBackend(other);
    await other.goto(base);
    await ready(other);
    await sleep(600);
    ok((await placeOf(other)).view === start, `${form}: another tab starts on the start screen, not on this tab's place`);
    await other.close();
    await page.bringToFront(); // a tab left in the background draws no frames

    /* ---- a deep link wins over the saved place, and becomes the place ---- */
    await scrollMain(page, Math.round((await scrollMain(page, 0)).max * 0.9));
    await sleep(400);
    const beforeLink = await placeOf(page);
    ok(beforeLink.scrollTop >= 60, `${form} deep link: Libraries is left scrolled down (${beforeLink.scrollTop})`);
    await page.goto(`${base}?axf-open=${encodeURIComponent('view:tracker')}`);
    await ready(page);
    await page.waitForFunction(() => window.axfConsoleControlState().screen === 'tracker', null, { timeout: 15_000, polling: 100 }).catch(() => undefined);
    await sleep(800);
    let linked = await placeOf(page);
    ok(linked.view === 'tracker' && linked.shown === 'tracker', `${form} deep link: the link's screen opens, not the saved one (${JSON.stringify(linked)})`);
    ok(linked.scrollTop < beforeLink.scrollTop / 2, `${form} deep link: the saved scroll of another screen is not applied (${linked.scrollTop}, Libraries was at ${beforeLink.scrollTop})`);
    await page.reload();
    await ready(page);
    await sleep(800);
    linked = await placeOf(page);
    ok(linked.view === 'tracker', `${form} deep link: a reload stays where the link went (${JSON.stringify(linked)})`);
    // going back to Libraries by hand finds its tab, category and template as they were left
    await page.evaluate(() => window.axfConsoleControl({ verb: 'open', address: 'view:libraries' }));
    await page.waitForFunction(() => !!document.querySelector('.lt-card.is-selected'), null, { timeout: 15_000, polling: 100 });
    const back = await placeOf(page);
    ok(back.tab === beforeLink.tab && back.category === beforeLink.category && back.selected === beforeLink.selected, `${form}: back on Libraries its tab, category and template are as they were (${JSON.stringify(back)})`);

    ok(!errors.length, `${form}: no page errors (${errors.slice(0, 3).join(' | ')})`);
    await context.close();
    console.log(`✓ ${form}: reload, pushed refresh (soft and hard)${opts.hasTouch ? ', pull-down' : ''} and a deep link keep the place; the page scrolls after each`);
  }
  console.log(`place-refresh e2e: ${checks} checks passed`);
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  if (SHOTS) for (const [i, p] of (browser?.contexts() ?? []).flatMap((c) => c.pages()).entries()) await shot(p, `failed-${i}`).catch(() => undefined);
  process.exitCode = 1;
} finally {
  await browser?.close();
  stop();
}
