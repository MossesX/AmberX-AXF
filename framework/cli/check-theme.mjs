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
 *  - fonts: a literal font-family stack instead of --fx-font / --fx-font-mono / --fx-font-display
 *  - rem sizes and em spacing (font-size / padding / margin / gap / border-radius)
 *
 * Asset conformance (Brett, Oct 31 2026, build asset-conform; shared rule "Handwritten code conforms to the asset
 * system"): EVERY web CSS/TSX file gets every rule, handwritten or generated: libraries, plugins, framework React + CSS,
 * every app's own UI, the app templates, boilerplates and library templates. Each finding names file:line and the
 * asset token to use instead (`node framework/cli/scale-adopt.mjs <path>` writes most of them in).
 * Kotlin UI (Compose files) is checked the same way: Color literals, .sp text sizes and .dp spacing / radii must come
 * from Axf.colors / Axf.type / Axf.space / Axf.shapes.
 *
 * Allowlisted: the framework's token/asset definition files (framework/core engines, framework/ui/axf.css's own
 * --fx-* defaults and optional component-token fallbacks, axf-ui's theme/ package that turns tokens into Compose
 * values). Frozen code (all Android work is on hold; all Patches work is paused) is held to a ratchet baseline,
 * framework/spec/conform-baseline.json: it may only shrink (`--update-baseline` rewrites it after a fix).
 * Put `theme-ok` in a comment on a line to allow a deliberate exception (e.g. a colour input's default value).
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCALE_TYPES, scaleVars } from '../core/engines/scale-rules.mjs';
import { adoptLine } from './scale-adopt.mjs';
import { writeFileSync } from 'node:fs';

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
const updateBaseline = args.includes('--update-baseline');
const paths = args.filter((a) => !a.startsWith('--'));
const apps = readdirSync(join(ROOT, 'apps'));
/**
 * Profiles:
 *  - strict: every rule. Every web UI path since asset-conform (Oct 31 2026).
 *  - colour: colours and transparency only (kept for `--colour` runs on a single path).
 *  - definition: a token/asset definition file (framework/ui/axf.css): it defines --fx-* defaults and reads optional
 *    component tokens with fallbacks, so the reserved / fallback / unknown-token rules don't apply; the rest do.
 */
const DEFINITION_FILES = new Set(['framework/ui/axf.css']);
/** Frozen code: findings are counted against framework/spec/conform-baseline.json instead of failing outright. */
const FROZEN = [
  { re: /^apps\/patches(-web)?\//, why: 'all Patches work is paused (Brett, Oct 28 2026)' },
  { re: /\.kt$/, why: 'all Android work is on hold (Brett, Oct 21 2026); generated Kotlin (templates) has no baseline' },
];
const GENERATED_KT = /^framework\/(templates|library-templates|boilerplates)\//;
const scans = paths.length
  ? paths.map((p) => ({ path: resolve(p), profile: colourFlag ? 'colour' : 'strict' }))
  : [
      { path: join(FRAMEWORK, 'libs'), profile: 'strict' },
      ...apps.map((a) => join(ROOT, 'apps', a, 'plugins')).filter(existsSync).map((path) => ({ path, profile: 'strict' })),
      { path: join(FRAMEWORK, 'react'), profile: 'strict' },
      { path: join(FRAMEWORK, 'ui'), profile: 'strict' },
      // every app's own UI, apps/demo included (it is `axf init` output: its baked framework copy, src/axf, is skipped)
      ...apps.map((a) => join(ROOT, 'apps', a, 'src')).filter(existsSync).map((path) => ({ path, profile: 'strict' })),
      // what the build system generates from: app templates, boilerplates, library templates, the plugin template
      ...readdirSync(join(FRAMEWORK, 'templates')).map((t) => join(FRAMEWORK, 'templates', t)).filter((p) => statSync(p).isDirectory()).map((path) => ({ path, profile: 'strict' })),
      { path: join(FRAMEWORK, 'boilerplates'), profile: 'strict' },
      { path: join(FRAMEWORK, 'library-templates'), profile: 'strict' },
    ];
/** Kotlin UI roots (Compose): framework modules, apps, templates. */
const KT_ROOTS = paths.length ? paths.map((p) => resolve(p)) : [join(FRAMEWORK, 'android'), ...apps.map((a) => join(ROOT, 'apps', a)), join(FRAMEWORK, 'templates'), join(FRAMEWORK, 'library-templates'), join(FRAMEWORK, 'boilerplates')];
/** Where the Kotlin framework controls are built (from Material primitives): the raw-control rule doesn't apply there. */
const KT_CONTROLS_DEFINED = /framework\/android\/axf-ui\/src\/main\/kotlin\/ai\/amberx\/axf\/ui\/(components|kit|windows)\//;
const KT_DEFINITION = /framework\/android\/(axf-kernel\/|axf-ui\/src\/main\/kotlin\/ai\/amberx\/axf\/ui\/theme\/|build-logic\/)/;

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
  { id: 'size', re: /(?:^|[;{\s'"])(?:font-size|fontSize|padding[\w-]*|margin[\w-]*|gap|rowGap|columnGap|border-radius|borderRadius)\s*:\s*[^;}]*?(?<![\w.-])\d*\.?\d+rem\b/g, msg: 'hard-coded rem size; use the scale tokens' },
  { id: 'size', re: /(?:^|[;{\s'"])(?:padding[\w-]*|margin[\w-]*|gap|rowGap|columnGap|border-radius|borderRadius)\s*:\s*['"]?[^;}'"]*?(?<![\w.-])(?:0?\.\d+|[1-9][\d.]*)em\b/g, msg: 'spacing in em; use --fx-dens-gap-* / --fx-radius-*' },
  { id: 'size', re: /(?:^|[;{\s'"])(?:border(?:-(?:top|bottom|left|right|inline|block)(?:-(?:start|end))?)?(?:-width)?|border(?:Top|Bottom|Left|Right)?(?:Width)?)\s*:\s*['"`]?[^;}'"`]*?(?<![\w.-])\d*\.?\d+px\b/g, msg: 'hard-coded border width; use var(--fx-border-w) (× n)' },
  { id: 'font', re: /(?:^|[;{\s])(?:font-family\s*:\s*(?!\s*(?:var\(--fx-font|inherit|initial|unset|\$\{))[^;}$]|fontFamily\s*:\s*['"](?!var\(--fx-font|inherit)[^'"]*(?:,|monospace|serif|system-ui|ui-))/g, msg: 'literal font; use var(--fx-font) / var(--fx-font-mono) / var(--fx-font-display) (the style theme\'s fonts)' },
];

/** The asset token a finding should use, from scale-adopt's mapping (or null when it can't tell). */
function hint(line) {
  const after = adoptLine(line);
  if (after === line) return null;
  const used = [...new Set([...after.matchAll(/calc\(var\(--fx-border-w\)\s*\*\s*[\d.]+\)|var\(--fx-(?:type-(?:scale|root)|dens-gap|radius|border-w|font)[a-z0-9-]*\)/g)].map((m) => m[0]).filter((t) => !line.includes(t)))];
  return used.length ? used.join(', ') : null;
}

let problems = 0;
let files = 0;
const frozenCounts = {};
// only this repo's own frozen code; anything outside it (a freshly generated app) is checked in full
// a run on named paths lists everything (that is how frozen findings are read)
const frozenOf = (rel) => !paths.length && !rel.startsWith('..') && FROZEN.find((z) => z.re.test(rel) && !(rel.endsWith('.kt') && GENERATED_KT.test(rel)));
function found(f, i, line, msg) {
  const rel = relative(ROOT, f);
  const z = frozenOf(rel);
  if (z) { frozenCounts[rel] = (frozenCounts[rel] ?? 0) + 1; return; }
  problems += 1;
  const h = msg.startsWith('hard-coded') || msg.startsWith('size not') || msg.startsWith('spacing') || msg.startsWith('literal font') || msg.includes('border width') ? hint(line) : null;
  console.log(`${rel}:${i + 1}  ${msg}${h ? `\n    → use ${h}` : ''}\n    ${line.trim().slice(0, 160)}`);
}
for (const { path, profile: base } of scans) {
  const inFramework = path.startsWith(join(FRAMEWORK, 'react')) || path.startsWith(join(FRAMEWORK, 'ui'));
  for (const f of walk(path).filter((f) => /\.(tsx?|css|m?js)$/.test(f) && !f.includes(`${'/'}src${'/'}axf${'/'}`) && !/\.d\.m?ts$/.test(f))) {
    // templates/boilerplates/library templates: only their web UI (not build scripts, configs or server code)
    if (/^framework\/(templates|boilerplates|library-templates)\//.test(relative(ROOT, f)) && !/\.(tsx|css)$/.test(f)) continue;
    if (/[\\/](vite|next|tailwind|postcss|eslint)\.config\.|[\\/](server|deploy|scripts)[\\/]/.test(f) && relative(ROOT, f).startsWith('..')) continue; // a generated app's build config / server
    files += 1;
    const profile = DEFINITION_FILES.has(relative(ROOT, f)) ? 'definition' : base;
    const lines = readFileSync(f, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (/theme-ok/.test(line)) return;
      const scaleOk = /scale-ok/.test(line);
      const report = (msg) => found(f, i, line, msg);
      for (const r of RULES) {
        if (profile === 'colour' && !COLOUR.includes(r.id) && r.id !== 'fallback' && r.id !== 'scale' && !(r.id === 'reserved' && !inFramework)) continue;
        if (profile === 'definition' && (r.id === 'reserved' || r.id === 'fallback')) continue;
        if (r.test) { if (!scaleOk && r.test(line)) report(r.msg); continue; }
        r.re.lastIndex = 0;
        if (r.id === 'fallback' && profile === 'colour') {
          for (const m of line.matchAll(/var\(\s*(--fx-[a-z0-9-]+)\s*,/g)) if (COLOUR_TOKENS.has(m[1])) report(`fallback on colour token ${m[1]}; drop it`);
          continue;
        }
        if (r.re.test(line)) report(r.msg);
      }
      if (profile === 'definition') return;
      for (const m of line.matchAll(/var\(\s*(--fx-[a-z0-9-]*[a-z0-9])(?![a-z0-9-]|\$)/g)) {
        if (!isKnown(m[1])) report(`unknown token ${m[1]} (not defined by any theme engine or axf.css)`);
      }
    });
  }
}

/* ---------- Kotlin UI (Compose) ---------- */
const KT_RULES = [
  { re: /(?<![\w.])(?:Button|TextButton|OutlinedButton|FilledTonalButton|ElevatedButton|IconButton|Switch|Slider|Checkbox|RadioButton|TextField|OutlinedTextField|FilterChip|AssistChip|Tab)\s*\(/, msg: 'raw Material control; use the framework control (AxfButton, AxfIconButton, AxfSwitch, AxfSlider, AxfTextField, AxfChip, …) so the component-style assets restyle it', controls: true },
  { re: /\bColor\(\s*0x|\bColor\(\s*(?:red|0?\.\d|\d+\s*,)/, msg: 'literal colour; use Axf.colors.* (the colour theme)' },
  { re: /\bColor\.(?:Red|Green|Blue|Black|White|Gray|DarkGray|LightGray|Yellow|Cyan|Magenta)\b/, msg: 'named colour; use Axf.colors.*' },
  { re: /(?<![\w.])\d+(?:\.\d+)?f?\.sp\b/, msg: 'hard-coded text size; use Axf.type.* (typography asset)' },
  { re: /\b(?:padding|spacedBy|PaddingValues|RoundedCornerShape|border|shadow|absolutePadding)\s*\([^)]*?(?<![\w.])(?!0\.dp)\d+(?:\.\d+)?f?\.dp\b/, msg: 'hard-coded spacing / radius; use Axf.space.x(n) / Axf.space.borderWidth / Axf.shapes.*' },
];
/** Kotlin: the spacing unit (style theme `space`, 8dp at the default) → `Axf.space.x(n)` for each dp literal. */
function ktHint(line, r) {
  if (!r.msg.includes('spacing')) return '';
  const xs = [...line.matchAll(/(?<![\w.])(\d+(?:\.\d+)?)f?\.dp\b/g)].filter((m) => Number(m[1]) > 0).map((m) => (Number(m[1]) === 1 ? `${m[0]} → Axf.space.borderWidth` : `${m[0]} → Axf.space.x(${+(Number(m[1]) / 8).toFixed(2)})`));
  return xs.length ? `\n    → use ${[...new Set(xs)].join(', ')}` : '';
}
for (const root of KT_ROOTS) {
  for (const f of walk(root).filter((f) => f.endsWith('.kt') && !f.includes(`${'/'}build${'/'}`))) {
    const rel = relative(ROOT, f);
    if (KT_DEFINITION.test(rel)) continue;
    const src = readFileSync(f, 'utf8');
    if (!/import androidx\.compose/.test(src)) continue; // not UI
    files += 1;
    src.split('\n').forEach((line, i) => {
      if (/theme-ok/.test(line) || /^\s*(\/\/|\*|import )/.test(line)) return;
      for (const r of KT_RULES) {
        if (r.controls && KT_CONTROLS_DEFINED.test(rel)) continue;
        if (r.re.test(line)) found(f, i, line, r.msg + ktHint(line, r));
      }
    });
  }
}

/* ---------- frozen code: ratchet against the baseline ---------- */
const BASELINE = join(FRAMEWORK, 'spec/conform-baseline.json');
if (!paths.length) {
  const base = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : { files: {} };
  if (updateBaseline) {
    const sorted = Object.fromEntries(Object.entries(frozenCounts).sort(([a], [b]) => a.localeCompare(b)));
    writeFileSync(BASELINE, JSON.stringify({
      schema: 'conform-baseline@1',
      note: 'Asset-conformance findings in frozen code (Android on hold, Patches paused). check-theme.mjs fails if a file goes above its count; fix and run --update-baseline to shrink it. New files never get an entry.',
      total: Object.values(sorted).reduce((a, b) => a + b, 0),
      files: sorted,
    }, null, 2) + '\n');
    console.log(`baseline written: ${Object.keys(sorted).length} frozen file(s), ${Object.values(sorted).reduce((a, b) => a + b, 0)} finding(s)`);
  }
  const allowed = updateBaseline ? frozenCounts : base.files ?? {};
  let frozen = 0;
  for (const [rel, n] of Object.entries(frozenCounts)) {
    frozen += n;
    if (n > (allowed[rel] ?? 0)) {
      problems += n - (allowed[rel] ?? 0);
      console.log(`${rel}  ${n} asset-conformance finding(s), baseline allows ${allowed[rel] ?? 0} (${frozenOf(rel).why}); run node framework/cli/check-theme.mjs ${rel} to list them`);
    }
  }
  if (frozen) console.log(`  (frozen code: ${frozen} finding(s) held at the baseline in framework/spec/conform-baseline.json)`);
}

if (problems) {
  console.log(`\n✗ ${problems} theme problem(s) in ${files} file(s). UI must follow the theme engines (framework/spec/THEMING.md).`);
  process.exit(1);
}
console.log(`✓ theme-conformant — ${files} file(s) checked, ${known.size} tokens known`);
