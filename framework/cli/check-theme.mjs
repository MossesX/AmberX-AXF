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
 *  - hard-coded design sizes: font-size / padding / margin / gap / border-radius as literal numbers or px
 *    (use --fx-space, --fx-radius-*, --fx-font-size; layout limits like min-width/max-width are fine)
 *  - defining --fx-* variables (reserved for the engines; see framework/spec/THEMING.md naming principles)
 * Put `theme-ok` in a comment on a line to allow a deliberate exception (e.g. a colour input's default value).
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
for (const f of walk(join(FRAMEWORK, 'core')).filter((f) => /\.(ts|mjs)$/.test(f))) {
  for (const m of readFileSync(f, 'utf8').matchAll(/['"`](--fx-[a-z0-9-]+)['"`]/g)) known.add(m[1]);
}
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

const args = process.argv.slice(2);
const targets = args.length
  ? args.map((a) => resolve(a))
  : [join(FRAMEWORK, 'libs'), ...readdirSync(join(ROOT, 'apps')).map((a) => join(ROOT, 'apps', a, 'plugins')).filter(existsSync)];

const RULES = [
  { id: 'colour', re: /(?<![\w&])#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b(?![\w-])/g, msg: 'literal colour; use a theme token (var(--fx-…))' },
  { id: 'colour', re: /\b(?:rgba?|hsla?)\s*\(/g, msg: 'literal colour function; use a theme token' },
  { id: 'colour', re: /\b(?:color|background|backgroundColor|borderColor|fill|stroke)\s*:\s*['"](?:white|black|red|green|blue|gray|grey|orange|yellow|purple)['"]/g, msg: 'named colour; use a theme token' },
  { id: 'reserved', re: /(?:^|[;{\s'"])--fx-[a-z0-9-]+['"]?\s*:/g, msg: '--fx-* is reserved for the engines; prefix private variables with your own prefix (framework/spec/THEMING.md)' },
  { id: 'fallback', re: /var\(\s*--fx-[a-z0-9-]+\s*,/g, msg: 'var() fallback hides a wrong token name; drop the fallback' },
  { id: 'size', re: /\b(?:fontSize|padding(?:Top|Bottom|Left|Right|Inline|Block)?|margin(?:Top|Bottom|Left|Right|Inline|Block)?|gap|rowGap|columnGap|borderRadius)\s*:\s*(?:[1-9]\d*(?:\.\d+)?|['"][1-9][\d.]*px['"])/g, msg: 'hard-coded size; use --fx-space / --fx-radius-* / --fx-font-size' },
  { id: 'size', re: /(?:^|[;{\s])(?:font-size|padding(?:-[a-z]+)?|margin(?:-[a-z]+)?|gap|border-radius)\s*:\s*[^;}]*?\b[1-9]\d*(?:\.\d+)?px/g, msg: 'hard-coded px size in CSS; use theme tokens' },
];

let problems = 0;
let files = 0;
for (const t of targets) {
  for (const f of walk(t).filter((f) => /\.(tsx?|css|m?js)$/.test(f))) {
    files += 1;
    const lines = readFileSync(f, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (/theme-ok/.test(line)) return;
      const report = (msg) => {
        problems += 1;
        console.log(`${relative(ROOT, f)}:${i + 1}  ${msg}\n    ${line.trim().slice(0, 160)}`);
      };
      for (const r of RULES) {
        r.re.lastIndex = 0;
        if (r.re.test(line)) report(r.msg);
      }
      for (const m of line.matchAll(/var\(\s*(--fx-[a-z0-9-]+)/g)) {
        if (!isKnown(m[1])) report(`unknown token ${m[1]} (not defined by any theme engine or axf.css)`);
      }
    });
  }
}

if (problems) {
  console.log(`\n✗ ${problems} theme problem(s) in ${files} file(s). Libraries and plugins must style only through theme tokens.`);
  process.exit(1);
}
console.log(`✓ theme-conformant — ${files} file(s) checked, ${known.size} tokens known`);
