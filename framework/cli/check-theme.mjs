#!/usr/bin/env node
/**
 * Theme conformance check: every library and plugin UI must be styled only through the theme engines.
 *
 *   node framework/cli/check-theme.mjs [paths…]     (default: framework/libs, apps/*\/plugins)
 *
 * Fails on, in .ts/.tsx/.css/.js files:
 *  - literal colours: #rgb / #rrggbb / #rrggbbaa, rgb()/rgba()/hsl()/hsla(), named colours in style props
 *  - var(--fx-…, fallback): the theme always defines its tokens, a fallback hides a wrong name
 *  - --fx-* variables no engine or axf.css defines
 *  - hard-coded design sizes (999px pill radii are shapes and allowed): font-size / padding / margin / gap / border-radius as literal numbers or px
 *    (use --fx-space, --fx-radius-*, --fx-font-size; layout limits like min-width/max-width are fine)
 *  - defining --fx-* variables (reserved for the engines; see framework/spec/THEMING.md naming principles)
 *  - fixed transparency: color-mix(… NN%, transparent) and opacity literals (use --fx-opacity-*)
 *  - scale (Angel build ui-all-assets, Oct 31 2026): a font size, gap, padding or margin written as a number of em or as
 *    calc(var(--fx-space|--fx-font-size) * n) instead of a scale token (--fx-type-scale-*, --fx-dens-gap-*, --fx-size-*);
 *    `node framework/cli/scale-adopt.mjs <path>` moves them. Everywhere, framework CSS included. Layout-sized values
 *    (> 3.5 space, > 2.3× text: icons, empty states) and 1em are left alone, as scale-adopt leaves them.
 *  Profiles: libraries, plugins and the console's own UI get every rule; framework React/CSS and apps' own UI get the colour and
 *  transparency rules (a colour-theme or style-theme swap must restyle them too).
 * Put `theme-ok` in a comment on a line to allow a deliberate exception (e.g. a colour input's default value).
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCALE_TYPES, scaleVars } from '../core/engines/scale-rules.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const FRAMEWORK = join(ROOT, 'framework');

/* ---------- the set of tokens the engines and base stylesheet define ---------- */

const kebab = (s) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const known = new Set();
const css = readFileSync(join(FRAMEWORK, 'ui/axf.css'), 'utf8');
for (const m of css.matchAll(/(--fx-[a-z0-9-]+)\s*:/g)) known.add(m[1]);
function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  if (!statSync(dir).isDirectory()) return [dir];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === 'vendor' || name.startsWith('.')) continue; // vendor/: third-party code, themed by our own CSS on top
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
for (const f of walk(join(FRAMEWORK, 'core')).filter((f) => /\.(ts|mjs)$/.test(f))) {
  for (const m of readFileSync(f, 'utf8').matchAll(/['"`](--fx-[a-z0-9-]+)['"`]/g)) known.add(m[1]);
}
// Scale tokens (typography@1, density@1, sizing@1) are built from one registry, not written out as literals.
for (const t of SCALE_TYPES) for (const k of Object.keys(scaleVars(t, null))) known.add(k);
// Colour tokens come from the color-theme assets' token keys (engines/theme.ts: --fx-${kebab(key)}).
for (const f of walk(join(FRAMEWORK, 'assets/color-theme')).filter((f) => f.endsWith('.json'))) {
  const tokens = JSON.parse(readFileSync(f, 'utf8'))?.data?.tokens ?? {};
  for (const k of Object.keys(tokens)) known.add(`--fx-${kebab(k)}`);
}
// Component engine variables are built from prefixes; accept every name with a known component prefix.
const COMPONENT_PREFIXES = [];
for (const f of walk(join(FRAMEWORK, 'core/engines')).filter((f) => f.endsWith('.ts'))) {
  for (const m of readFileSync(f, 'utf8').matchAll(/`(--fx-[a-z0-9-]+-)\$\{/g)) COMPONENT_PREFIXES.push(m[1]);
}
const isKnown = (name) => known.has(name) || COMPONENT_PREFIXES.some((p) => name.startsWith(p));

/* ---------- scan ---------- */

// Colour + transparency tokens: what a colour-theme or the transparency part of a style-theme controls.
const COLOUR_TOKENS = new Set([...known].filter((n) => /^--fx-(opacity-|scrim$)/.test(n)));
for (const f of walk(join(FRAMEWORK, 'assets/color-theme')).filter((f) => f.endsWith('.json'))) {
  for (const k of Object.keys(JSON.parse(readFileSync(f, 'utf8'))?.data?.tokens ?? {})) COLOUR_TOKENS.add(`--fx-${kebab(k)}`);
}

const args = process.argv.slice(2);
const colourFlag = args.includes('--colour');
const paths = args.filter((a) => !a.startsWith('--'));
const apps = readdirSync(join(ROOT, 'apps'));
/**
 * Two profiles:
 *  - strict (libraries + plugins): every rule.
 *  - colour (framework React/CSS and every app's own UI): colours and transparency must follow the active
 *    themes, so a colour-theme or style-theme swap restyles everything. Size rules are not enforced there yet.
 */
const scans = paths.length
  ? paths.map((p) => ({ path: resolve(p), profile: colourFlag ? 'colour' : 'strict' }))
  : [
      { path: join(FRAMEWORK, 'libs'), profile: 'strict' },
      ...apps.map((a) => join(ROOT, 'apps', a, 'plugins')).filter(existsSync).map((path) => ({ path, profile: 'strict' })),
      { path: join(FRAMEWORK, 'react'), profile: 'colour' },
      { path: join(FRAMEWORK, 'ui'), profile: 'colour' },
      // apps/demo is untouched `axf init` output with an older baked framework; its source of truth is the templates.
      // The console's own UI is held to every rule too (sizes converted to tokens Oct 17 2026).
      { path: join(ROOT, 'apps', 'console-web', 'src'), profile: 'strict' },
      ...apps.filter((a) => a !== 'demo' && a !== 'console-web').map((a) => join(ROOT, 'apps', a, 'src')).filter(existsSync).map((path) => ({ path, profile: 'colour' })),
      ...readdirSync(join(FRAMEWORK, 'templates')).map((t) => join(FRAMEWORK, 'templates', t, 'src')).filter(existsSync).map((path) => ({ path, profile: 'colour' })),
    ];

const COLOUR = ['colour', 'transparency'];
/** What scale-adopt would still move on this line (same steps): checked in every profile. */
function scaleLeft(line) {
  const t = (r) => r < 0.97 || (r > 1.03 && r <= 2.3);
  const g = (k) => k > 0 && k <= 3.51;
  const n = (a, b) => Number(a) / (b ? Number(b) : 1);
  for (const m of line.matchAll(/(?<![\w-])(font-size|fontSize|font)(\s*:\s*)['"]?([^;}{'"`\n]+)/g)) {
    for (const c of m[3].matchAll(/calc\(\s*var\(--fx-font-size\)\s*\*\s*(\d*\.?\d+)(?:\s*\/\s*(\d*\.?\d+))?\s*\)/g)) if (t(n(c[1], c[2]))) return true;
    if (m[1] !== 'font') for (const c of m[3].matchAll(/(?<![\w.-])(\d*\.?\d+)em\b/g)) if (t(Number(c[1]))) return true;
  }
  for (const m of line.matchAll(/(?<![\w-])((?:row-|column-)?gap|rowGap|columnGap|padding[\w-]*|margin[\w-]*)(\s*:\s*)['"]?([^;}{'"`\n]+)/g)) {
    for (const c of m[3].matchAll(/calc\(\s*var\(--fx-space\)\s*\*\s*(\d*\.?\d+)(?:\s*\/\s*(\d*\.?\d+))?\s*\)/g)) if (g(n(c[1], c[2]))) return true;
    if (/(?<![(*/+-]\s*)var\(--fx-space\)(?!\s*[*/])/.test(m[3])) return true;
  }
  return false;
}
const RULES = [
  { id: 'colour', re: /(?<![\w&])#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b(?![\w-])/g, msg: 'literal colour; use a theme token (var(--fx-…))' },
  { id: 'colour', re: /\b(?:rgba?|hsla?)\s*\(/g, msg: 'literal colour function; use a theme token' },
  { id: 'colour', re: /\b(?:color|background|backgroundColor|borderColor|fill|stroke)\s*:\s*['"](?:white|black|red|green|blue|gray|grey|orange|yellow|purple)['"]/g, msg: 'named colour; use a theme token' },
  { id: 'transparency', re: /color-mix\([^;}]*?\b\d+(?:\.\d+)?%\s*,\s*transparent\)/g, msg: 'fixed transparency; use calc(var(--fx-opacity-…) * 100%) (framework/spec/THEMING.md)' },
  { id: 'opacity', re: /\bopacity\s*:\s*['"]?0?\.\d+/g, msg: 'fixed opacity; use var(--fx-opacity-disabled / -muted / …)' },
  { id: 'reserved', re: /(?:^|[;{\s'"])--fx-[a-z0-9-]+['"]?\s*:/g, msg: '--fx-* is reserved for the engines; prefix private variables with your own prefix (framework/spec/THEMING.md)' },
  { id: 'fallback', re: /var\(\s*--fx-[a-z0-9-]+\s*,/g, msg: 'var() fallback hides a wrong token name; drop the fallback' },
  { id: 'size', re: /\b(?:fontSize|padding(?:Top|Bottom|Left|Right|Inline|Block)?|margin(?:Top|Bottom|Left|Right|Inline|Block)?|gap|rowGap|columnGap|borderRadius)\s*:\s*(?!999\b|'999px')(?:[1-9]\d*(?:\.\d+)?|['"][1-9][\d.]*px['"])/g, msg: 'hard-coded size; use --fx-space / --fx-radius-* / --fx-font-size' },
  { id: 'scale', test: scaleLeft, msg: 'size not on the scale; use --fx-type-scale-* / --fx-dens-gap-* / --fx-size-* (node framework/cli/scale-adopt.mjs moves it)' },
  { id: 'size', re: /(?:^|[;{\s])(?:font-size|padding(?:-[a-z]+)?|margin(?:-[a-z]+)?|gap|border-radius)\s*:\s*[^;}]*?\b(?!999px)[1-9]\d*(?:\.\d+)?px/g, msg: 'hard-coded px size in CSS; use theme tokens' },
];

let problems = 0;
let files = 0;
for (const { path, profile } of scans) {
  const pausedPatches = path.includes(`${'/'}apps${'/'}patches`);
  const inFramework = path.startsWith(join(FRAMEWORK, 'react')) || path.startsWith(join(FRAMEWORK, 'ui'));
  for (const f of walk(path).filter((f) => /\.(tsx?|css|m?js)$/.test(f) && !f.includes(`${'/'}src${'/'}axf${'/'}`))) {
    files += 1;
    const lines = readFileSync(f, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (/theme-ok/.test(line)) return;
      const scaleOk = /scale-ok/.test(line);
      const report = (msg) => {
        problems += 1;
        console.log(`${relative(ROOT, f)}:${i + 1}  ${msg}\n    ${line.trim().slice(0, 160)}`);
      };
      for (const r of RULES) {
        if (profile === 'colour' && !COLOUR.includes(r.id) && r.id !== 'fallback' && r.id !== 'scale' && !(r.id === 'reserved' && !inFramework)) continue;
        if (r.id === 'scale' && pausedPatches) continue; // all Patches work is paused (Brett, Oct 28 2026): its copy stays as it is
        if (r.test) { if (!scaleOk && r.test(line)) report(r.msg); continue; }
        r.re.lastIndex = 0;
        if (r.id === 'fallback' && profile === 'colour') {
          for (const m of line.matchAll(/var\(\s*(--fx-[a-z0-9-]+)\s*,/g)) if (COLOUR_TOKENS.has(m[1])) report(`fallback on colour token ${m[1]}; drop it`);
          continue;
        }
        if (r.re.test(line)) report(r.msg);
      }
      for (const m of line.matchAll(/var\(\s*(--fx-[a-z0-9-]*[a-z0-9])(?![a-z0-9-]|\$)/g)) {
        if (!isKnown(m[1])) report(`unknown token ${m[1]} (not defined by any theme engine or axf.css)`);
      }
    });
  }
}

if (problems) {
  console.log(`\n✗ ${problems} theme problem(s) in ${files} file(s). UI must follow the theme engines (framework/spec/THEMING.md).`);
  process.exit(1);
}
console.log(`✓ theme-conformant — ${files} file(s) checked, ${known.size} tokens known`);
