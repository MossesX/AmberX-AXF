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
 * on screen follow too (Angel build ui-all-assets). Then it switches every shipped skin (skin@2) through the skin
 * gallery's live preview and fails on a colour, size or behaviour (nav mode, toolbar / banner placement, menu form, tab
 * position and style, the --fx-bhv-* tokens) that does not follow the skin: a hard-coded one. Needs the `playwright`
 * package and a Chromium.
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';

const PORT = Number(process.env.THEME_SWAP_PORT) || 7098;
const lines = [];
const log = (m) => { lines.push(m); console.log(m); };
/** In CI, problems also become annotations so they're readable without downloading logs. */
const annotate = (m) => { if (process.env.GITHUB_ACTIONS) console.log(`::error title=Theme swap::${m.replace(/\n/g, '%0A')}`); };
const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { stdio: 'inherit' });
let failed = false;
let page;
const errors = [];
const consoleErrors = [];
try {
  // Bind and probe 127.0.0.1 explicitly: on CI runners "localhost" can resolve to ::1 only.
  let up = false;
  for (let i = 0; i < 60 && !up; i += 1) {
    try { up = (await fetch(`http://127.0.0.1:${PORT}/`)).ok; } catch { /* not up yet */ }
    if (!up) await sleep(500);
  }
  if (!up) throw new Error(`vite preview did not start on 127.0.0.1:${PORT} within 30 s (is dist/ built?)`);
  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  page = await browser.newPage({ viewport: { width: 412, height: 900 } });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ECONNREFUSED/.test(m.text())) consoleErrors.push(m.text()); });
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
  // Skins (skin@2, build professional-skins Nov 13 2026): switch every shipped skin through the skin gallery's live
  // preview and check that the console follows each one: the root's --fx-bhv-* / data-fx-bhv-* carry the skin's picks,
  // the shell's nav mode, toolbar and banner placement and menu form follow, every tab row on screen takes the skin's
  // position and style, the table padding follows the skin's density, and colours move between skins (a colour that
  // never changes is hard-coded). A behaviour that stays put is hard-coded somewhere and fails the check.
  {
    const { readdirSync, readFileSync } = await import('node:fs');
    const kebab = (s) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
    const skinDir = new URL('../src/axf/assets/skin/', import.meta.url);
    const skins = readdirSync(skinDir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(new URL(f, skinDir), 'utf8'))).filter((a) => a.type === 'skin' && a.data?.behaviour);
    const open = page.getByRole('button', { name: 'Skin gallery…' }).first();
    if (!(await open.count())) { log('✗ no Skin gallery button in Settings → Appearance'); failed = true; }
    else {
      await open.click();
      await page.waitForTimeout(500);
      const cards = page.locator('[data-axf-skin-gallery] [role="option"]');
      const n = await cards.count();
      log(`skin gallery: ${n} cards, ${skins.length} shipped skins with behaviour`);
      if (n < skins.length) { log('✗ the gallery shows fewer cards than there are shipped skins'); failed = true; }
      const skinSnaps = [];
      const skinTablePad = new Set();
      for (const s of skins) {
        const card = cards.filter({ hasText: s.name }).first();
        if (!(await card.count())) { log(`✗ no card for the ${s.name} skin`); failed = true; continue; }
        await card.click();
        await page.waitForTimeout(600);
        const seen = await page.evaluate(() => {
          const root = document.documentElement;
          const attrs = {};
          for (const a of root.attributes) if (a.name.startsWith('data-fx-bhv-')) attrs[a.name] = a.value;
          const cs = getComputedStyle(root);
          const nav = document.querySelector('.fx-region--nav');
          const tabs = [...document.querySelectorAll('.fx-tabs[role="tablist"]:not([data-axf-tab-group^="axf-skin"])')].filter((e) => e.offsetParent !== null).map((e) => ({ id: e.getAttribute('data-axf-tab-group'), position: e.getAttribute('data-fx-tabs-position'), style: e.getAttribute('data-fx-tabs') }));
          return {
            attrs,
            tablePad: cs.getPropertyValue('--fx-table-py').trim(),
            navMode: nav?.getAttribute('data-fx-nav-mode') ?? (document.querySelector('.fx-nav-drawer__toggle') ? 'drawer' : null),
            toolbarPos: document.querySelector('.fx-region--toolbar')?.getAttribute('data-pos') ?? null,
            banner: document.querySelector('.fx-frame')?.getAttribute('data-fx-banner-placement') ?? null,
            compactMenu: !!document.querySelector('.fx-menubar--compact'),
            tabs,
          };
        });
        const problems = [];
        for (const [type, axes] of Object.entries(s.data.behaviour)) {
          for (const [axis, v] of Object.entries(axes)) {
            const want = typeof v === 'boolean' ? (v ? '1' : '0') : String(v);
            const got = seen.attrs[`data-fx-bhv-${type}-${kebab(axis)}`];
            if (got !== want) problems.push(`${type}.${axis}: root says ${got ?? 'nothing'}, the skin says ${want}`);
          }
        }
        const b = s.data.behaviour;
        if (b['nav-menu']?.mode && seen.navMode !== b['nav-menu'].mode) problems.push(`nav mode on screen ${seen.navMode}, skin ${b['nav-menu'].mode}`);
        if (b.toolbar?.placement && seen.toolbarPos && seen.toolbarPos !== b.toolbar.placement) problems.push(`toolbar at ${seen.toolbarPos}, skin ${b.toolbar.placement}`);
        if (b.banner?.placement && seen.banner !== b.banner.placement) problems.push(`banner at ${seen.banner}, skin ${b.banner.placement}`);
        if (b['app-menu']?.form && seen.compactMenu !== (b['app-menu'].form !== 'menubar')) problems.push(`menu form ${seen.compactMenu ? 'compact' : 'menu bar'}, skin ${b['app-menu'].form}`);
        for (const t of seen.tabs) {
          if (b['tab-group']?.position && t.position !== b['tab-group'].position) problems.push(`tab row ${t.id}: position ${t.position}, skin ${b['tab-group'].position}`);
          if (b['tab-group']?.style && t.style !== b['tab-group'].style) problems.push(`tab row ${t.id}: style ${t.style}, skin ${b['tab-group'].style}`);
        }
        skinTablePad.add(seen.tablePad);
        skinSnaps.push(await snapshot());
        log(`skin ${s.id}: ${Object.keys(seen.attrs).length} behaviour attributes, nav ${seen.navMode}, toolbar ${seen.toolbarPos}, ${seen.tabs.length} tab rows${problems.length ? `, ${problems.length} hard-coded` : ''}`);
        for (const p of problems.slice(0, 20)) log(`  ✗ ${p}`);
        if (problems.length) failed = true;
      }
      if (skinTablePad.size < 2 && skins.length > 1) { log('✗ the table padding did not follow the skins\' table density'); failed = true; }
      if (skinSnaps.length > 1) {
        const names = Object.keys(skinSnaps[0]).filter((k) => skinSnaps.every((x) => x[k]));
        const stuckSkins = names.filter((k) => ['color', 'background'].every((p) => skinSnaps.every((x) => x[k][p] === skinSnaps[0][k][p])));
        log(`skins: ${names.length} elements, ${stuckSkins.length} whose colours never changed between skins`);
        if (stuckSkins.length) { for (const k of stuckSkins.slice(0, 20)) log(`  ✗ ${k}`); failed = true; }
      }
      await page.getByRole('button', { name: 'Cancel' }).first().click().catch(() => {});
      await page.waitForTimeout(300);
    }
  }
  if (errors.length) { log(`✗ page errors:\n  ${errors.join('\n  ')}`); failed = true; }
  await browser.close();
} catch (err) {
  log(`✗ the check could not run: ${err instanceof Error ? err.message : String(err)}`);
  // What the page looked like when it got stuck, so a CI failure says why without downloading anything.
  if (errors.length) log(`✗ page errors:\n  ${errors.join('\n  ')}`);
  if (consoleErrors.length) log(`✗ console errors:\n  ${consoleErrors.slice(0, 15).join('\n  ')}`);
  const shown = await page?.evaluate(() => document.body?.innerText.replace(/\s+/g, ' ').slice(0, 600)).catch(() => '');
  if (shown !== undefined) log(`✗ page text: ${shown || '(empty)'}`);
  failed = true;
} finally {
  server.kill();
}
console.log(failed ? "✗ theme swap check failed" : "✓ every colour, transparency, size and behaviour follows the active themes, scale assets and skins");
if (failed) annotate(lines.filter((l) => l.includes('✗')).slice(0, 30).join('\n') || 'failed');
process.exit(failed ? 1 : 0);
