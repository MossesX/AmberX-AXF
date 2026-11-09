/**
 * Look regression, browser half: every framework web app (console, Molly, axHub web, AmberX web, Walkthrough Studio)
 * built and served, then walked with Chromium in the default look. For each app and viewport it records:
 *   - a screenshot of the home screen, of every screen / dialog the application menu reaches, of every settings
 *     section and tab (collapsed cards expanded so every picker shows);
 *   - page errors, console errors, failed requests (4xx / 5xx / network);
 *   - the computed --fx-* variables on :root and every CSS variable referenced but never declared (missing tokens);
 *   - the saved-settings keys in localStorage and a round trip: pick another colour theme, reload, the pick is still
 *     applied; restore, reload, the look is exactly the baseline again;
 *   - the console's plugin list from /api/plugins (every plugin loads).
 * The console runs on its own Python API (uvicorn, hub off, a throwaway data folder); the other apps on `vite preview`.
 */
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

export const APPS = ['console-web', 'molly', 'axhub-web', 'amberx-droid', 'walkthrough-studio'];
export const VIEWPORTS = { desktop: { width: 1280, height: 800 }, phone: { width: 412, height: 900 } };
const BASE_PORT = Number(process.env.LOOK_REGRESSION_PORT) || 7310;
// verbs with side effects, and data rows (a build, a session, a plan: "<title> · Fable · 7.5 h left", "#12 …") that change with the data, not the look
const SKIP_LABEL = /sign out|log out|logout|reload|restart|shut ?down|delete|remove|reset|uninstall|\bstop\b|kill|clear|sync|publish|land|merge|push|install|download|export|start|run\b|send|approve|deny|cancel| · |\d+(\.\d+)? ?(h|min|s) left|^#?\d+\b/i;
const slug = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'x';

async function waitUp(url, ms = 60_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const r = await fetch(url); if (r.ok || r.status === 404) return true; } catch { /* not yet */ }
    await sleep(500);
  }
  return false;
}

/** Start the server for one app; returns { url, stop }. */
export async function serve(root, app, port) {
  let child;
  if (app === 'console-web') {
    const tmp = mkdtempSync(join(tmpdir(), 'look-regression-'));
    const data = join(tmp, 'data');
    const manifest = JSON.parse(readFileSync(join(root, 'project.manifest.json'), 'utf8'));
    for (const rel of manifest.data?.shared ?? []) {
      const src = join(root, rel);
      if (existsSync(src)) { mkdirSync(dirname(join(data, rel)), { recursive: true }); cpSync(src, join(data, rel), { recursive: true }); }
    }
    mkdirSync(join(tmp, 'projects'), { recursive: true });
    const env = {
      // no console token: the browser has none, and an open console (no token, no wall) answers every read
      ...process.env, AXF_ROOT: root, PORT: String(port), AXF_STATE: join(tmp, 'state.json'), AXF_TOKEN: '', AXF_TOKEN_FILE: join(tmp, 'no-token-env'),
      AXF_APPEARANCE_HUB: 'off', AXF_DATA_DIR: data, AXHUB_PROJECTS_DIR: join(tmp, 'projects'), AXF_APP_CATALOG_EVERY: '0',
      AXF_CONSOLE_COMMANDS_DATA_DIR: join(tmp, 'console-commands'), AXF_UI_REVIEW_DIR: join(tmp, 'ui-review'),
    };
    child = spawn('python3', ['-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', String(port), '--log-level', 'warning'], { cwd: join(root, 'apps/console-web/server'), env, stdio: ['ignore', 'pipe', 'pipe'] });
    const stop = () => { child.kill('SIGTERM'); rmSync(tmp, { recursive: true, force: true }); };
    const logs = [];
    child.stderr.on('data', (d) => logs.push(String(d)));
    if (!(await waitUp(`http://127.0.0.1:${port}/api/health`))) { stop(); throw new Error(`console API did not start on ${port}: ${logs.join('').slice(-800)}`); }
    return { url: `http://127.0.0.1:${port}`, stop, logs };
  }
  child = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: join(root, 'apps', app), stdio: ['ignore', 'pipe', 'pipe'] });
  const logs = [];
  child.stderr.on('data', (d) => logs.push(String(d)));
  const stop = () => child.kill('SIGTERM');
  if (!(await waitUp(`http://127.0.0.1:${port}/`))) { stop(); throw new Error(`${app} preview did not start on ${port} (is dist/ built?): ${logs.join('').slice(-800)}`); }
  return { url: `http://127.0.0.1:${port}`, stop, logs };
}

const FREEZE_CSS = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}';

/** The --fx-* variables: computed on :root, plus every variable referenced in a stylesheet with no declaration anywhere. */
const auditVars = () => {
  const refs = new Set(), decls = new Set();
  for (const sheet of document.styleSheets) {
    let rules; try { rules = sheet.cssRules; } catch { continue; }
    const walk = (list) => { for (const r of list) { if (r.cssRules) walk(r.cssRules); if (r.cssText) { for (const m of r.cssText.matchAll(/var\(\s*(--[\w-]+)/g)) refs.add(m[1]); for (const m of r.cssText.matchAll(/(?:^|[;{\s])(--[\w-]+)\s*:/g)) decls.add(m[1]); } } };
    walk(rules);
  }
  for (const el of document.querySelectorAll('[style]')) for (const m of el.getAttribute('style').matchAll(/(--[\w-]+)\s*:/g)) decls.add(m[1]);
  const cs = getComputedStyle(document.documentElement);
  const root = {};
  for (const n of [...new Set([...refs, ...decls])].filter((n) => n.startsWith('--fx')).sort()) { const v = cs.getPropertyValue(n).trim(); if (v) root[n] = v; }
  const missing = [...refs].filter((n) => !decls.has(n) && !cs.getPropertyValue(n).trim()).sort();
  const attrs = {};
  for (const a of document.documentElement.attributes) attrs[a.name] = a.value;
  return { root, missing, htmlAttrs: attrs, bodyClass: document.body.className, refs: refs.size, decls: decls.size };
};

const storageShape = () => {
  const out = {};
  for (let i = 0; i < localStorage.length; i += 1) {
    const k = localStorage.key(i);
    if (!/^axf/i.test(k)) continue;
    const v = localStorage.getItem(k) ?? '';
    try { const j = JSON.parse(v); out[k] = j && typeof j === 'object' ? (Array.isArray(j) ? `array(${j.length})` : `{${Object.keys(j).sort().join(',')}}`) : String(j); } catch { out[k] = v.length > 40 ? `text(${v.length})` : v; }
  }
  return out;
};

const pageState = () => {
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const dialogs = [...document.querySelectorAll('[role="dialog"]')].filter(vis).map((d) => d.getAttribute('aria-label') || d.querySelector('h1,h2,h3,.fx-dialog__title')?.textContent?.trim() || 'dialog');
  const heads = [...document.querySelectorAll('main h1, main h2, .fx-page__title, h1')].filter(vis).slice(0, 2).map((h) => h.textContent.trim().slice(0, 80));
  return { dialogs, heads, path: location.pathname + location.search + location.hash };
};

export class Walker {
  constructor(page, outDir, rec, home) { this.page = page; this.out = outDir; this.rec = rec; this.home = home; this.n = 0; mkdirSync(outDir, { recursive: true }); }
  async freeze() { await this.page.addStyleTag({ content: FREEZE_CSS }).catch(() => {}); }
  async shot(name, extra = {}) {
    this.current = name;
    const file = `${String(this.n += 1).padStart(3, '0')}-${slug(name)}.png`;
    await this.page.evaluate(() => { window.scrollTo(0, 0); for (const el of document.querySelectorAll('.axf-settings__panel, .axf-settings__split, main')) el.scrollTo?.(0, 0); }).catch(() => {});
    await this.page.screenshot({ path: join(this.out, file), animations: 'disabled', caret: 'hide' });
    const st = await this.page.evaluate(pageState).catch(() => ({}));
    // live regions (the banner bar with its clock and counters, the banner strip and group) are masked in the pixel diff
    const masks = await this.page.evaluate(() => [...document.querySelectorAll('[role="banner"], .fx-banner-strip, .fx-banner-group, .fx-banner-strip__widgets')].map((e) => { const r = e.getBoundingClientRect(); return [Math.floor(r.left), Math.floor(r.top), Math.ceil(r.width), Math.ceil(r.height)]; }).filter((r) => r[2] > 0 && r[3] > 0)).catch(() => []);
    this.rec.shots.push({ name, file, ...st, masks, ...extra });
    return file;
  }
  async closeOverlays() {
    for (let i = 0; i < 2; i += 1) { await this.page.keyboard.press('Escape'); await sleep(80); }
    const open = await this.page.locator('[role="dialog"]:visible').count().catch(() => 0);
    if (open) { await this.page.locator('.fx-dialog__close, [role="dialog"] [aria-label="Close"]').first().click({ timeout: 600 }).catch(() => {}); await sleep(120); }
  }
  /** The items of the open list `depth` levels down the path (the top list is depth 1 in AppMenu.tsx; a submenu is depth + 1). */
  async menuItems(depth) {
    return this.page.locator(`[data-axf-menu-depth="${depth + 1}"] > li > [data-axf-menu-item]`).evaluateAll((els) => els.map((e) => ({
      id: e.getAttribute('data-axf-menu-item'), label: e.querySelector('.fx-menu__label')?.textContent?.trim() ?? e.textContent.trim(),
      sub: e.getAttribute('aria-haspopup') === 'menu', disabled: e.disabled, check: e.getAttribute('role') === 'menuitemcheckbox',
      live: e.classList.contains('fx-menu__live-main') || e.closest('li')?.classList.contains('fx-menu__live') === true,
    })));
  }
  /** Open the menu button and follow a path of item ids; true when every step was found. */
  /** The chrome (its menu buttons) is on the page; after a crashed view (error boundary) the app is reloaded once. */
  async ensureChrome() {
    if (await this.page.locator('[data-axf-menu-btn]').count()) return true;
    await this.page.goto(this.home, { waitUntil: 'load', timeout: 60_000 }).catch(() => {});
    await sleep(1200);
    await this.freeze();
    this.rec.reloads = (this.rec.reloads ?? 0) + 1;
    return (await this.page.locator('[data-axf-menu-btn]').count()) > 0;
  }
  /** Wait for a menu list to have rows (plugin menus load their rows lazily: "Loading…" first). */
  async listReady(depth, ms = 2000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (await this.page.locator(`[data-axf-menu-depth="${depth + 1}"] > li > [data-axf-menu-item]`).count()) return true;
      await sleep(100);
    }
    return false;
  }
  async openPath(btn, path) {
    await this.closeOverlays();
    if (!(await this.ensureChrome())) return false;
    const b = this.page.locator(`[data-axf-menu-btn="${btn}"]`).first();
    if (!(await b.count())) return false;
    await b.click({ timeout: 2000 }).catch(() => {});
    await this.listReady(0);
    for (let d = 0; d < path.length; d += 1) {
      const it = this.page.locator(`[data-axf-menu-depth="${d + 1}"] > li > [data-axf-menu-item="${path[d]}"]`).first();
      if (!(await it.count())) return false;
      await it.click({ timeout: 2000 }).catch(() => {});
      if (d < path.length - 1) await this.listReady(d + 1); else await sleep(450);
    }
    return true;
  }
  /** The whole menu as leaf paths (ids), reading live lists too, up to 3 levels. */
  async menuTree(btn) {
    const leaves = [];
    const read = async (path, depth) => {
      if (depth > 2) return;
      const items = await this.menuItems(depth);
      const cap = depth === 0 ? 60 : 12;
      // live rows (a provider's list: builds, plugins, sessions…) change with the data, not the look: counted, never walked
      const live = items.filter((it) => it.live).length;
      if (live) this.rec.liveRows.push({ path: path.join('/'), live });
      for (const it of items.filter((it) => !it.live).slice(0, cap)) {
        if (!it.id) continue;
        if (it.sub) {
          if (!(await this.openPath(btn, [...path, it.id]))) continue;
          await this.listReady(depth + 1);
          await read([...path, it.id], depth + 1);
        } else leaves.push({ path: [...path, it.id], label: it.label, disabled: it.disabled, check: it.check });
      }
    };
    if (!(await this.openPath(btn, []))) return leaves;
    await read([], 0);
    await this.closeOverlays();
    return leaves;
  }
  async walkMenus(home) {
    const btns = await this.page.locator('[data-axf-menu-btn]').evaluateAll((els) => els.map((e) => e.getAttribute('data-axf-menu-btn')));
    this.rec.menus = {};
    for (const btn of [...new Set(btns)]) {
      const leaves = await this.menuTree(btn);
      this.rec.menus[btn] = leaves.map((l) => ({ id: l.path.join('/'), label: l.label, disabled: l.disabled, check: l.check }));
      for (const leaf of leaves) {
        const id = leaf.path.join('/');
        if (leaf.disabled || leaf.check || SKIP_LABEL.test(leaf.label) || /^(settings|console\.settings)$/.test(leaf.path.at(-1))) { this.rec.skipped.push({ menu: btn, id, label: leaf.label, why: leaf.disabled ? 'disabled' : leaf.check ? 'toggle' : 'settings or a verb with side effects' }); continue; }
        if (!(await this.openPath(btn, leaf.path))) { this.rec.skipped.push({ menu: btn, id, label: leaf.label, why: 'gone when reopened' }); continue; }
        await this.freeze();
        await this.shot(`menu ${btn} ${leaf.label}`, { menu: btn, item: id });
        await this.closeOverlays();
        // the app menu is always in the chrome, so the next leaf opens from wherever this one went; only a stuck dialog or
        // a left origin goes back home (a full reload each time would triple the walk)
        const stuck = await this.page.locator('[role="dialog"]:visible').count().catch(() => 0);
        if (stuck || !this.page.url().startsWith(new URL(home).origin)) { await this.page.goto(home); await sleep(900); await this.freeze(); }
      }
    }
  }
  /** Expand every collapsed card / group in the settings panel so every picker shows. */
  async expandAll() {
    for (let i = 0; i < 40; i += 1) {
      const t = this.page.locator('.axf-settings__panel [aria-expanded="false"]:is(.fx-card__toggle, .axf-settings__gtoggle, .fx-card__head button), .axf-settings__rest [aria-expanded="false"]').first();
      if (!(await t.count())) break;
      await t.click({ timeout: 800 }).catch(() => { i = 99; });
      await sleep(120);
    }
  }
  async openSettings() {
    for (const btn of Object.keys(this.rec.menus ?? {})) {
      const leaf = (this.rec.menus[btn] ?? []).find((l) => /^settings$/i.test(l.label) || /(^|\/)(settings|console\.settings)$/.test(l.id));
      if (leaf && (await this.openPath(btn, leaf.id.split('/')))) { await sleep(400); return true; }
    }
    const b = this.page.getByRole('button', { name: 'Settings' }).first();
    if (await b.isVisible().catch(() => false)) { await b.click(); await sleep(400); return true; }
    return false;
  }
  async settingsRows() {
    return this.page.locator('.axf-settings__navlist .axf-settings__nav, .axf-settings__navlist [role="button"], .axf-settings__navlist button, .axf-settings__tabs [role="tab"]').evaluateAll((els) => els.map((e, i) => ({ i, label: (e.querySelector('.axf-settings__navlabel') ?? e).textContent.trim().slice(0, 40) })));
  }
  async walkSettings() {
    this.rec.settings = [];
    if (!(await this.openSettings())) { this.rec.settings.push({ error: 'no Settings entry' }); return; }
    await this.freeze();
    await this.shot('settings', { settings: 'root' });
    const rows = await this.settingsRows();
    for (const row of rows.slice(0, 40)) {
      if (!(await this.openSettings())) break;
      const rowEl = this.page.locator('.axf-settings__navlist .axf-settings__nav, .axf-settings__navlist [role="button"], .axf-settings__navlist button, .axf-settings__tabs [role="tab"]').nth(row.i);
      if (!(await rowEl.count())) continue;
      await rowEl.click({ timeout: 2000 }).catch(() => {});
      await sleep(450);
      await this.expandAll();
      await this.freeze();
      const entry = { section: row.label, tabs: [] };
      await this.shot(`settings ${row.label}`, { settings: row.label });
      // a section with many sub-sections lists them as rows (Plugins): each row is a sub-section of its own
      const subRows = await this.page.locator('.axf-settings__navlist--subs .axf-settings__nav, .axf-settings__navlist--subs [role="button"], .axf-settings__navlist--subs button').evaluateAll((els) => els.map((e) => (e.querySelector('.axf-settings__navlabel') ?? e).textContent.trim().slice(0, 40)));
      for (let i = 0; i < (process.env.LOOK_REGRESSION_SKIP_SUBROWS ? 0 : Math.min(subRows.length, 80)); i += 1) {
        const sel = '.axf-settings__navlist--subs .axf-settings__nav, .axf-settings__navlist--subs [role="button"], .axf-settings__navlist--subs button';
        let el = this.page.locator(sel).nth(i);
        if (!(await el.count())) { if (!(await this.openSettings())) break; await rowEl.click({ timeout: 2000 }).catch(() => {}); await sleep(400); el = this.page.locator(sel).nth(i); if (!(await el.count())) continue; }
        await el.click({ timeout: 1500 }).catch(() => {});
        await sleep(400);
        await this.expandAll();
        await this.freeze();
        entry.tabs.push(subRows[i]);
        await this.shot(`settings ${row.label} ${subRows[i]}`, { settings: row.label, tab: subRows[i] });
        const back = this.page.locator('.axf-settings__crumbs button').first();
        if (await back.count()) { await back.click({ timeout: 1500 }).catch(() => {}); await sleep(300); }
      }
      const tabs = await this.page.locator('.axf-settings__panel [role="tablist"] [role="tab"], .axf-settings__subtabs [role="tab"]').evaluateAll((els) => els.map((e) => e.textContent.trim().slice(0, 40)));
      for (let i = 0; i < Math.min(tabs.length, 40); i += 1) {
        const tab = this.page.locator('.axf-settings__panel [role="tablist"] [role="tab"], .axf-settings__subtabs [role="tab"]').nth(i);
        if (!(await tab.count())) continue;
        await tab.click({ timeout: 1500 }).catch(() => {});
        await sleep(350);
        await this.expandAll();
        await this.freeze();
        entry.tabs.push(tabs[i]);
        await this.shot(`settings ${row.label} ${tabs[i]}`, { settings: row.label, tab: tabs[i] });
        // one more level (Settings → Plugins → a plugin's own tabs)
        const inner = await this.page.locator('.axf-settings__panel [role="tabpanel"] [role="tablist"] [role="tab"]').evaluateAll((els) => els.map((e) => e.textContent.trim().slice(0, 40)));
        for (let j = 0; j < Math.min(inner.length, 20); j += 1) {
          const t2 = this.page.locator('.axf-settings__panel [role="tabpanel"] [role="tablist"] [role="tab"]').nth(j);
          if (!(await t2.count())) continue;
          await t2.click({ timeout: 1500 }).catch(() => {});
          await sleep(300);
          await this.expandAll();
          await this.shot(`settings ${row.label} ${tabs[i]} ${inner[j]}`, { settings: row.label, tab: tabs[i], inner: inner[j] });
        }
      }
      this.rec.settings.push(entry);
    }
  }
  /** Saved settings round trip through the Appearance picker (colour theme slot, else the skin slot). */
  async roundTrip(home) {
    const result = { ok: false, slot: null, note: '' };
    const before = await this.page.evaluate(auditVars);
    const storage = await this.page.evaluate(() => JSON.stringify(Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)]))));
    const appearance = (this.rec.settings ?? []).find((s) => /appearance/i.test(s.section));
    if (!appearance || !(await this.openSettings())) { result.note = 'no Appearance section'; this.rec.roundTrip = result; return; }
    const rows = await this.settingsRows();
    const row = rows.find((r) => /appearance/i.test(r.label));
    if (row) { await this.page.locator('.axf-settings__navlist .axf-settings__nav, .axf-settings__navlist [role="button"], .axf-settings__navlist button, .axf-settings__tabs [role="tab"]').nth(row.i).click({ timeout: 2000 }).catch(() => {}); await sleep(400); }
    await this.expandAll();
    let select = null;
    for (const [slot, sel] of [['color-theme', '[data-axf-anchor="settings-slot:color-theme"] select, select[aria-label="Colour theme"], select[aria-label="Color theme"]'], ['skin', '[data-axf-anchor="settings-slot:skin"] select, select[aria-label="Skin"]'], ['design-package', '[data-axf-anchor="settings-slot:design-package"] select, select[aria-label="Design package"], select[aria-label="AmberX Design Package"]']]) {
      const s = this.page.locator(sel).first();
      if (await s.count()) { select = s; result.slot = slot; break; }
    }
    if (!select) { result.note = 'no slot picker (color-theme / skin / design-package)'; this.rec.roundTrip = result; return; }
    const options = await select.locator('option').evaluateAll((o) => o.map((x) => x.value));
    const original = await select.inputValue();
    const other = options.find((o) => o && o !== original);
    if (!other) { result.note = 'only one option'; this.rec.roundTrip = result; return; }
    await select.selectOption(other); await sleep(500);
    const picked = await this.page.evaluate(auditVars);
    const changedNow = Object.keys(picked.root).filter((k) => picked.root[k] !== before.root[k]).length;
    await this.page.goto(home); await sleep(1200); await this.freeze();
    const afterReload = await this.page.evaluate(auditVars);
    const changedAfter = Object.keys(afterReload.root).filter((k) => afterReload.root[k] !== before.root[k]).length;
    const keysAfter = await this.page.evaluate(storageShape);
    // restore
    await this.page.evaluate((s) => { localStorage.clear(); for (const [k, v] of Object.entries(JSON.parse(s))) localStorage.setItem(k, v); }, storage);
    await this.page.goto(home); await sleep(1200); await this.freeze();
    const restored = await this.page.evaluate(auditVars);
    const notRestored = Object.keys(before.root).filter((k) => restored.root[k] !== before.root[k]);
    Object.assign(result, { ok: changedNow > 0 && changedAfter > 0 && notRestored.length === 0, original, picked: other, changedNow, changedAfter, notRestored: notRestored.slice(0, 20), storageKeysAfterPick: Object.keys(keysAfter).sort() });
    this.rec.roundTrip = result;
  }
}

/** Walk one app at one viewport; writes PNGs under outDir and returns the record. */
export async function walkApp({ chromium, root, app, url, outDir, viewport, full = true }) {
  const rec = { app, viewport, url, shots: [], skipped: [], liveRows: [], errors: [], consoleErrors: [], failed: [], vars: null, storage: null, plugins: null };
  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  const page = await browser.newPage({ viewport: VIEWPORTS[viewport], colorScheme: 'light', locale: 'en-GB', timezoneId: 'UTC' });
  await page.clock?.install?.({ time: new Date('2026-11-09T12:00:00Z') }).catch(() => {});
  let w;
  page.on('pageerror', (e) => rec.errors.push(`${String(e).slice(0, 300)} @ ${w?.current ?? 'load'}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ECONNREFUSED/.test(m.text())) rec.consoleErrors.push(m.text().slice(0, 300)); });
  page.on('response', (r) => { if (r.status() >= 400) rec.failed.push({ url: r.url().replace(url, ''), status: r.status() }); });
  page.on('requestfailed', (r) => { if (!/\/api\/events|ws:/.test(r.url())) rec.failed.push({ url: r.url().replace(url, ''), status: 'failed' }); });
  if (app !== 'console-web') {
    await page.route('**/api/me', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ wall: false, hub: 'https://axhub.amberxai.com', appearanceHub: 'off', user: null, admin: true, role: 'admin', themes: true, plugins: [] }) }));
  }
  // the live hub is never read in a regression run: every hub file is "not there", deterministically (the default look)
  await page.route(/^https?:\/\/[^/]*axhub\.amberxai\.com\//, (r) => r.fulfill({ status: 404, contentType: 'application/json', headers: { 'access-control-allow-origin': url, 'access-control-allow-credentials': 'true' }, body: '{}' }));
  w = new Walker(page, outDir, rec, `${url}/`);
  try {
    await page.goto(`${url}/`, { waitUntil: 'load', timeout: 60_000 });
    await sleep(2000);
    await w.freeze();
    rec.vars = await page.evaluate(auditVars);
    rec.storage = await page.evaluate(storageShape);
    if (app === 'console-web') rec.plugins = await fetch(`${url}/api/plugins`).then((r) => r.json()).then((j) => (Array.isArray(j) ? j : j.items ?? j.plugins ?? j)).catch((e) => ({ error: String(e) }));
    await w.shot('home');
    if (full && !process.env.LOOK_REGRESSION_SETTINGS_ONLY) await w.walkMenus(`${url}/`);
    else {
      // phone: the menu tree is recorded (what is reachable) but only home + settings are shot
      const btns = await page.locator('[data-axf-menu-btn]').evaluateAll((els) => els.map((e) => e.getAttribute('data-axf-menu-btn')));
      rec.menus = {};
      for (const btn of [...new Set(btns)]) rec.menus[btn] = (await w.menuTree(btn)).map((l) => ({ id: l.path.join('/'), label: l.label, disabled: l.disabled, check: l.check }));
    }
    await w.walkSettings();
    if (app === 'console-web') {
      // the console's own catalogue (console-commands@1): what console_open / console_dialog / console_settings can reach
      // in this build, read through the REST route the MCP tools and the CLI use (the open page registered itself)
      rec.catalog = {};
      for (const t of ['console.screens', 'console.dialogs', 'console.settings', 'console.actions']) {
        const r = await fetch(`${url}/api/control/${t}?limit=3000`).then((x) => x.json()).catch((e) => ({ ok: false, error: String(e) }));
        rec.catalog[t] = r.ok ? (r.items ?? []).map((it) => ({ id: it.id, title: it.title ?? it.label ?? '' })).sort((a, b) => a.id.localeCompare(b.id)) : { error: r.message ?? r.error ?? r.code ?? 'no answer' };
      }
    }
    await w.roundTrip(`${url}/`);
  } catch (e) {
    rec.errors.push(`walker: ${String(e).slice(0, 400)}`);
  }
  // dedupe noisy lists
  rec.consoleErrors = [...new Set(rec.consoleErrors)];
  rec.errors = [...new Set(rec.errors)];
  const seen = new Set(); rec.failed = rec.failed.filter((f) => { const k = `${f.status} ${f.url}`; if (seen.has(k)) return false; seen.add(k); return true; });
  await browser.close();
  return rec;
}

export async function webRecord(root, outDir, { apps = APPS, viewports = Object.keys(VIEWPORTS), phoneFull = false } = {}) {
  const require = createRequire(join(root, 'apps/console-web/package.json'));
  let chromium;
  try { ({ chromium } = require('playwright')); } catch { throw new Error('playwright is not installed in apps/console-web (npm i --no-save playwright@1.56.0)'); }
  const out = { at: new Date().toISOString(), apps: {} };
  let i = 0;
  for (const app of apps) {
    const dist = join(root, 'apps', app, 'dist');
    if (!existsSync(dist)) { out.apps[app] = { error: 'no dist/ (build first)' }; console.error(`${app}: no dist/`); continue; }
    const port = BASE_PORT + (i += 1);
    let server;
    try { server = await serve(root, app, port); } catch (e) { out.apps[app] = { error: String(e).slice(0, 600) }; console.error(`${app}: ${e.message}`); continue; }
    try {
      for (const vp of viewports) {
        console.error(`${app} ${vp}…`);
        const rec = await walkApp({ chromium, root, app, url: server.url, outDir: join(outDir, 'shots', app, vp), viewport: vp, full: vp === 'desktop' || phoneFull });
        out.apps[`${app}/${vp}`] = rec;
        console.error(`  ${rec.shots.length} shots · ${rec.errors.length} page errors · ${rec.consoleErrors.length} console errors · ${rec.failed.length} failed requests · ${rec.vars?.missing?.length ?? '?'} missing vars`);
      }
    } finally { server.stop(); }
  }
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'web.json'), JSON.stringify(out, null, 1));
  return out;
}
