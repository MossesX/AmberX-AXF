#!/usr/bin/env node
/**
 * Safe area (console app part 4, Brett Nov 13 2026: "AmberX's banner was behind the camera, the clock and the
 * notification panel"): nothing the console draws may sit under the status bar, camera cutout, notification shade or
 * gesture bar.
 *
 *   node framework/cli/check-safe-area.mjs          check, exit 1 on a finding
 *   node framework/cli/check-safe-area.mjs --json   the findings as JSON
 *
 * Checks:
 * 1. every web app's index.html asks for the whole screen (viewport-fit=cover), so env(safe-area-inset-*) is real;
 * 2. framework/ui/axf.css declares --fx-safe-top/right/bottom/left from env(), and reads the platform insets nowhere
 *    else (everything goes through the tokens, which the Android console app overrides with the real sizes);
 * 3. the top bars (the frame: banners, menu bar, toolbars), the phone's bottom nav, bottom sheets and every layer fixed
 *    to a screen edge (REQUIRED) carry their inset;
 * 4. any rule in the console's own CSS (src, plugins) that pins a fixed element to the top or bottom edge reads the
 *    matching --fx-safe-* token;
 * 5. the console's copy of axf.css has the same safe-area rules as the framework's.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FRAMEWORK_CSS = 'framework/ui/axf.css';
const CONSOLE_CSS = 'apps/console-web/src/axf/ui/axf.css';
export const SIDES = ['top', 'right', 'bottom', 'left'];

/** Selector (as written in axf.css) → the insets a rule for it must read somewhere in the file. */
export const REQUIRED = [
  ['.fx-frame', ['top', 'right', 'left']],
  ['html:not([data-fx-narrow]) .fx-frame', ['bottom']],
  [':where([data-fx-narrow]) .fx-nav', ['bottom']],
  ["[data-fx-dialog='sheet'] .fx-dialog", ['bottom']],
  ["[data-fx-dialog='drawer'] .fx-backdrop", ['top', 'bottom']],
  ['.fx-backdrop', ['top', 'right', 'bottom', 'left']],
  ["html:not([data-fx-narrow]) [data-fx-toast-pos^='top'] .fx-toasts", ['top']],
  ["html:not([data-fx-narrow]) [data-fx-toast-pos^='bottom'] .fx-toasts", ['bottom']],
  ['.fx-corner--top-left', ['top', 'left']],
  ['.fx-corner--bottom-right', ['bottom', 'right']],
  ['.fx-help-panel', ['bottom', 'right']],
  ['.fx-help-intro', ['bottom']],
  ['.fx-menu-probe', ['top', 'right', 'bottom', 'left']],
];

/** CSS rules as { selector, body, line } (comments removed; at-rule blocks flattened). */
export function rules(css) {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(src))) {
    const selector = m[1].trim().replace(/^@[^{]*$/, '').replace(/\s+/g, ' ');
    if (!selector || selector.startsWith('@')) continue;
    out.push({ selector, body: m[2], line: src.slice(0, m.index).split('\n').length + (m[1].match(/^\s*/)[0].split('\n').length - 1) });
  }
  return out;
}

const reads = (body, side) => body.includes(`--fx-safe-${side}`);
const selectors = (sel) => sel.split(',').map((s) => s.trim());

/** Findings for one stylesheet's text. */
export function checkFrameworkCss(css, file = FRAMEWORK_CSS) {
  const found = [];
  const rs = rules(css);
  for (const side of SIDES) {
    if (!new RegExp(`--fx-safe-${side}:\\s*env\\(safe-area-inset-${side}\\)`).test(css)) found.push(`${file}: --fx-safe-${side} is not declared from env(safe-area-inset-${side})`);
  }
  css.split('\n').forEach((l, i) => {
    const code = l.replace(/\/\*.*?\*\//g, '');
    const envs = code.match(/env\(safe-area-inset-[a-z]+\)/g) ?? [];
    const declared = code.match(/--fx-safe-[a-z]+:\s*env\(safe-area-inset-[a-z]+\)/g) ?? [];
    if (envs.length > declared.length) found.push(`${file}:${i + 1}: reads env(safe-area-inset-*) directly; use var(--fx-safe-*)`);
  });
  for (const [sel, sides] of REQUIRED) {
    const mine = rs.filter((r) => selectors(r.selector).includes(sel));
    if (!mine.length) { found.push(`${file}: no rule for ${sel}`); continue; }
    for (const side of sides) if (!mine.some((r) => reads(r.body, side))) found.push(`${file}: ${sel} does not pad --fx-safe-${side}`);
  }
  return found;
}

/** A rule that pins a fixed element to the top / bottom edge must read that inset. */
export function checkPinned(css, file) {
  const found = [];
  for (const r of rules(css)) {
    if (!/position:\s*fixed/.test(r.body)) continue;
    if (/inset:\s*0/.test(r.body) && !/pointer-events:\s*none/.test(r.body) && !SIDES.some((s) => reads(r.body, s))) {
      // a full-screen layer with something on it keeps that out of the insets; a bare click-catcher draws nothing
      if (/background/.test(r.body) && !/padding/.test(r.body)) found.push(`${file}:${r.line}: ${r.selector} covers the screen without padding the safe area`);
      continue;
    }
    for (const side of ['top', 'bottom']) {
      if (new RegExp(`(^|[;\\s])${side}:\\s*[^;]*`).test(r.body) && !new RegExp(`${side}:\\s*auto`).test(r.body) && !reads(r.body, side)
        && /var\(--fx-dens|\d/.test((r.body.match(new RegExp(`(?:^|[;\\s])${side}:\\s*([^;]*)`)) ?? [])[1] ?? '')
        && !/left:\s*50%.*top:\s*50%|translate\(-50%,\s*-50%\)/.test(r.body)) {
        found.push(`${file}:${r.line}: ${r.selector} is fixed to the ${side} edge without var(--fx-safe-${side})`);
      }
    }
  }
  return found;
}

function cssFiles(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const n of readdirSync(dir)) {
    if (n === 'node_modules' || n === 'dist' || n.startsWith('.')) continue;
    const p = join(dir, n);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...cssFiles(p));
    else if (n.endsWith('.css')) out.push(p);
  }
  return out;
}

/** Edge-pinned rules in the console's own CSS (src minus the vendored framework copy, plugins). */
export const CONSOLE_DIRS = ['apps/console-web/src', 'apps/console-web/plugins'];

export function check(root = ROOT) {
  const found = [];
  for (const app of readdirSync(join(root, 'apps'))) {
    const html = join(root, 'apps', app, 'index.html');
    if (existsSync(html) && !/viewport-fit=cover/.test(readFileSync(html, 'utf8'))) found.push(`apps/${app}/index.html: the viewport meta lacks viewport-fit=cover`);
  }
  const fw = readFileSync(join(root, FRAMEWORK_CSS), 'utf8');
  found.push(...checkFrameworkCss(fw, FRAMEWORK_CSS));
  if (existsSync(join(root, CONSOLE_CSS))) found.push(...checkFrameworkCss(readFileSync(join(root, CONSOLE_CSS), 'utf8'), CONSOLE_CSS));
  for (const d of CONSOLE_DIRS) {
    for (const f of cssFiles(join(root, d))) {
      const rel = relative(root, f);
      if (rel === CONSOLE_CSS) continue;
      found.push(...checkPinned(readFileSync(f, 'utf8'), rel));
    }
  }
  return found;
}

function main(argv) {
  const found = check();
  if (argv.includes('--json')) { console.log(JSON.stringify({ ok: !found.length, findings: found }, null, 2)); return found.length ? 1 : 0; }
  if (!found.length) { console.log('✓ safe area — top bars, bottom nav and every edge-fixed layer pad --fx-safe-*; viewport-fit=cover everywhere'); return 0; }
  for (const f of found) console.log(`✗ ${f}`);
  console.log(`${found.length} safe-area finding(s): pad with var(--fx-safe-top|right|bottom|left) (framework/ui/axf.css).`);
  return 1;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main(process.argv.slice(2)));
