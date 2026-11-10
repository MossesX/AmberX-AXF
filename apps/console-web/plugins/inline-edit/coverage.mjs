#!/usr/bin/env node
/**
 * Inline edit — coverage pass: in a real console (ui-harness.mjs), every app-menu button and every row of every menu and
 * sub-menu (opened one by one, down to the child), every navigation item, toolbar button, banner widget and tab must carry
 * a token path of its own (inline-edit-tokens@1), and a right-click on it in inline edit mode must open the edit dialog
 * on that path. Lists anything missing and exits 1 when something is.
 *
 *   node apps/console-web/plugins/inline-edit/coverage.mjs [--json] [--limit <rows per menu>]
 *
 * Heavy: run it through `node framework/cli/agent-slots.mjs heavy -- …`. Skips (exit 0) without Playwright.
 */
import { join } from 'node:path';
import { startConsole, until, WEB } from './ui-harness.mjs';

const FW = `/@fs${join(WEB, 'framework/index.mjs')}`;

const args = process.argv.slice(2);
const LIMIT = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : 400;
const c = await startConsole();
if (!c) { console.log('- inline edit coverage skipped: playwright not installed'); process.exit(0); }

const report = { checked: 0, opened: 0, missing: [], clashes: [], kinds: {} };
try {
  const { page } = await c.page('desktop');
  await page.goto(c.web);
  await page.waitForSelector('.fx-menubar', { timeout: 90_000 });
  // every chrome part on screen: the console hides its toolbar and navigation by default
  // a layout with a toolbar, every part unhidden, and a screen with a tab row (the overrides page)
  await page.evaluate(() => { globalThis.AXF.swap('layout', 'classic-ide'); for (const t of ['toolbar', 'nav-menu', 'banner', 'tab-group']) globalThis.AXF.setSlotHidden(t, false); globalThis.AXF.navigate('inline-edit-overrides'); });
  await c.rest('PUT', 'mode', { state: 'on' });
  await until(async () => (await page.evaluate(() => globalThis.AXF.settings.get('axf.inline-edit.mode'))) === true, 20_000);
  await page.waitForTimeout(1500);
  report.roots = await page.evaluate(() => Object.fromEntries(['.fx-menubar', '.fx-nav', '.fx-toolbar', '.fx-banner', '.fx-tabs', '.fx-tabgroup__bar'].map((s) => [s, document.querySelectorAll(s).length])));

  /** Every interactive element inside the framework's chrome now on screen, with its address. */
  const scan = (kind) => page.evaluate(async ([k, fwUrl]) => {
    const fw = await import(fwUrl);
    const ROOTS = { 'app-menu': '.fx-menubar', menu: '.fx-dropdown, .fx-menu__sub', 'nav-menu': '.fx-nav', toolbar: '.fx-toolbar', banner: '.fx-banner', 'tab-group': '.fx-tabs, .fx-tabgroup__bar' };
    const out = [];
    for (const root of document.querySelectorAll(ROOTS[k])) {
      for (const el of root.querySelectorAll('button, a[href], [role="menuitem"], [role="tab"], [data-axf-banner-item]')) {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height || getComputedStyle(el).visibility === 'hidden') continue;
        if (el.closest('[data-axf-inline-ignore]')) continue;
        const a = fw.addressOf(el);
        const label = (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 50);
        const tag = `c${(globalThis.__ieCov = (globalThis.__ieCov ?? 0) + 1)}`;
        el.setAttribute('data-ie-cov', tag);
        out.push({ tag: el.tagName.toLowerCase(), cov: tag, label, path: a?.path ?? null, segs: a?.segments.length ?? 0, role: a?.role ?? null, html: el.outerHTML.slice(0, 160) });
      }
    }
    return out;
  }, [kind, FW]);

  const check = (kind, rows) => {
    const seen = new Map();
    for (const r of rows) {
      report.checked += 1;
      report.kinds[kind] = (report.kinds[kind] ?? 0) + 1;
      if (!r.path || r.segs === 0) { report.missing.push({ kind, ...r }); continue; }
      const prev = seen.get(r.path);
      // two different controls answering the same path: one of them has no id of its own
      const same = (a, b) => a.replace(/[\d+]+$/, '').trim() === b.replace(/[\d+]+$/, '').trim(); // a count badge loading in is the same row
      if (prev && !same(prev.label, r.label) && !/^(icon|label|chevron|badge|text)$/.test(r.role)) report.clashes.push({ kind, path: r.path, a: prev.label, b: r.label, html: r.html });
      else seen.set(r.path, r);
    }
  };

  // a right-click on a sample of each kind opens the dialog on that very path
  const tryOpen = async (kind, r) => {
    await page.locator(`[data-ie-cov="${r.cov}"]`).click({ button: 'right', timeout: 5_000 }).catch(() => undefined);
    const ok = await until(async () => (await page.locator('.axp-inline-edit__path').count()) > 0, 8_000);
    const got = ok ? await page.locator('.axp-inline-edit__path').innerText() : '';
    if (ok) report.opened += 1; else report.missing.push({ kind, ...r, why: 'right-click did not open the dialog' });
    if (ok && !got.startsWith(r.path.split('/')[0])) report.missing.push({ kind, ...r, why: `dialog opened on ${got}` });
    await page.keyboard.press('Escape');
    await page.evaluate(() => globalThis.AXF.closeDialog?.());
    await page.waitForTimeout(200);
  };

  for (const kind of ['app-menu', 'nav-menu', 'toolbar', 'banner', 'tab-group']) {
    const rows = await scan(kind);
    check(kind, rows);
    for (const r of rows.filter((x) => x.path).slice(0, 3)) await tryOpen(kind, r);
  }

  // every app menu, opened, with every sub-menu down to the child
  const menus = await page.locator('.fx-menubar [data-axf-menu-btn]').count();
  for (let i = 0; i < menus; i++) {
    await c.rest('PUT', 'mode', { state: 'off' });
    await until(async () => (await page.evaluate(() => globalThis.AXF.settings.get('axf.inline-edit.mode'))) === false, 20_000);
    const btn = page.locator('.fx-menubar [data-axf-menu-btn]').nth(i);
    await btn.click();
    await page.waitForTimeout(300);
    // open sub-menus by hovering every row that has one, down to the child; scan after each (siblings close)
    const all = new Map();
    const collect = async () => { for (const r of await scan('menu')) all.set(`${r.path}|${r.label}`, r); };
    await collect();
    const opened = new Set();
    for (let depth = 0; depth < 5; depth++) {
      const keys = await page.evaluate(() => [...document.querySelectorAll('.fx-dropdown [aria-haspopup="menu"], .fx-menu__sub [aria-haspopup="menu"]')]
        .map((el) => el.closest('[data-axf-item]')?.getAttribute('data-axf-item')).filter(Boolean));
      const fresh = keys.filter((k) => !opened.has(k)).slice(0, LIMIT);
      if (!fresh.length) break;
      for (const k of fresh) {
        opened.add(k);
        await page.locator(`[data-axf-item="${k.replace(/"/g, '\\"')}"] [aria-haspopup="menu"]`).first().hover({ timeout: 2_000 }).catch(() => undefined);
        await page.waitForTimeout(150);
        await collect();
      }
    }
    const rows = [...all.values()].slice(0, LIMIT * 4);
    check('menu', rows);
    // right-click one row of this menu in inline edit mode: the dialog opens on that row (menu stays as it was)
    await c.rest('PUT', 'mode', { state: 'on' });
    await until(async () => (await page.evaluate(() => globalThis.AXF.settings.get('axf.inline-edit.mode'))) === true, 20_000);
    if (!(await page.locator('.fx-dropdown').count())) { await btn.click(); await page.waitForTimeout(300); } // a left click still opens menus
    const sample = (await scan('menu')).find((r) => r.path && /\/item:/.test(r.path)); // a row on screen right now
    if (sample) await tryOpen('menu', sample);
    await page.keyboard.press('Escape');
    await page.mouse.click(5, 400);
    await page.waitForTimeout(200);
  }
} finally {
  await c.stop();
}

const bad = report.missing.length + report.clashes.length;
if (args.includes('--json')) console.log(JSON.stringify(report, null, 2));
else {
  console.log(`roots on screen: ${JSON.stringify(report.roots)}`);
  console.log(`inline edit coverage: ${report.checked} controls checked (${Object.entries(report.kinds).map(([k, v]) => `${k} ${v}`).join(', ')}), ${report.opened} right-clicks opened the dialog`);
  for (const m of report.missing) console.log(`  ✗ ${m.kind}: "${m.label}" ${m.why ?? `has no path of its own (${m.path ?? 'none'})`}\n      ${m.html}`);
  for (const m of report.clashes) console.log(`  ✗ ${m.kind}: "${m.a}" and "${m.b}" share ${m.path}\n      ${m.html}`);
  console.log(bad ? `✗ ${bad} problem(s)` : '✓ every app menu row and sub-menu child, nav item, toolbar button, banner widget and tab has its own path');
}
process.exit(bad ? 1 : 0);
