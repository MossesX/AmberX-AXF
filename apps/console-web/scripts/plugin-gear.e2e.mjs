#!/usr/bin/env node
/**
 * Every plugin screen shows exactly one settings gear (build every-plugin-screen-gets-a-settings-gear), end to end against
 * `vite preview` of dist/: opens every plugin view in the control inventory, counts the settings-icon buttons on it
 * (the host gear `[data-axf-plugin-gear]` plus any hand-made one), checks the host gear sits in a role="toolbar" row
 * that does not overlap the screen's page head, and that pressing it opens that plugin's Settings → Plugins sub-tab.
 *
 *   node scripts/plugin-gear.e2e.mjs            (build first: npm run build)
 *   PG_E2E_PORT=7099 · PW_CHROMIUM=<chromium path> · PG_E2E_SHOTS=<dir> (desktop + phone shot of each placement check)
 *   PG_E2E_ONLY=gate,ui-review (only these views)
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = join(APP, '../..');
const PORT = Number(process.env.PG_E2E_PORT) || 7099;
const SHOTS = process.env.PG_E2E_SHOTS;
const ONLY = (process.env.PG_E2E_ONLY ?? '').split(',').map((s) => s.trim()).filter(Boolean);
let playwright;
for (const base of [APP, ROOT, process.env.PLAYWRIGHT_DIR, '/tmp/sc-pw'].filter(Boolean)) { try { playwright = createRequire(join(base, 'x.js'))('playwright'); break; } catch { /* next */ } }
if (!playwright) { try { playwright = await import('playwright'); } catch { console.error('playwright not found (npm i -D playwright, or PLAYWRIGHT_DIR)'); process.exit(2); } }

const inventory = JSON.parse(readFileSync(join(APP, 'src/control/inventory.json'), 'utf8'));
const offByDefault = new Set(inventory.plugins.filter((p) => { try { const f = p.folder ?? p.id?.split('.').pop(); return JSON.parse(readFileSync(join(APP, 'plugins', f, 'plugin.json'), 'utf8')).enabledByDefault === false; } catch { return false; } }).map((p) => p.id));
const views = inventory.views.filter((v) => v.source === 'plugin' && !offByDefault.has(v.plugin) && (!ONLY.length || ONLY.includes(v.id)));
const skipped = [];
// Screens that cannot draw against the offline mock (no axHub look): theme-manager reads rt.asset(type).data for every
// asset type and throws while a type has no active asset. Not a gear problem; listed so the run says what it skipped.
const KNOWN_OFFLINE = { 'theme-manager': 'needs the axHub look (rt.asset(type).data is undefined offline)' };
const ME = { wall: false, hub: '', appearanceHub: 'off', user: null, admin: true, role: 'admin', themes: true, plugins: [] };
const problems = [];
let checks = 0;
const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { cwd: APP, stdio: 'ignore' });
const stop = () => { try { server.kill('SIGTERM'); } catch { /* gone */ } };
process.on('exit', stop);
let browser;
try {
  let up = false;
  for (let i = 0; i < 120 && !up; i++) { try { up = (await fetch(`http://127.0.0.1:${PORT}/`)).ok; } catch { /* not up yet */ } if (!up) await sleep(500); }
  if (!up) throw new Error(`vite preview on :${PORT} (is dist/ built?)`);
  browser = await playwright.chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
  for (const [name, viewport, mobile] of [['desktop', { width: 1400, height: 900 }, false], ['phone', { width: 390, height: 844 }, true]]) {
    const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
    const page = await ctx.newPage();
    await page.route('**/api/**', (r) => {
      const u = new URL(r.request().url());
      if (u.pathname === '/api/me') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ME) });
      if (r.request().method() === 'GET' && u.pathname === '/api/events') return r.abort();
      return r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'offline (e2e)' }) });
    });
    await page.goto(`http://127.0.0.1:${PORT}/`);
    await page.waitForFunction(() => typeof window.axfConsoleControl === 'function', null, { timeout: 30_000 });
    const ready = async () => { await page.goto(`http://127.0.0.1:${PORT}/`); await page.waitForFunction(() => typeof window.axfConsoleControl === 'function', null, { timeout: 30_000 }); };
    const run = (cmd) => page.evaluate((c) => window.axfConsoleControl(c), cmd).catch((e) => ({ ok: false, error: String(e) }));
    for (const v of views) {
      // a screen that crashed the page offline leaves no control API: start the next one on a fresh page
      if (!(await page.evaluate(() => typeof window.axfConsoleControl === 'function').catch(() => false))) await ready();
      await page.keyboard.press('Escape');
      if (KNOWN_OFFLINE[v.id]) { skipped.push(`${name} ${v.id}: ${KNOWN_OFFLINE[v.id]}`); continue; }
      const opened = await run({ verb: 'open', address: v.address });
      if (opened?.ok === false && opened.code === 'not_found') { skipped.push(`${name} ${v.id}: not registered offline`); continue; }
      const sel = `.fx-main__inner[data-axf-view="${v.id}"]:not([hidden])`;
      try { await page.waitForSelector(`${sel} [data-axf-plugin-gear], ${sel} [data-axf-plugin-host]`, { timeout: 15_000 }); } catch { /* counted below */ }
      const r = await page.evaluate((s) => {
        const root = document.querySelector(s);
        if (!root) return { missing: true };
        const host = root.querySelectorAll('[data-axf-plugin-gear]');
        // every button drawing the same glyph as the host gear, with no text (a gear icon, wherever it came from)
        const glyph = host[0]?.querySelector('svg, .fx-icon')?.innerHTML ?? '';
        const all = glyph ? [...root.querySelectorAll('button')].filter((b) => !b.textContent?.trim() && b.querySelector('svg, .fx-icon')?.innerHTML === glyph) : [];
        const bar = host[0]?.closest('[role="toolbar"]');
        const head = root.querySelector('.fx-pagehead');
        const overlap = bar && head ? (() => { const a = bar.getBoundingClientRect(); const b = head.getBoundingClientRect(); return a.bottom > b.top + 1 && a.top < b.bottom - 1 && a.right > b.left && a.left < b.right; })() : false;
        return { host: host.length, icons: all.length, toolbar: !!bar, aria: bar?.getAttribute('aria-label') ?? '', overlap, opens: host[0]?.getAttribute('data-axf-opens') ?? '' };
      }, sel);
      checks++;
      if (r.missing) { problems.push(`${name} ${v.id}: the screen did not render`); continue; }
      if (r.host !== 1) problems.push(`${name} ${v.id}: ${r.host} host gears (want 1)`);
      if (r.icons > 1) problems.push(`${name} ${v.id}: ${r.icons} settings gears on screen (want 1)`);
      if (!r.toolbar || !r.aria) problems.push(`${name} ${v.id}: the gear is not in a labelled role="toolbar"`);
      if (r.overlap) problems.push(`${name} ${v.id}: the gear row overlaps the page head`);
      if (SHOTS && ONLY.length) await page.screenshot({ path: join(SHOTS, `gear-${v.id}-${name}.png`) });
      // press it once (desktop: mouse click, no tap-confirm) and see the plugin's sub-tab open
      if (name === 'desktop' && r.host === 1) {
        await page.click(`${sel} [data-axf-plugin-gear]`);
        const tab = r.opens.split('settings.subtabs=')[1];
        try { await page.waitForSelector(`[data-axf-settings-tab="${tab}"], [data-axf-settings-sub="${tab}"]`, { timeout: 5_000 }); } catch {
          const st = await page.evaluate(() => window.axfConsoleControlState?.());
          if (!st?.dialog?.startsWith('axf.settings')) problems.push(`${name} ${v.id}: pressing the gear did not open Settings (${st?.dialog ?? 'no dialog'})`);
        }
        await page.keyboard.press('Escape');
      }
    }
    await ctx.close();
  }
  for (const p of skipped) console.log(`- ${p}`);
  for (const p of problems) console.error(`✗ ${p}`);
  console.log(`plugin-gear e2e: ${views.length} plugin screens × 2 viewports, ${checks} checked, ${problems.length} problem(s)${SHOTS ? ` (shots in ${SHOTS})` : ''}`);
  if (problems.length) process.exitCode = 1;
} catch (e) {
  console.error(String(e?.stack ?? e).split('\n').slice(0, 8).join('\n'));
  process.exitCode = 1;
} finally {
  await browser?.close();
  stop();
}
