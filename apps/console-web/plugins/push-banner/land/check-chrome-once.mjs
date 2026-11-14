#!/usr/bin/env node
/**
 * Doubled-chrome check after a redeploy (build land-finish-auto-land-live-clear-backlog): the built console shows one
 * banner and one menu bar, never two (landing many builds at once has stacked a second app shell before). Plain Node +
 * a headless Chromium (Playwright); no model calls.
 *
 * It opens the console with its token, waits for the app, and counts the top-level chrome: banners
 * (data-fx-ctx-target="banner" | "axf-banner") and menu bars (role="menubar"), on desktop and phone. More than one of
 * either = doubled. When the app can't be reached headless (an axHub sign-in wall, the hub not answering) the verdict is
 * `unknown` with the reason, never a pass.
 *
 *   node apps/console-web/plugins/push-banner/land/check-chrome-once.mjs [--url u] [--shots dir] [--json]
 *
 * Env: AXF_CONSOLE_URL (default https://console.amberxai.com), AXF_TOKEN_FILE (default /opt/axf/.axf-console/env),
 * AXF_PLAYWRIGHT_DIR (a folder whose node_modules has playwright), PLAYWRIGHT_BROWSERS_PATH.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FRAME = 'chrome-once@1';
export const VIEWPORTS = Object.freeze({ desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } });

/** The verdict for one page's counts: ok | doubled | unknown. Pure. */
export function verdict(counts) {
  if (!counts || counts.blocked) return { verdict: 'unknown', why: counts?.blocked || 'the page did not load' };
  const extra = [];
  if (counts.banners > 1) extra.push(`${counts.banners} banners`);
  if (counts.menubars > 1) extra.push(`${counts.menubars} menu bars`);
  return extra.length ? { verdict: 'doubled', why: extra.join(', ') } : { verdict: 'ok', why: `${counts.banners} banner, ${counts.menubars} menu bar` };
}

/** Both viewports together: doubled wins, then unknown, then ok. */
export function overall(byViewport) {
  const vs = Object.entries(byViewport).map(([k, v]) => ({ k, ...verdict(v) }));
  const pick = vs.find((v) => v.verdict === 'doubled') || vs.find((v) => v.verdict === 'unknown') || vs[0];
  return { verdict: pick?.verdict || 'unknown', why: vs.map((v) => `${v.k}: ${v.why}`).join('; ') };
}

function loadPlaywright() {
  const bases = [process.env.AXF_PLAYWRIGHT_DIR, resolve(fileURLToPath(import.meta.url), '../../../..'), '/opt/axf/apps/console-web', '/root/expense-tracker', '/tmp/sc-pw'].filter(Boolean);
  for (const b of bases) { try { return createRequire(join(b, 'x.js'))('playwright'); } catch { /* next */ } }
  return null;
}

function token() {
  const f = process.env.AXF_TOKEN_FILE || '/opt/axf/.axf-console/env';
  try { return /^AXF_TOKEN=(.*)$/m.exec(readFileSync(f, 'utf8'))?.[1]?.trim() || ''; } catch { return ''; }
}

/** Open the console on each viewport and count its chrome. Returns { $axf, at, url, verdict, why, viewports }. */
export async function checkChrome({ url = process.env.AXF_CONSOLE_URL || 'https://console.amberxai.com/', shots = '', settleMs = 6000 } = {}) {
  const pw = loadPlaywright();
  const at = new Date().toISOString();
  if (!pw) return { $axf: FRAME, at, url, verdict: 'unknown', why: 'playwright is not installed here', viewports: {} };
  if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync('/root/.cache/ms-playwright')) process.env.PLAYWRIGHT_BROWSERS_PATH = '/root/.cache/ms-playwright';
  const tok = token();
  const b = await pw.chromium.launch();
  const viewports = {};
  try {
    for (const [name, vp] of Object.entries(VIEWPORTS)) {
      const ctx = await b.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: !!vp.isMobile, hasTouch: !!vp.hasTouch, deviceScaleFactor: vp.deviceScaleFactor || 1 });
      if (tok) await ctx.addInitScript((t) => { try { localStorage.setItem('axf-console:token', t); } catch { /* blocked */ } }, tok);
      const p = await ctx.newPage();
      try {
        await p.goto(url, { waitUntil: 'load', timeout: 60000 }); await p.waitForTimeout(settleMs);
        viewports[name] = await p.evaluate(() => {
          const t = document.title || ''; const text = document.body?.innerText || '';
          const blocked = /sign in/i.test(t) ? 'the axHub sign-in wall (no hub session headless)' : /Waiting for axHub/.test(text) ? 'the console is waiting for axHub' : '';
          return { title: t, blocked, banners: document.querySelectorAll('[data-fx-ctx-target="banner"],[data-fx-ctx-target="axf-banner"]').length, menubars: document.querySelectorAll('[role="menubar"]').length };
        });
        if (shots) { mkdirSync(shots, { recursive: true }); await p.screenshot({ path: join(shots, `console-${name}.png`) }); }
      } catch (e) { viewports[name] = { blocked: `could not open it: ${String(e.message).split('\n')[0].slice(0, 160)}` }; }
      await ctx.close();
    }
  } finally { await b.close(); }
  return { $axf: FRAME, at, url, ...overall(viewports), viewports };
}

export async function main(argv) {
  const opt = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
  const r = await checkChrome({ url: opt('url'), shots: opt('shots') || '' });
  console.log(argv.includes('--json') ? JSON.stringify(r, null, 1) : `${r.verdict}: ${r.why}`);
  return r.verdict === 'doubled' ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { console.error(e.message); process.exit(1); });
}
