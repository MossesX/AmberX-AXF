#!/usr/bin/env node
/**
 * check-screen-focus — every screen can jump to any of its items (focus-on-every-screen, Nov 12 2026, Brett:
 * "Everything, everything needs to plan studio, UI review, everything."). `console_show` / `console_open` with a focus
 * run `<view>.focus:<key>`; the shell gives every view a generic one (framework/react/screenFocus.ts) that finds an
 * item by its marker. So a screen that lists items must either mark them or answer focus itself:
 *
 *   1. the framework still wires it: AppShell registers the generic focus, Settings registers `settings.focus`;
 *   2. every plugin / library with a view whose code draws a list (`.map(` + `key=`) carries `data-fx-focus-key` on its
 *      rows (or a context-menu payload, which the generic focus also reads) or registers its own `<view>.focus`;
 *   3. a screen that truly has no items to jump to says so in its plugin.json: `"screenFocus": "none: <why>"`.
 *
 *   node framework/cli/check-screen-focus.mjs [--json]
 * Exit 1 on any finding.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const json = process.argv.includes('--json');

function walk(dir, out = []) {
  let names = [];
  try { names = readdirSync(dir); } catch { return out; }
  for (const n of names) {
    if (n === 'node_modules' || n === 'vendor' || n === 'dist' || n.startsWith('.')) continue;
    const p = join(dir, n);
    let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, out);
    else if (/\.(tsx|ts)$/.test(n) && !/\.(test|spec)\./.test(n) && !n.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

const read = (p) => { try { return readFileSync(p, 'utf8'); } catch { return ''; } };
/** Draws a list of items: a `.map(` whose callback renders an element with a React key. */
export const drawsList = (src) => /\.map\(\s*\(?[\w{}\s,[\]]*\)?\s*=>\s*\(?\s*<[\w.]+[^>]*\bkey=/m.test(src);
/** Marks its items for the generic focus (or a context-menu payload / settings anchor, which it also reads). */
export const marksItems = (src) => /data-fx-focus-key=|data-fx-ctx-payload=|data-axf-anchor=|focusKey=/.test(src);
/** Answers focus itself. */
export const ownFocus = (src) => /actions\.register\(\s*[`'"][\w.-]+\.focus[`'"]|actions\.register\(\s*`\$\{[\w.]+\}\.focus`/.test(src);
export const hasViews = (src) => /^\s*views\s*:\s*\{/m.test(src);

/** One unit (a plugin folder's web code, or a framework library) → a finding or null. */
export function checkUnit({ name, files, optOut }) {
  const srcs = files.map(read);
  const index = srcs.find((s, i) => /index\.tsx$/.test(files[i]) && hasViews(s)) ?? srcs.find(hasViews);
  if (!index) return null;
  if (optOut) return /^none:\s*\S/.test(optOut) ? null : { unit: name, problem: `"screenFocus" must read "none: <why>" (has ${JSON.stringify(optOut)})` };
  const lists = srcs.some(drawsList);
  if (!lists) return null;
  if (srcs.some(marksItems) || srcs.some(ownFocus)) return null;
  return { unit: name, problem: 'lists items but marks none with data-fx-focus-key and registers no <view>.focus: console_show can open it but not jump to an item' };
}

export function run() {
  const findings = [];
  // 1. the framework wiring
  const shell = read(join(ROOT, 'framework/react/AppShell.tsx'));
  if (!/useScreenFocusActions\(/.test(shell)) findings.push({ unit: 'framework/react/AppShell.tsx', problem: 'no longer registers the generic <view>.focus (useScreenFocusActions)' });
  const settings = read(join(ROOT, 'framework/libs/settings/index.tsx'));
  if (!/actions\.register\('settings\.focus'/.test(settings)) findings.push({ unit: 'framework/libs/settings', problem: 'no settings.focus action' });
  const commands = read(join(ROOT, 'apps/console-web/plugins/console-commands/web/index.tsx'));
  if (commands && !/closeDialog\(\)[^\n]*\n\s*rt\.search\.focus\(\{ id: `view:/.test(commands)) findings.push({ unit: 'console-commands', problem: 'opening a screen no longer closes a covering dialog first' });
  // 2. framework libraries with views
  const libs = join(ROOT, 'framework/libs');
  for (const lib of (() => { try { return readdirSync(libs); } catch { return []; } })()) {
    const files = walk(join(libs, lib));
    const f = checkUnit({ name: `framework/libs/${lib}`, files });
    if (f) findings.push(f);
  }
  // 3. app plugins with views
  const apps = (() => { try { return readdirSync(join(ROOT, 'apps')); } catch { return []; } })();
  let units = 0;
  for (const app of apps) {
    const plugins = join(ROOT, 'apps', app, 'plugins');
    if (!existsSync(plugins)) continue;
    for (const folder of readdirSync(plugins)) {
      if (folder.startsWith('_') || folder.startsWith('.')) continue; // templates
      const web = join(plugins, folder, 'web');
      if (!existsSync(web)) continue;
      let optOut;
      try { optOut = JSON.parse(read(join(plugins, folder, 'plugin.json')) || '{}').screenFocus; } catch { /* a broken manifest is plugin-lifecycle's finding */ }
      units++;
      const f = checkUnit({ name: relative(ROOT, join(plugins, folder)), files: walk(web), optOut });
      if (f) findings.push(f);
    }
  }
  return { units, findings };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { units, findings } = run();
  if (json) process.stdout.write(`${JSON.stringify({ ok: !findings.length, units, findings }, null, 2)}\n`);
  else if (!findings.length) console.log(`check-screen-focus: ok (${units} plugin web folders; every screen with items can be focused)`);
  else {
    console.error(`check-screen-focus: ${findings.length} screen(s) can't jump to an item:`);
    for (const f of findings) console.error(`  ${f.unit}: ${f.problem}`);
    console.error('Fix: put data-fx-focus-key={<item id>} on each row / card / group (framework/core/screen-focus.ts), or register `<view>.focus`; a screen with nothing to jump to sets "screenFocus": "none: <why>" in plugin.json.');
  }
  process.exit(findings.length ? 1 : 0);
}
