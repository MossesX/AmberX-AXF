#!/usr/bin/env node
/**
 * Live theme-swap check for the built console (`npm run build` first).
 *
 *   node scripts/theme-swap.mjs            # serves dist/ with `vite preview` on :7098 and drives Chromium
 *
 * Opens Settings (the settings library plus every installed plugin's settings panels), switches through every
 * colour theme and records each visible element's text, background and border colour. Any colour that stays the
 * same in every theme is hard-coded and fails the check. It then switches style themes and checks that the
 * transparency tokens (--fx-opacity-*) follow, then picks every typography / density / sizing asset and checks the sizes
 * on screen follow too (Angel build ui-all-assets). Needs the `playwright` package and a Chromium.
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';

const PORT = 7098;
const lines = [];
const log = (m) => { lines.push(m); console.log(m); };
/** In CI, problems also become annotations so they're readable without downloading logs. */
const annotate = (m) => { if (process.env.GITHUB_ACTIONS) console.log(`::error title=Theme swap::${m.replace(/\n/g, '%0A')}`); };
const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { stdio: 'inherit' });
let failed = false;
try {
  // Bind and probe 127.0.0.1 explicitly: on CI runners "localhost" can resolve to ::1 only.
  let up = false;
  for (let i = 0; i < 60 && !up; i += 1) {
    try { up = (await fetch(`http://127.0.0.1:${PORT}/`)).ok; } catch { /* not up yet */ }
    if (!up) await sleep(500);
  }
  if (!up) throw new Error(`vite preview did not start on 127.0.0.1:${PORT} within 30 s (is dist/ built?)`);
  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  const page = await browser.newPage({ viewport: { width: 412, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  // No console server here: answer /api/me ourselves with the appearance source off (the console is a developer app and
  // would otherwise wait for axHub); the check is about the engines, not the hub.
  await page.route('**/api/me', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ wall: false, hub: 'https://axhub.amberxai.com', appearanceHub: 'off', user: null, admin: true, role: 'admin', themes: true, plugins: [] }) }));
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForTimeout(1500);
  // Open Settings: the side navigation is hidden by default since Oct 21 2026, so go through the application menu
  // (Console → Settings); fall back to a visible Settings button for layouts that still show the navigation.
  const navSettings = page.getByRole('button', { name: 'Settings' }).first();
  if (await navSettings.isVisible().catch(() => false)) await navSettings.click();
  else {
    await page.locator('[data-axf-menu-btn="console"]').click();
    await page.getByRole('menuitem', { name: 'Settings', exact: true }).first().click();
  }
  await page.waitForTimeout(500);
  // Compact settings (Oct 30 2026): on a phone the settings open as a list of sections; tap Appearance.
  const appearanceRow = page.locator('.axf-settings__nav', { hasText: 'Appearance' }).first();
  if (await appearanceRow.isVisible().catch(() => false)) { await appearanceRow.click(); await page.waitForTimeout(400); }

  // Settings → Appearance → Assets puts each slot's picker in its own collapsible card (Oct 24 2026): open the colour
  // and style theme cards and use the picker inside each (the slot's first drop-down), not "the first select on the page".
  // Settings → Appearance keeps everything under the Design Package picker in one collapsible "Everything else"
  // container (Oct 27 2026, closed by default): open it first.
  const rest = page.locator('[data-axf-anchor="settings-panel:axf.appearance.rest"] :is(.fx-card__toggle, .axf-settings__gtoggle)').first();
  if ((await rest.count()) && (await rest.getAttribute('aria-expanded')) === 'false') { await rest.click(); await page.waitForTimeout(300); }
  const slotPicker = async (type) => {
    const card = page.locator(`[data-axf-anchor="settings-slot:${type}"]`);
    if (!(await card.count())) return page.locator('select').filter({ has: page.locator(`option[value="${type === 'color-theme' ? 'arctic-daylight' : 'glass-orbit'}"]`) }).first();
    const toggle = card.locator('.fx-card__toggle').first();
    if ((await toggle.count()) && (await toggle.getAttribute('aria-expanded')) === 'false') { await toggle.click(); await page.waitForTimeout(300); }
    return card.locator('select').first();
  };
  const pickers = [await slotPicker('color-theme'), await slotPicker('style-theme')];
  const valuesOf = (i) => pickers[i].locator('option').evaluateAll((o) => o.map((x) => x.value));
  const snapshot = () => page.evaluate(() => {
    const out = {};
    [...document.querySelectorAll('body *')].forEach((e, i) => {
      const cs = getComputedStyle(e);
      if (e.offsetParent === null && cs.position !== 'fixed') return;
      // brand marks keep their brand colours in every theme (branding@1 palette; DESIGN-LANGUAGE.md §6, §9)
      if (e.closest('.fx-brand, .fx-brand-watermark, svg[role="img"]')) return;
      const name = `${typeof e.className === 'string' && e.className ? e.className.split(' ')[0] : e.tagName.toLowerCase()}#${i}`;
      const v = { color: cs.color };
      if (cs.backgroundColor !== 'rgba(0, 0, 0, 0)') v.background = cs.backgroundColor;
      if (parseFloat(cs.borderTopWidth) > 0 && cs.borderTopColor !== 'rgba(0, 0, 0, 0)') v.border = cs.borderTopColor;
      out[name] = v;
    });
    return out;
  });

  const colourThemes = await valuesOf(0);
  const snaps = [];
  for (const t of colourThemes) {
    await pickers[0].selectOption(t);
    await page.waitForTimeout(400);
    snaps.push(await snapshot());
  }
  const names = Object.keys(snaps[0]).filter((n) => snaps.every((s) => s[n]));
  const stuck = [];
  for (const n of names) {
    for (const prop of ['color', 'background', 'border']) {
      const vals = snaps.map((s) => s[n][prop]);
      if (vals[0] && vals.every((v) => v === vals[0])) stuck.push(`${n} ${prop} ${vals[0]}`);
    }
  }
  log(`colour themes ${colourThemes.join(', ')}: ${names.length} elements, ${stuck.length} colours that never changed`);
  for (const s of stuck.slice(0, 40)) log(`  ✗ ${s}`);
  if (stuck.length) failed = true;

  const styleSelect = (await pickers[1].count()) && (await valuesOf(1)).includes('glass-orbit') ? 1 : -1;
  if (styleSelect < 0) {
    log('✗ no style-theme picker found');
    failed = true;
  } else {
    const seen = new Set();
    for (const st of await valuesOf(styleSelect)) {
      await pickers[styleSelect].selectOption(st);
      await page.waitForTimeout(300);
      const vals = await page.evaluate(() => ['disabled', 'muted', 'hover', 'tint', 'scrim', 'glass'].map((k) => getComputedStyle(document.documentElement).getPropertyValue(`--fx-opacity-${k}`).trim()));
      log(`style theme ${st}: opacity ${vals.join(' / ')}`);
      if (vals.some((v) => v === '')) { log('  ✗ a transparency token is missing'); failed = true; }
      seen.add(vals.join('/'));
    }
    if (seen.size < 2) { log('✗ transparency tokens did not change between style themes'); failed = true; }
  }
  // Scale assets (typography@1, density@1, sizing@1; Angel build ui-all-assets): every pick must move the sizes on screen.
  const sizes = (props) => page.evaluate((props) => {
    const out = {};
    [...document.querySelectorAll('body *')].forEach((e, i) => {
      if (e.offsetParent === null) return;
      const cs = getComputedStyle(e);
      const v = props.map((p) => cs.getPropertyValue(p)).join(' ');
      if (!/[1-9]/.test(v)) return;
      out[i] = v;
    });
    return out;
  }, props);
  // [CSS properties to watch, share of sized elements that must follow]: sizing owns only some pieces (buttons, chips, tabs, tables, cards)
  const SCALE = { typography: [['font-size'], 0.2], density: [['row-gap', 'column-gap', 'padding-top', 'padding-left'], 0.5], sizing: [['padding-top', 'padding-left', 'min-height', 'font-size'], 0.1] };
  for (const [type, [props, share]] of Object.entries(SCALE)) {
    const picker = await slotPicker(type);
    const ids = (await picker.count()) ? await picker.locator('option').evaluateAll((o) => o.map((x) => x.value)) : [];
    if (ids.length < 2) { log(`✗ no ${type} picker with two or more assets`); failed = true; continue; }
    const shots = [];
    for (const id of ids) { await picker.selectOption(id); await page.waitForTimeout(300); shots.push(await sizes(props)); }
    await picker.selectOption(ids.includes('compact') ? 'compact' : ids[0]);
    const keys = Object.keys(shots[0]).filter((k) => shots.every((s) => k in s));
    const moved = keys.filter((k) => new Set(shots.map((s) => s[k])).size > 1).length;
    log(`${type} ${ids.join(', ')}: ${moved} of ${keys.length} sized elements follow the pick`);
    if (moved < Math.max(5, keys.length * share)) { log(`  ✗ ${type}: too few sizes follow the asset (hard-coded sizes left?)`); failed = true; }
  }
  if (errors.length) { log(`✗ page errors:\n  ${errors.join('\n  ')}`); failed = true; }
  await browser.close();
} catch (err) {
  log(`✗ the check could not run: ${err instanceof Error ? err.message : String(err)}`);
  failed = true;
} finally {
  server.kill();
}
console.log(failed ? "✗ theme swap check failed" : "✓ every colour, transparency and size follows the active themes and scale assets");
if (failed) annotate(lines.filter((l) => l.includes('✗')).slice(0, 30).join('\n') || 'failed');
process.exit(failed ? 1 : 0);
