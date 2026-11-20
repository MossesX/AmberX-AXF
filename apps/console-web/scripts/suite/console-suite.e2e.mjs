#!/usr/bin/env node
/**
 * The console test suite, end to end: a real browser (Playwright) on a real console server (the live console's image,
 * sandboxed by sandbox.mjs: no route out), so every request, stream and console command takes the path it takes on
 * the live console.
 *
 *   node scripts/suite/console-suite.e2e.mjs --root <checkout copy with dist/> [--label before] [--out <dir>]
 *        [--url <a running sandbox>] [--only startup,screens,tabs,settings,dialogs,commands] [--phone] [--keep]
 *        [--proxy h2|none]   h2 (default): the browser reaches the server over HTTP/2 + TLS as on the live console;
 *                            none: plain HTTP/1.1 (six connections per host, so held-open streams queue the rest)
 *
 * Sections
 *   startup   cold load and three reloads: time to first paint and to a working console, the /api calls fired in the
 *             first 10 s, how many run at once, the streams held open, calls still unanswered after 10 s, page errors
 *   screens   every screen in the control inventory: open, no page error, the page still draws, screenshot
 *   tabs      every tab of every screen-bound tab row in the inventory: open it, the row reports it
 *   settings  every Settings tab and Settings → Plugins sub-tab
 *   dialogs   every dialog the console announces (GET /api/console/list?kind=dialogs): open, screenshot, close
 *   commands  the console commands over the real relay (REST → server → stream → console → ack): clients, where,
 *             list, open (by name and by address), settings, dialog open/close, back, home, action, screenshot
 *             (whole page, an address, a selector, a bad selector), refresh (soft and hard: the page comes back and
 *             answers again) and a timing run of ten screenshots in a row
 * Every check is recorded (pass/fail, time, detail); the suite never stops at the first failure. Writes
 * <out>/<label>/results.json and shots/, prints a summary, exits 1 when a check failed.
 */
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { up, down } from './sandbox.mjs';
import { startH2Proxy } from './h2proxy.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '../..');
const args = process.argv.slice(2);
const opt = (k, d = '') => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const LABEL = opt('label', 'before');
const ROOT = resolve(opt('root', join(APP, '../..')));
const OUT = join(opt('out', '/tmp/axf-suite/out'), LABEL);
const SHOTS = join(OUT, 'shots');
const ONLY = new Set((opt('only', 'startup,screens,tabs,settings,dialogs,commands')).split(','));
const PHONE = args.includes('--phone');

/** What a console that starts and answers well keeps to. */
export const LIMITS = {
  readyMs: 10_000, // first load → the console's control executor answers
  firstPaintMs: 4_000,
  settleMs: 20_000, // no /api call (streams aside) in flight for a second
  burstAtOnce: 12, // /api calls in flight at the same moment during startup
  callsFirst10s: 60,
  openStreams: 2, // long-lived streams one console tab holds (HTTP/1.1 allows 6 connections per host)
  openMs: 8_000, // a screen, tab or dialog drawn after it was asked for
  commandMs: 15_000, // a console command answered over the relay
  shotMs: 15_000, // a console screenshot answered with an image
};

let playwright;
for (const base of [APP, join(APP, '../..'), process.env.PLAYWRIGHT_DIR, '/tmp/sc-pw'].filter(Boolean)) { try { playwright = createRequire(join(base, 'x.js'))('playwright'); break; } catch { /* next */ } }
if (!playwright) { console.error('playwright not found (PLAYWRIGHT_DIR=<dir with node_modules/playwright>)'); process.exit(2); }

const results = { label: LABEL, root: ROOT, at: new Date().toISOString(), limits: LIMITS, sections: {}, checks: [] };
const record = (section, name, ok, detail = '', ms = undefined) => {
  results.checks.push({ section, name, ok: !!ok, ...(ms !== undefined ? { ms: Math.round(ms) } : {}), ...(detail ? { detail: String(detail).slice(0, 600) } : {}) });
  if (!ok) console.log(`  ✗ [${section}] ${name}${detail ? ` — ${String(detail).slice(0, 240)}` : ''}`);
  return !!ok;
};
const slug = (s) => s.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 90);
const inventory = JSON.parse(readFileSync(join(ROOT, 'apps/console-web/src/control/inventory.json'), 'utf8'));

mkdirSync(SHOTS, { recursive: true });
let sandbox = null;
let URL_ = opt('url');
if (!URL_) { sandbox = await up({ root: ROOT, name: `axf-suite-e2e-${LABEL}` }); URL_ = sandbox.url; }
const proxy = opt('proxy', 'h2') === 'h2' ? await startH2Proxy(URL_) : null;
const PAGE_URL = proxy?.url ?? URL_; // what the browser opens; REST commands go to the server direct
results.server = URL_; results.page = PAGE_URL; results.http = proxy ? 'h2' : 'http/1.1';
console.log(`console suite (${LABEL}) on ${URL_} (browser: ${PAGE_URL}, ${results.http})`);

const browser = await playwright.chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});

/** A page with request bookkeeping: every /api call with its start, end, status and whether it is a stream. */
async function newContext(viewport = { width: 1400, height: 900 }) {
  const ctx = await browser.newContext({ viewport, ignoreHTTPSErrors: true });
  // the sandbox has no route out: anything off the console's host fails at once instead of hanging (web fonts, CDNs)
  const host = new URL(PAGE_URL).host;
  await ctx.route((u) => u.host !== host && /^https?:/.test(u.protocol), (r) => r.abort('internetdisconnected'));
  return ctx;
}

async function consolePage(ctx) {
  const page = await ctx.newPage();
  const net = { calls: [], errors: [], consoleErrors: [], t0: Date.now() };
  const byReq = new Map();
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (!u.pathname.startsWith('/api/')) return;
    const c = { path: u.pathname + (u.search.length > 1 ? u.search.slice(0, 60) : ''), method: r.method(), start: Date.now() - net.t0, end: null, status: null, stream: /stream|events|\/sse/.test(u.pathname) };
    byReq.set(r, c); net.calls.push(c);
  });
  page.on('response', (res) => { const c = byReq.get(res.request()); if (c) { c.status = res.status(); if ((res.headers()['content-type'] ?? '').includes('event-stream')) c.stream = true; } });
  page.on('requestfinished', (r) => { const c = byReq.get(r); if (c) c.end = Date.now() - net.t0; });
  page.on('requestfailed', (r) => { const c = byReq.get(r); if (c) { c.end = Date.now() - net.t0; c.failed = r.failure()?.errorText ?? 'failed'; } });
  page.on('pageerror', (e) => net.errors.push(String(e?.message ?? e).slice(0, 300)));
  page.on('console', (m) => { if (m.type() === 'error') net.consoleErrors.push(m.text().slice(0, 300)); });
  return { page, net };
}

/** Peak number of non-stream calls in flight at once within [from, to] ms. */
function peakInFlight(calls, from, to) {
  const ev = [];
  for (const c of calls) {
    if (c.stream || c.start < from || c.start > to) continue;
    ev.push([c.start, 1], [c.end ?? Infinity, -1]);
  }
  ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let n = 0; let peak = 0;
  for (const [, d] of ev) { n += d; peak = Math.max(peak, n); }
  return peak;
}

/** A Playwright screenshot that never stops the suite: a page whose main thread is too busy to paint in 12 s is recorded. */
const snaps = { taken: 0, timedOut: [] };
async function snap(page, path) {
  try { await page.screenshot({ path, timeout: 12_000 }); snaps.taken++; } catch (e) { snaps.timedOut.push(path.split('/').pop()); }
}

const control = (page, cmd, ms = 20_000) => Promise.race([
  page.evaluate((c) => window.axfConsoleControl(c), cmd),
  sleep(ms).then(() => ({ ok: false, message: `no answer in ${ms / 1000} s`, timeout: true })),
]);
/** The page still draws something (no blank white screen after a crash). */
const drawn = (page) => page.evaluate(() => { const r = document.getElementById('root'); return !!r && r.children.length > 0 && (document.body.innerText || '').trim().length > 20; });

async function waitReady(page, t0, limit = 30_000) {
  try { await page.waitForFunction(() => typeof window.axfConsoleControl === 'function', null, { timeout: limit }); return Date.now() - t0; } catch { return null; }
}

/** Load (or reload) and measure. */
async function measureLoad(page, net, how) {
  net.calls.length = 0; net.errors.length = 0; net.t0 = Date.now();
  const t0 = net.t0;
  try {
    if (how === 'cold') await page.goto(`${PAGE_URL}/`, { waitUntil: 'commit', timeout: 30_000 });
    else await page.reload({ waitUntil: 'commit', timeout: 30_000 });
  } catch (e) { return { how, error: String(e.message ?? e) }; }
  const readyMs = await waitReady(page, t0);
  let fcp = null;
  for (let i = 0; i < 40 && fcp === null; i++) {
    fcp = await page.evaluate(() => performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null).catch(() => null);
    if (fcp === null) await sleep(250);
  }
  // settle: no non-stream call in flight for 1 s (or 30 s passed)
  let settleMs = null;
  for (let quiet = 0; Date.now() - t0 < 30_000;) {
    await sleep(250);
    const busy = net.calls.some((c) => !c.stream && c.end === null);
    quiet = busy ? 0 : quiet + 250;
    if (quiet >= 1000) { settleMs = Date.now() - t0 - 1000; break; }
  }
  await sleep(Math.max(0, 10_000 - (Date.now() - t0)));
  const first10 = net.calls.filter((c) => c.start <= 10_000);
  const streams = net.calls.filter((c) => c.stream && c.end === null);
  const slow = net.calls.filter((c) => !c.stream && c.end !== null).map((c) => ({ path: c.path, ms: c.end - c.start, status: c.status })).sort((a, b) => b.ms - a.ms).slice(0, 10);
  const pending = net.calls.filter((c) => !c.stream && c.end === null).map((c) => c.path);
  const failed = net.calls.filter((c) => c.failed || (c.status ?? 0) >= 500).map((c) => `${c.path} ${c.status ?? c.failed}`);
  const perPath = {};
  for (const c of first10) perPath[c.path.split('?')[0]] = (perPath[c.path.split('?')[0]] ?? 0) + 1;
  return {
    how, readyMs, firstPaintMs: fcp === null ? null : Math.round(fcp), settleMs,
    calls10s: first10.length, peakAtOnce: peakInFlight(net.calls, 0, 10_000), openStreams: streams.length, streams: streams.map((c) => c.path),
    pendingAt10s: pending, failed: [...new Set(failed)], slowest: slow, repeated: Object.entries(perPath).filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]).slice(0, 12),
    pageErrors: [...net.errors], drawn: await drawn(page).catch(() => false),
  };
}

async function sectionStartup() {
  const ctx = await newContext();
  const { page, net } = await consolePage(ctx);
  const runs = [];
  for (const how of ['cold', 'reload', 'reload', 'reload']) {
    const m = await measureLoad(page, net, how);
    runs.push(m);
    const n = `${how} #${runs.length}`;
    if (m.error) { record('startup', `${n}: page loads`, false, m.error); continue; }
    record('startup', `${n}: console ready ≤ ${LIMITS.readyMs / 1000} s`, m.readyMs !== null && m.readyMs <= LIMITS.readyMs, m.readyMs === null ? 'never ready (30 s)' : `${m.readyMs} ms`, m.readyMs ?? 30_000);
    record('startup', `${n}: first paint ≤ ${LIMITS.firstPaintMs / 1000} s`, m.firstPaintMs !== null && m.firstPaintMs <= LIMITS.firstPaintMs, `${m.firstPaintMs} ms`, m.firstPaintMs ?? 0);
    record('startup', `${n}: settles ≤ ${LIMITS.settleMs / 1000} s`, m.settleMs !== null && m.settleMs <= LIMITS.settleMs, m.settleMs === null ? `still busy at 30 s: ${m.pendingAt10s.slice(0, 6).join(', ')}` : `${m.settleMs} ms`, m.settleMs ?? 30_000);
    record('startup', `${n}: ≤ ${LIMITS.burstAtOnce} /api calls at once`, m.peakAtOnce <= LIMITS.burstAtOnce, `peak ${m.peakAtOnce}, ${m.calls10s} calls in 10 s`);
    record('startup', `${n}: ≤ ${LIMITS.callsFirst10s} /api calls in the first 10 s`, m.calls10s <= LIMITS.callsFirst10s, `${m.calls10s}; repeated: ${m.repeated.slice(0, 5).map(([p, k]) => `${p}×${k}`).join(', ')}`);
    record('startup', `${n}: ≤ ${LIMITS.openStreams} streams held open`, m.openStreams <= LIMITS.openStreams, m.streams.join(', '));
    record('startup', `${n}: nothing unanswered after 10 s`, m.pendingAt10s.length === 0, m.pendingAt10s.slice(0, 8).join(', '));
    record('startup', `${n}: no page errors`, m.pageErrors.length === 0, m.pageErrors.slice(0, 3).join(' | '));
    record('startup', `${n}: the page draws`, m.drawn);
  }
  await snap(page, join(SHOTS, 'startup-desktop.png'));
  results.sections.startup = runs;
  await page.close({ runBeforeUnload: true }); // pagehide: the console says bye, as a closed tab does
  await sleep(500);
  await ctx.close();
}

/** One console page shared by the open-every-X sections (as Brett's one tab). */
let shared = null;
async function sharedPage() {
  if (shared) return shared;
  const ctx = await newContext();
  const p = await consolePage(ctx);
  await p.page.goto(`${PAGE_URL}/`, { waitUntil: 'commit' });
  await waitReady(p.page, Date.now(), 60_000);
  await sleep(1500);
  shared = { ctx, ...p };
  return shared;
}

async function closeDialogs(page) {
  for (let i = 0; i < 3; i++) {
    const open = await page.evaluate(() => !!document.querySelector('[role="dialog"], .fx-dialog')).catch(() => false);
    if (!open) return;
    await page.keyboard.press('Escape');
    await sleep(150);
  }
}

/** After a crash (blank page): reload and wait until the console is ready and its startup calls are done (≤ 45 s), so
 * the next check is not failed by the reload itself. */
async function recover(page, net) {
  const t = Date.now();
  await page.reload({ waitUntil: 'commit' }).catch(() => undefined);
  await waitReady(page, t, 30_000);
  for (let quiet = 0; Date.now() - t < 45_000 && quiet < 1500;) { await sleep(250); quiet = net.calls.some((c) => !c.stream && c.end === null) ? 0 : quiet + 250; }
  results.recoveries = (results.recoveries ?? 0) + 1;
}

/** Open an address through the executor; check the answer, page errors, that it still draws; screenshot. */
async function openAndCheck(section, label, address, { shot = true, expectScreen, phone } = {}) {
  const { page, net } = await sharedPage();
  const before = net.errors.length;
  const t = Date.now();
  const a = await control(page, { verb: 'open', address }, LIMITS.openMs + 12_000);
  const ms = Date.now() - t;
  await sleep(400);
  const errs = net.errors.slice(before);
  const ok = !!a.ok && !a.timeout;
  record(section, `${label}: opens`, ok, ok ? '' : (a.message ?? a.error ?? JSON.stringify(a).slice(0, 200)), ms);
  if (ok && expectScreen) record(section, `${label}: the console is on it`, a.state?.screen === expectScreen || (a.state?.dialog ?? '') !== '', `screen ${a.state?.screen} dialog ${a.state?.dialog ?? '-'}`);
  record(section, `${label}: opens ≤ ${LIMITS.openMs / 1000} s`, ms <= LIMITS.openMs, `${ms} ms`, ms);
  record(section, `${label}: no page error`, errs.length === 0, errs.slice(0, 2).join(' | '));
  const d = await drawn(page).catch(() => false);
  record(section, `${label}: still draws`, d);
  if (!d) await recover(page, net);
  if (shot) await snap(page, join(SHOTS, `${section}-${slug(label)}.png`));
  if (phone) {
    await page.setViewportSize({ width: 390, height: 844 }); await sleep(300);
    await snap(page, join(SHOTS, `${section}-${slug(label)}-phone.png`));
    await page.setViewportSize({ width: 1400, height: 900 });
  }
  return a;
}

async function sectionScreens() {
  const list = [];
  for (const v of inventory.views) {
    const a = await openAndCheck('screens', `${v.label} (${v.id})`, v.address, { expectScreen: v.id === 'settings' ? undefined : v.id, phone: PHONE });
    list.push({ id: v.id, ok: !!a.ok, screen: a.state?.screen });
    await closeDialogs((await sharedPage()).page);
  }
  results.sections.screens = list;
}

async function sectionTabs() {
  const list = [];
  for (const g of inventory.tabGroups.filter((x) => x.view && !x.dynamic)) {
    for (const tab of g.tabs) {
      const a = await openAndCheck('tabs', `${g.view} › ${g.id} = ${tab.value}`, tab.address, { shot: false });
      const row = Object.entries(a.state?.tabs ?? {}).find(([k]) => k.endsWith(`tab:${g.id}`));
      if (a.ok) record('tabs', `${g.view} › ${g.id} = ${tab.value}: the row reports it`, !row || row[1] === tab.value, row ? `row says ${row[1]}` : 'row not in state');
      list.push({ group: g.id, tab: tab.value, ok: !!a.ok });
    }
    await snap((await sharedPage()).page, join(SHOTS, `tabs-${slug(g.id)}.png`));
    await closeDialogs((await sharedPage()).page);
  }
  results.sections.tabs = list;
}

async function sectionSettings() {
  const list = [];
  for (const s of inventory.settingsTabs) {
    const a = await openAndCheck('settings', `Settings › ${s.parent ? `${s.parent} › ` : ''}${s.label}`, s.address, { phone: PHONE && !s.parent });
    list.push({ id: s.id, ok: !!a.ok });
  }
  await closeDialogs((await sharedPage()).page);
  results.sections.settings = list;
}

// ---------------------------------------------------------------------- the relay (REST → server → console → ack)

async function rest(method, path, body, ms = 60_000) {
  const t = Date.now();
  try {
    const r = await fetch(`${URL_}/api/console${path}`, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(ms) });
    const j = await r.json().catch(() => ({}));
    return { http: r.status, ms: Date.now() - t, ...j };
  } catch (e) { return { http: 0, ms: Date.now() - t, ok: false, error: e.name === 'TimeoutError' ? `no answer in ${ms / 1000} s` : String(e.message ?? e) }; }
}
const delivered = (r) => r.ok === true && r.status === 'delivered';
const why = (r) => `http ${r.http} · ${r.status ?? ''} · ${r.message ?? r.error ?? r.detail ?? ''} ${r.delivered ? JSON.stringify(r.delivered).slice(0, 200) : ''}`;

async function sectionDialogs() {
  const { page } = await sharedPage();
  await page.bringToFront(); await page.evaluate(() => window.focus());
  await sleep(1500);
  const l = await rest('GET', '/list?kind=dialogs&limit=500');
  const items = l.items ?? l.result?.items ?? l.delivered?.[0]?.result?.items ?? [];
  record('dialogs', 'the console lists its dialogs', Array.isArray(items) && items.length > 0, why(l), l.ms);
  const list = [];
  for (const d of items) {
    const id = d.id ?? d.target ?? d.path;
    const before = (await sharedPage()).net.errors.length;
    const r = await rest('POST', '/dialog', { id, by: 'suite' }, 30_000);
    record('dialogs', `${d.label ?? id}: opens`, delivered(r), why(r), r.ms);
    await sleep(500);
    // a dialog shows as a modal ([role=dialog]) or, on its page surface, as the screen; either way the console's state names it
    const open = await page.evaluate(() => !!window.axfConsoleControlState?.().dialog || !!document.querySelector('[role="dialog"], .fx-dialog, dialog[open], [data-fx-dialog-surface]')).catch(() => false);
    if (delivered(r)) record('dialogs', `${d.label ?? id}: the dialog is on screen`, open, open ? '' : 'the console says no dialog is open (it closed at once: not registered?)');
    const errs = (await sharedPage()).net.errors.slice(before);
    record('dialogs', `${d.label ?? id}: no page error`, errs.length === 0, errs.join(' | '));
    await snap(page, join(SHOTS, `dialog-${slug(String(id))}.png`));
    const c = await rest('POST', '/dialog', { action: 'close', by: 'suite' }, 30_000);
    record('dialogs', `${d.label ?? id}: closes`, delivered(c) || c.code === 'not_found', why(c), c.ms);
    await closeDialogs(page);
    if (!(await drawn(page).catch(() => false))) { record('dialogs', `${d.label ?? id}: page still draws`, false); await recover(page, (await sharedPage()).net); }
    list.push({ id, ok: delivered(r) });
  }
  results.sections.dialogs = list;
}

async function sectionCommands() {
  const { page } = await sharedPage();
  await page.bringToFront(); await page.evaluate(() => window.focus());
  await sleep(1000);
  const cmds = [];
  const step = async (name, method, path, body, check = delivered, ms = LIMITS.commandMs) => {
    const r = await rest(method, path, body, ms + 30_000);
    cmds.push({ name, ms: r.ms, ok: check(r), status: r.status, message: r.message ?? r.error ?? '' });
    record('commands', `${name}: answered`, check(r), why(r), r.ms);
    record('commands', `${name}: answered ≤ ${ms / 1000} s`, r.ms <= ms, `${r.ms} ms`, r.ms);
    return r;
  };
  const listOk = (r) => r.ok === true && ((r.items ?? r.result?.items ?? r.delivered?.[0]?.result?.items ?? []).length > 0);
  await step('clients (list)', 'GET', '/list?kind=clients', null, (r) => r.ok === true && (r.items ?? []).length > 0);
  const clients = await rest('GET', '/clients');
  record('commands', 'the open console is a live client', (clients.items ?? []).some((c) => c.live), JSON.stringify(clients.items ?? []).slice(0, 300));
  await step('where', 'GET', '/where', null, (r) => r.ok === true);
  for (const kind of ['screens', 'dialogs', 'settings', 'actions']) await step(`list ${kind}`, 'GET', `/list?kind=${kind}&limit=500`, null, listOk);
  const words = await step('open plan studio (by words)', 'POST', '/open', { screen: 'plan studio', by: 'suite' });
  record('commands', 'open by words: the console says it is on Plan Studio', /^plan-studio/.test(words.delivered?.[0]?.here?.screen ?? ''), JSON.stringify(words.delivered?.[0]?.here ?? {}));
  await step('open builds (by id)', 'POST', '/open', { screen: 'build-orchestrator', by: 'suite' });
  await step('open by address (settings › plugins)', 'POST', '', { op: 'act', target: 'console.control', path: 'view:settings/tab:settings.tabs=plugins', action: 'open', by: 'suite' }, (r) => r.ok === true);
  await step('settings tab (appearance) via POST /settings', 'POST', '/settings', { tab: 'appearance', by: 'suite' });
  await step('settings tab (appearance) via the command route', 'POST', '', { op: 'act', target: 'console.settings', path: 'appearance', action: 'open', by: 'suite' });
  await step('dialog close', 'POST', '/dialog', { action: 'close', by: 'suite' }, (r) => r.ok === true || r.code === 'not_found');
  await step('home', 'POST', '/home', { by: 'suite' });
  await step('open home then back', 'POST', '/open', { screen: 'plan', by: 'suite' });
  await step('back', 'POST', '/back', { by: 'suite' });
  await step('action (search palette)', 'POST', '/action', { id: 'console.search', by: 'suite' }, (r) => r.ok === true || r.code === 'not_found');
  await closeDialogs(page);
  // screenshots
  const shotOk = (r) => delivered(r) && Array.isArray(r.images) && r.images.length > 0 && !!r.images[0].data;
  const saveShot = (r, name) => { const d = r.images?.[0]?.data; if (d) writeFileSync(join(SHOTS, `console-screenshot-${slug(name)}.png`), Buffer.from(d, 'base64')); };
  let r = await step('screenshot (whole console)', 'POST', '/screenshot', { by: 'suite' }, shotOk, LIMITS.shotMs);
  saveShot(r, 'whole');
  record('commands', 'screenshot: a PNG with a size and the screen state', shotOk(r) && r.images[0].width > 0 && !!r.state?.screen, `images ${r.images?.length ?? 0} · state ${JSON.stringify(r.state ?? {}).slice(0, 160)}`);
  r = await step('screenshot (address: view:settings)', 'POST', '/screenshot', { address: 'view:settings', by: 'suite' }, (x) => shotOk(x) || (x.ok === false && /not on the screen/.test(x.message ?? '')), LIMITS.shotMs);
  saveShot(r, 'address');
  r = await step('screenshot (selector: #root)', 'POST', '/screenshot', { selector: '#root', by: 'suite' }, shotOk, LIMITS.shotMs);
  saveShot(r, 'selector');
  r = await rest('POST', '/screenshot', { selector: '##bad', by: 'suite' }, 45_000);
  record('commands', 'screenshot (bad selector): fails fast with a reason', r.ms < LIMITS.commandMs && !delivered(r) && /selector|not on the screen/i.test(`${r.message ?? ''}${JSON.stringify(r.delivered ?? '')}${r.detail ?? ''}`), why(r), r.ms);
  await rest('POST', '/open', { screen: 'build-orchestrator', by: 'suite' });
  const times = [];
  for (let i = 0; i < 10; i++) { const x = await rest('POST', '/screenshot', { by: 'suite' }, 45_000); times.push(shotOk(x) ? x.ms : -1); }
  const okN = times.filter((x) => x >= 0).length;
  record('commands', 'ten screenshots in a row all answer', okN === 10, `${okN}/10 · ms ${times.join(' ')}`);
  results.sections.screenshotTimes = times;
  // refresh: the caller hears, the page reloads, comes back and answers commands again
  for (const hard of [false, true]) {
    const name = hard ? 'refresh (hard)' : 'refresh (soft)';
    const nav = page.waitForEvent('framenavigated', { timeout: 20_000 }).then(() => true, () => false);
    const t = Date.now();
    await step(name, 'POST', '/refresh', hard ? { hard: true, by: 'suite' } : { by: 'suite' });
    record('commands', `${name}: the page reloads`, await nav);
    const back = await waitReady(page, t, 30_000);
    record('commands', `${name}: the console is back ≤ ${LIMITS.readyMs / 1000} s`, back !== null && back <= LIMITS.readyMs + 2000, back === null ? 'not back in 30 s' : `${back} ms`, back ?? 30_000);
    await page.evaluate(() => window.focus()).catch(() => undefined);
    await sleep(2500);
    await step(`${name}: then open answers`, 'POST', '/open', { screen: 'plan studio', by: 'suite' });
    await step(`${name}: then screenshot answers`, 'POST', '/screenshot', { by: 'suite' }, shotOk, LIMITS.shotMs);
  }
  results.sections.commands = cmds;
}

const SECTIONS = { startup: sectionStartup, screens: sectionScreens, tabs: sectionTabs, settings: sectionSettings, dialogs: sectionDialogs, commands: sectionCommands };
try {
  for (const [name, fn] of Object.entries(SECTIONS)) {
    if (!ONLY.has(name)) continue;
    const t = Date.now();
    const n0 = results.checks.length;
    try { await fn(); } catch (e) { record(name, 'section ran to the end', false, String(e?.stack ?? e).slice(0, 500)); }
    const mine = results.checks.slice(n0);
    console.log(`${name.padEnd(9)} ${mine.filter((c) => c.ok).length}/${mine.length} passed (${Math.round((Date.now() - t) / 1000)} s)`);
  }
} finally {
  if (shared) { results.sections.sharedPageErrors = [...new Set(shared.net.errors)].slice(0, 40); results.sections.sharedConsoleErrors = [...new Set(shared.net.consoleErrors)].slice(0, 40); }
  await browser.close().catch(() => undefined);
  await proxy?.close().catch(() => undefined); // after the browser: its open streams would hold the proxy open
  if (sandbox && !args.includes('--keep')) down(sandbox.name);
  const failed = results.checks.filter((c) => !c.ok);
  results.snapshots = snaps;
  if (snaps.timedOut.length) console.log(`  ${snaps.timedOut.length} page screenshots timed out (page too busy to paint in 12 s): ${snaps.timedOut.slice(0, 6).join(', ')}`);
  results.summary = { checks: results.checks.length, passed: results.checks.length - failed.length, failed: failed.length };
  writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2));
  console.log(`console suite (${LABEL}): ${results.summary.passed}/${results.summary.checks} passed · ${OUT}/results.json`);
  process.exitCode = failed.length ? 1 : 0;
}
