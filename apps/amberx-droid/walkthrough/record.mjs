// Records the AmberX walkthrough against the live app (phone layout), one video per chapter, each scene held until its
// voice clip (tts.mjs) ends. Adapted from the AmberX Tour recorder (/opt/amberx-tour/recorder/record.mjs).
// Privacy: signs in as the hub's recorder account in a context that is never recorded; the recorded pages get demo data
// only (demo-hub.mjs: seed notes + approvals, every write kept in the browser), password / key / vault fields are
// blurred, and each scene's visible text is saved to texts/ for the secrets scan (check.mjs --scan).
// Writes $OUT/raw/<chapter>.webm, $OUT/timeline.json, $OUT/shots/, $OUT/texts/.
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { loadWalkthrough } from './load.mjs';
import { APP, HUB, installDemoHub, installReadOnly } from './demo-hub.mjs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = process.env.OUT || '/out';
const { CHAPTERS, WALKTHROUGH } = await loadWalkthrough();
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
// RANDOM_LOOK=<chapter ids>: those chapters are recorded under a random design package (LOOK_POOL_B64: id -> slots, from
// rebuild.sh). Only this browser's copy of the hub's appearance document is rewritten, so the shared look never changes.
const RANDOM_LOOK = (process.env.RANDOM_LOOK || '').split(',').filter(Boolean);
const LOOK_POOL = (() => { try { return JSON.parse(Buffer.from(process.env.LOOK_POOL_B64 || '', 'base64').toString() || '{}'); } catch { return {}; } })();
let forcedLook = null; // { id, slots } while a RANDOM_LOOK chapter records
let lastLook = '';
function pickLook() {
  const ids = Object.keys(LOOK_POOL).filter((id) => id !== lastLook);
  if (!ids.length) return null;
  const id = ids[Math.floor(Math.random() * ids.length)]; lastLook = id;
  return { id, slots: LOOK_POOL[id] };
}
// Devices a chapter can be recorded on (chapter.device, default the walkthrough's): the phone layout with demo data, or
// a desktop browser for the console and axHub (read live, every write answered in the browser) and the explainer slides.
const DEVICES = {
  phone: { viewport: WALKTHROUGH.viewport ?? { width: 412, height: 915 }, isMobile: true, hasTouch: true, data: 'demo' },
  desktop: { viewport: WALKTHROUGH.desktop ?? { width: 1920, height: 1080 }, isMobile: false, hasTouch: false, data: 'read-only' },
};
const deviceOf = (ch) => (DEVICES[ch.device] ? ch.device : WALKTHROUGH.device && DEVICES[WALKTHROUGH.device] ? WALKTHROUGH.device : 'phone');
let VIEW = DEVICES.phone.viewport;
// The explainer slides (explainer.html next to this file, or in /rec in the recorder image) at a made-up origin.
export const EXPLAINER = 'https://walkthrough.local/';
const HERE = dirname(fileURLToPath(import.meta.url));
const sideHtml = (name) => { for (const d of [HERE, '/rec']) { try { return readFileSync(`${d}/${name}`, 'utf8'); } catch { /* next */ } } return '<!doctype html><title>missing</title>'; };
const explainerHtml = () => sideHtml('explainer.html');
// The staged designer mock of the demo video series (series/mock/build.mjs → designer-mock.html) at EXPLAINER + 'mock'.
const MOCK = `${EXPLAINER}mock`;
const mockHtml = () => sideHtml('designer-mock.html');
// Cards of the demo video series at EXPLAINER + 'card#<json>': a story b-roll slot, a Preview, a terminal line, a device
// that isn't a web page, the end card. Drawn on the video's skin (series/mock/tokens.json: the skins' --fx-* tokens).
const CARD = `${EXPLAINER}card`;
const skinVars = (() => {
  for (const d of [HERE, '/rec']) { try { return Object.fromEntries(JSON.parse(readFileSync(`${d}/series/mock/tokens.json`, 'utf8')).skins.map((k) => [k.id, k.vars])); } catch { /* next */ } }
  return {};
})();
const cardHtml = () => `<!doctype html><meta charset=utf-8><title>card</title><style id=vars></style><style>
html,body{margin:0;height:100%;background:var(--fx-bg);color:var(--fx-text);font-family:var(--fx-font)}
.c{box-sizing:border-box;height:100%;display:flex;flex-direction:column;justify-content:center;gap:calc(var(--fx-space) * 2);padding:calc(var(--fx-space) * 8)}
.k{align-self:flex-start;background:var(--fx-accent);color:var(--fx-accent-text);border-radius:var(--fx-radius-lg);padding:calc(var(--fx-space) / 2) calc(var(--fx-space) * 1.5);font-weight:700;letter-spacing:.04em;text-transform:uppercase}
.t{color:var(--fx-muted);font-size:calc(var(--fx-font-size) * 1.4)}
.x{font-family:var(--fx-font-display);font-size:calc(var(--fx-font-size) * 3);line-height:1.2;max-width:60ch}
.k[data-kind=terminal]+.t+.x{font-family:var(--fx-font-mono);background:var(--fx-surface);border-radius:var(--fx-radius-lg);padding:calc(var(--fx-space) * 2)}
</style><div class=c><div class=k id=k></div><div class=t id=t></div><div class=x id=x></div></div><script>
const VARS = ${JSON.stringify(skinVars)};
const LABEL = { story: 'B-roll', preview: 'Preview · not shipped yet', terminal: 'Terminal', device: 'On the device', end: 'AmberX in three minutes' };
function show() {
  let o = {}; try { o = JSON.parse(decodeURIComponent(location.hash.slice(1))); } catch {}
  const v = VARS[o.skin] || Object.values(VARS)[0] || {};
  document.getElementById('vars').textContent = ':root{' + Object.entries(v).map(([k, x]) => k + ':' + x).join(';') + '}';
  const k = document.getElementById('k'); k.textContent = LABEL[o.kind] || ''; k.dataset.kind = o.kind || '';
  document.getElementById('t').textContent = o.kind === 'end' ? '' : o.title || '';
  document.getElementById('x').textContent = o.kind === 'end' ? (o.title || '') + (o.text ? ' — ' + o.text : '') : o.text || '';
}
addEventListener('hashchange', show); show();
</script>`;
const SCALE = 2;
const durations = JSON.parse(readFileSync(`${OUT}/durations.json`, 'utf8'));
const seed = JSON.parse(readFileSync(`${OUT}/seed.json`, 'utf8'));
for (const d of ['raw', 'shots', 'texts']) mkdirSync(`${OUT}/${d}`, { recursive: true });

// A touch dot (phone layout: no mouse pointer) or a visible arrow cursor (desktop: the screencast has no pointer of its
// own), the highlight ring, and the privacy blur.
const CURSOR = {
  phone: '#wt-dot{position:fixed;left:-40px;top:-40px;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;background:rgba(255,170,40,.28);border:2px solid rgba(255,170,40,.9);z-index:2147483647;pointer-events:none;transition:left .35s ease,top .35s ease,transform .12s}',
  desktop: '#wt-dot{position:fixed;left:-40px;top:-40px;width:28px;height:28px;z-index:2147483647;pointer-events:none;transition:left .45s cubic-bezier(.3,.7,.3,1),top .45s cubic-bezier(.3,.7,.3,1),transform .12s;transform-origin:3px 3px;' +
    'background:no-repeat url("data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28"><path d="M3 2v20l5.5-5 3.6 8.4 3.4-1.5-3.6-8.2H19z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>') + '");' +
    'filter:drop-shadow(0 2px 3px rgba(0,0,0,.45))}' +
    '#wt-dot::after{content:"";position:absolute;left:-14px;top:-14px;width:32px;height:32px;border-radius:50%;border:3px solid rgba(255,176,46,.95);opacity:0;transform:scale(.4);transition:opacity .2s,transform .3s}' +
    '#wt-dot.press::after{opacity:1;transform:scale(1)}',
};
const pageSetup = (kind) => `addEventListener('DOMContentLoaded', () => {
  const st = document.createElement('style');
  st.textContent = 'input[type=password],[data-amberx-sensitive]{filter:blur(9px)!important}' +
    ${JSON.stringify(kind === 'desktop' ? CURSOR.desktop : CURSOR.phone)} +
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
// recording starts calm and the Home chapter opens the held call on purpose. Only when a chapter shows AmberX on the phone.
if (CHAPTERS.some((c) => deviceOf(c) === 'phone' && (!c.url || c.url.startsWith(APP)) && (!ONLY.length || ONLY.includes(c.id)))) {
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

// One recorded context per device for every chapter (so a popup seen once stays seen); each chapter is its own page =
// its own video.
const hubLog = [];
const contexts = {};
let demo = { blocked: [] };
async function contextFor(kind) {
  if (contexts[kind]) return contexts[kind];
  const d = DEVICES[kind];
  const c = await browser.newContext({
    viewport: d.viewport, deviceScaleFactor: kind === 'phone' ? SCALE : 1, isMobile: d.isMobile, hasTouch: d.hasTouch, storageState: `${OUT}/state.json`,
    // Playwright's screencast comes at the viewport's CSS size and is never scaled up (a bigger size only pads it), so
    // record at that size; assemble.mjs scales it. SCALE only sharpens the per-scene screenshots.
    recordVideo: { dir: `${OUT}/raw/tmp`, size: { width: d.viewport.width, height: d.viewport.height } },
    permissions: ['microphone'],
  });
  await c.addInitScript(pageSetup(kind));
  await c.route(`${EXPLAINER}**`, (route) => {
    const u = route.request().url();
    return route.fulfill({ status: 200, contentType: 'text/html', body: u.startsWith(MOCK) ? mockHtml() : u.startsWith(CARD) ? cardHtml() : explainerHtml() });
  });
  if (d.data === 'demo') demo = await installDemoHub(c, seed, hubLog);
  else await installReadOnly(c, hubLog);
  // Registered last so it wins: the appearance document as this recording should see it (RANDOM_LOOK chapters).
  await c.route(/\/data\/shared\/settings\/appearance\.json/, async (route) => {
    if (!forcedLook || route.request().method() !== 'GET') return route.fallback();
    const res = await route.fetch().catch(() => null);
    let doc = { $axf: 'appearance@1' };
    try { if (res && res.ok()) doc = await res.json(); } catch { /* keep the frame */ }
    doc.slots = { ...(doc.slots || {}), ...forcedLook.slots };
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'cache-control': 'no-store' }, body: JSON.stringify(doc) });
  });
  contexts[kind] = c;
  return c;
}

function helpers(page, log, kind = 'phone') {
  const soft = async (what, fn) => { try { await fn(); } catch (e) { log.push(`  ! ${what}: ${String(e.message).split('\n')[0].slice(0, 160)}`); } };
  const loc = (sel) => page.locator(sel).filter({ visible: true }).first();
  // The drawn pointer glides there; on desktop the real mouse follows, so hover states show as they would for a person.
  const dot = async (x, y, press = false) => {
    await page.evaluate(([x, y, press, desk]) => {
      const d = document.getElementById('wt-dot'); if (!d) return;
      d.style.left = `${x}px`; d.style.top = `${y}px`;
      if (desk) d.classList.toggle('press', press); else d.style.transform = press ? 'scale(.7)' : '';
    }, [x, y, press, kind === 'desktop']).catch(() => {});
    if (kind === 'desktop') await page.mouse.move(x, y, { steps: 8 }).catch(() => {});
  };
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
    // a page by address (a full URL, or a path / #route on the chapter's app)
    open: (to, base) => soft(`open ${to}`, async () => {
      await unring();
      await page.goto(new URL(to, base ?? page.url()).href, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(2500);
    }),
    // an explainer slide (explainer.html#<id>): steps reveal with h.step()
    slide: (id) => soft(`slide ${id}`, async () => {
      await unring();
      if (!page.url().startsWith(EXPLAINER)) { await page.goto(`${EXPLAINER}#${id}`, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(600); }
      else await page.evaluate((id) => { location.hash = id; }, id);
      await page.waitForTimeout(900);
    }),
    // a scene of the staged designer mock (designer-mock.html#<scene>?skin=&rows=…): steps play with h.step(); h.skin() re-renders it
    mock: (id, params = {}) => soft(`mock ${id}`, async () => {
      await unring();
      const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, Array.isArray(v) ? v.join(',') : String(v)])).toString();
      if (!page.url().startsWith(MOCK)) { await page.goto(`${MOCK}#${id}${qs ? `?${qs}` : ''}`, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(600); }
      else await page.evaluate(([id, params]) => window.wtMock?.scene(id, params), [id, params]);
      await page.waitForTimeout(900);
    }),
    // another live app in the same page (a desktop chapter moving from the console to axHub); nothing when it's already there
    app: (url) => soft(`app ${url}`, async () => {
      if (new URL(page.url()).origin === new URL(url).origin) return;
      await unring();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }); await page.waitForTimeout(3500);
    }),
    // a series card (story b-roll slot, Preview, terminal, device, end card) on the video's skin
    card: (o) => soft(`card ${o.kind}`, async () => {
      await unring();
      const href = `${CARD}#${encodeURIComponent(JSON.stringify(o))}`;
      if (!page.url().startsWith(CARD)) await page.goto(href, { waitUntil: 'domcontentloaded' });
      else await page.evaluate((h) => { location.hash = h; }, href.split('#')[1]);
      await page.waitForTimeout(600);
    }),
    skin: (id) => soft(`skin ${id}`, async () => { await page.evaluate((id) => window.wtMock?.skin(id), id); await page.waitForTimeout(900); }),
    step: () => soft('step', () => page.evaluate(() => window.wtStep?.())),
    steps: async (n, gap = 1400) => { for (let i = 0; i < n; i++) { await h.step(); await page.waitForTimeout(gap); } },
    // a view on a desktop AXF app (console, axHub): its nav link, else the banner search
    view: (name, label) => soft(`view ${name}`, async () => {
      await unring();
      const search = async () => {
        const q = page.locator('.fx-banner .fx-search input, .fx-search input').filter({ visible: true }).first();
        await q.click({ timeout: 4000 }); await q.fill(''); await q.pressSequentially(name, { delay: 40 }); await page.waitForTimeout(900); await q.press('Enter');
      };
      let l = page.locator(`[data-axf-view-link="${name}"], .fx-nav__item[title^="${name}"]`).filter({ visible: true }).first();
      if (await l.count()) {
        await ring(l, label ?? name); await page.waitForTimeout(700);
        // A nav link can be in the DOM and "visible" yet covered (a collapsed group, the highlight ring, a narrow
        // layout): fall back to a forced click, then to search, instead of leaving the scene on the wrong page.
        await l.click({ timeout: 4000 }).catch(async () => { await unring(); await l.click({ timeout: 2000, force: true }); }).catch(search);
      } else await search();
      await page.waitForTimeout(1800); await unring();
    }),
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

// The design package the app showed while the chapter was recorded (the runtime's applied-package setting, kept in the
// app's settings in localStorage); '' when none is applied or the page isn't an app.
async function designPackageOf(page) {
  return page.evaluate(() => {
    for (let i = 0; i < localStorage.length; i++) {
      try { const v = JSON.parse(localStorage.getItem(localStorage.key(i)) ?? 'null'); const id = v && typeof v === 'object' ? v['axf.appearance.design'] : null; if (typeof id === 'string' && id) return id; } catch { /* not JSON */ }
    }
    return '';
  }).catch(() => '');
}

const timeline = [];
for (const ch of CHAPTERS) {
  if (ONLY.length && !ONLY.includes(ch.id)) continue;
  const kind = deviceOf(ch);
  VIEW = DEVICES[kind].viewport;
  const ctx = await contextFor(kind);
  forcedLook = RANDOM_LOOK.includes(ch.id) ? pickLook() : null;
  const page = await ctx.newPage();
  const t0 = Date.now();
  const log = [`## ${ch.id}${forcedLook ? ` (look: ${forcedLook.id})` : ''}`];
  const h = helpers(page, log, kind);
  await page.goto(ch.url ?? WALKTHROUGH.url, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch((e) => log.push(`  ! open: ${e.message}`));
  await page.waitForTimeout(5000);
  const look = forcedLook ? forcedLook.id : await designPackageOf(page);
  if (ch.start && ch.start !== 'home' && kind === 'phone') await h.go(ch.start);
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
    scenes.push({ i, start, end, dur, say: s.say, ...(s.plan ? { plan: s.plan } : {}) });
    writeFileSync(`${OUT}/texts/${ch.id}-${i}.txt`, await visibleText(page));
    await page.screenshot({ path: `${OUT}/shots/${ch.id}-${i}.jpg`, quality: 60 }).catch(() => {});
    log.push(`  ${i} ${start.toFixed(1)}-${end.toFixed(1)}s`);
  }
  const video = page.video();
  await page.close();
  renameSync(await video.path(), `${OUT}/raw/${ch.id}.webm`);
  timeline.push({ id: ch.id, title: ch.title, device: kind, viewport: VIEW, lead, scenes, look, recordedAt: new Date().toISOString() });
  console.log(log.join('\n'));
}
for (const c of Object.values(contexts)) await c.close();
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
