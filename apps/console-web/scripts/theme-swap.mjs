#!/usr/bin/env node
/**
 * Live theme-swap check for the built console (`npm run build` first).
 *
 *   node scripts/theme-swap.mjs            # serves dist/ with `vite preview` on :7098 and drives Chromium
 *
 * Opens Settings (the settings library plus every installed plugin's settings panels), switches through every
 * colour theme and records each visible element's text, background and border colour. Any colour that stays the
 * same in every theme is hard-coded and fails the check. It then switches style themes and checks that the
 * transparency tokens (--fx-opacity-*) follow. Needs the `playwright` package and a Chromium.
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';

const PORT = 7098;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
let failed = false;
try {
  for (let i = 0; i < 60; i += 1) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/`)).ok) break; } catch { /* not up yet */ }
    await sleep(500);
  }
  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  const page = await browser.newPage({ viewport: { width: 412, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Settings' }).first().click();
  await page.waitForTimeout(500);

  const selects = page.locator('select');
  const valuesOf = (i) => selects.nth(i).locator('option').evaluateAll((o) => o.map((x) => x.value));
  const snapshot = () => page.evaluate(() => {
    const out = {};
    [...document.querySelectorAll('body *')].forEach((e, i) => {
      const cs = getComputedStyle(e);
      if (e.offsetParent === null && cs.position !== 'fixed') return;
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
    await selects.first().selectOption(t);
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
  console.log(`colour themes ${colourThemes.join(', ')}: ${names.length} elements, ${stuck.length} colours that never changed`);
  for (const s of stuck.slice(0, 40)) console.log(`  ✗ ${s}`);
  if (stuck.length) failed = true;

  let styleSelect = -1;
  for (let i = 0; i < (await selects.count()); i += 1) if ((await valuesOf(i)).includes('glass-orbit')) styleSelect = i;
  if (styleSelect < 0) {
    console.log('✗ no style-theme picker found');
    failed = true;
  } else {
    const seen = new Set();
    for (const st of await valuesOf(styleSelect)) {
      await selects.nth(styleSelect).selectOption(st);
      await page.waitForTimeout(300);
      const vals = await page.evaluate(() => ['disabled', 'muted', 'hover', 'tint', 'scrim', 'glass'].map((k) => getComputedStyle(document.documentElement).getPropertyValue(`--fx-opacity-${k}`).trim()));
      console.log(`style theme ${st}: opacity ${vals.join(' / ')}`);
      if (vals.some((v) => v === '')) { console.log('  ✗ a transparency token is missing'); failed = true; }
      seen.add(vals.join('/'));
    }
    if (seen.size < 2) { console.log('✗ transparency tokens did not change between style themes'); failed = true; }
  }
  if (errors.length) { console.log(`✗ page errors:\n  ${errors.join('\n  ')}`); failed = true; }
  await browser.close();
} finally {
  server.kill();
}
console.log(failed ? '✗ theme swap check failed' : '✓ every colour and transparency follows the active themes');
process.exit(failed ? 1 : 0);
