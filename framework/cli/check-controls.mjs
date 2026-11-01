#!/usr/bin/env node
/**
 * check-controls — plugins and libraries inherit the app's style (Brett, Oct 22 2026; _claude/rules/RULES.md
 * "Plugins inherit the app's style"). Every <button> in a plugin or library UI is one of the framework's controls, so the
 * app's button asset, style theme and spacing restyle it:
 *
 *   - its className carries a framework control class: fx-btn (or <Button>), fx-iconbtn (<IconButton>), fx-chip,
 *     fx-seg__opt (<Segmented>), fx-tab, fx-menu__item, fx-nav__item; or
 *   - it is a whole row / card you tap, marked `data-fx-row` (no control chrome of its own; the plugin lays it out).
 *
 * And a plugin's own class on such a control may lay it out (margin, flex, order, width…) but never restyle it: rules
 * for those classes may not set background, color, border, border-radius, padding, font-size, font-weight, box-shadow
 * or text-transform.
 *
 *   node framework/cli/check-controls.mjs [--json] [root…]   (default: apps/console-web/plugins + framework/libs)
 * Exit 1 on any finding. Vendored code (`vendor/`) and tests are skipped.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const json = args.includes('--json');
const roots = args.filter((a) => !a.startsWith('--')).map((a) => resolve(ROOT, a));
/**
 * Asset conformance (Brett, Oct 31 2026, build asset-conform): every web UI is held to it, handwritten or generated —
 * plugins and libraries, framework React views, every app's own UI and what the build system generates from (app
 * templates, library templates, the plugin template). Patches is paused (Brett, Oct 28 2026) and is left as it is.
 */
const APPS = (() => { try { return readdirSync(join(ROOT, 'apps')).filter((a) => !a.startsWith('patches')); } catch { return []; } })();
const ROOTS = roots.length ? roots : [
  join(ROOT, 'framework/libs'), join(ROOT, 'framework/react'), join(ROOT, 'framework/templates'), join(ROOT, 'framework/library-templates'),
  ...APPS.flatMap((a) => [join(ROOT, 'apps', a, 'plugins'), join(ROOT, 'apps', a, 'src')]),
];
/** Where the framework's controls and chrome are defined: their buttons ARE the controls (allowlisted). */
const DEFINES = ['framework/react/components', 'framework/react/windows'];

export const CONTROL_CLASSES = ['fx-btn', 'fx-iconbtn', 'fx-chip', 'fx-seg__opt', 'fx-tab', 'fx-menu__item', 'fx-nav__item'];
export const RESTYLE_PROPS = ['background', 'background-color', 'color', 'border', 'border-color', 'border-radius', 'padding', 'font-size', 'font-weight', 'box-shadow', 'text-transform'];

function walk(dir, out = []) {
  let names = [];
  try { names = readdirSync(dir); } catch { return out; }
  for (const n of names) {
    if (n === 'node_modules' || n === 'vendor' || n === 'dist' || n.startsWith('.')) continue;
    const p = join(dir, n);
    if (/[\\/]src[\\/]axf$/.test(p) || DEFINES.some((d) => p === join(ROOT, d))) continue; // baked framework copies; where the controls are defined
    let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, out);
    else if (/\.(tsx|jsx|css)$/.test(n) && !/\.test\./.test(n)) out.push(p);
  }
  return out;
}

/** Every <button …> opening tag in a JSX file, with its line: attributes may hold {…} with `>` inside (arrows). */
export function buttonTags(src) {
  const out = [];
  const re = /<button\b/g;
  let m;
  while ((m = re.exec(src))) {
    let i = m.index + 7, depth = 0, quote = '';
    for (; i < src.length; i++) {
      const c = src[i];
      if (quote) { if (c === quote && src[i - 1] !== '\\') quote = ''; continue; }
      if (depth > 0 && (c === '"' || c === "'" || c === '`')) { quote = c; continue; }
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) break;
    }
    out.push({ tag: src.slice(m.index, i + 1), line: src.slice(0, m.index).split('\n').length });
  }
  return out;
}

/** The class names a className attribute can carry (string, template or expression: every word-ish token). */
export function classesOf(tag) {
  const m = tag.match(/className=(\{[\s\S]*?\}(?=\s+[\w-]+(?:=|\s|\/?>|$)|\s*\/?>|\s*$)|"[^"]*"|'[^']*')/);
  if (!m) return [];
  return [...new Set(m[1].match(/[A-Za-z_][\w-]*(?:__[\w-]+)?/g) ?? [])];
}

export function checkTag(tag) {
  if (/\sdata-fx-row\b/.test(tag)) return null;
  const cls = classesOf(tag);
  if (CONTROL_CLASSES.some((c) => cls.includes(c))) return null;
  return 'a <button> that isn\'t a framework control: use <Button>/<IconButton>/<Segmented>, a framework class (' + CONTROL_CLASSES.join(', ') + '), or mark a whole tappable row with data-fx-row';
}

/** Own classes used together with a framework control class (they may lay the control out, never restyle it). */
export function ownControlClasses(tag) {
  const cls = classesOf(tag);
  if (!CONTROL_CLASSES.some((c) => cls.includes(c)) && !/<Button\b|<IconButton\b/.test(tag)) return [];
  return cls.filter((c) => /^(axp|axf)-/.test(c));
}

/** CSS rules (very small parser: no nesting) whose selector names one of `classes` and that restyle it. */
export function restyles(css, classes) {
  const found = [];
  const body = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(body))) {
    const sel = m[1].trim();
    if (sel.startsWith('@')) continue;
    for (const c of classes) {
      // the class itself is styled (not just something inside it: `.x .y` where x is the control's own class is fine)
      const own = new RegExp(`\\.${c.replace(/[-]/g, '\\-')}(?![\\w-])(?:[.:\\[][^\\s,>+~]*)?\\s*(?:,|$)`);
      if (!sel.split(',').some((part) => own.test(part.trim()))) continue;
      const props = m[2].split(';').map((d) => d.split(':')[0].trim().toLowerCase()).filter((p) => RESTYLE_PROPS.includes(p));
      if (props.length) found.push({ selector: sel.replace(/\s+/g, ' ').slice(0, 120), props, line: body.slice(0, m.index).split('\n').length });
    }
  }
  return found;
}

export function check(roots = ROOTS) {
  const findings = [];
  const ownByDir = new Map();
  for (const root of roots) {
    for (const f of walk(root)) {
      if (!/\.(tsx|jsx)$/.test(f)) continue;
      const src = readFileSync(f, 'utf8');
      for (const { tag, line } of buttonTags(src)) {
        const why = checkTag(tag);
        if (why) findings.push({ file: relative(ROOT, f), line, why, tag: tag.replace(/\s+/g, ' ').slice(0, 140) });
        const own = ownControlClasses(tag);
        if (own.length) { const d = pluginDir(f); ownByDir.set(d, new Set([...(ownByDir.get(d) ?? []), ...own])); }
      }
      // <Button className="axp-…"> also counts as a control carrying an own class
      for (const m of src.matchAll(/<(?:Button|IconButton)\b[^>]*?className="([^"]*)"/g)) {
        const own = m[1].split(/\s+/).filter((c) => /^(axp|axf)-/.test(c));
        if (own.length) { const d = pluginDir(f); ownByDir.set(d, new Set([...(ownByDir.get(d) ?? []), ...own])); }
      }
    }
  }
  for (const root of roots) {
    for (const f of walk(root)) {
      if (!f.endsWith('.css')) continue;
      const own = ownByDir.get(pluginDir(f));
      if (!own?.size) continue;
      for (const r of restyles(readFileSync(f, 'utf8'), [...own])) {
        findings.push({ file: relative(ROOT, f), line: r.line, why: `restyles a framework control (${r.props.join(', ')}): its own class may lay it out only`, tag: r.selector });
      }
    }
  }
  return findings;
}

/** A plugin's or library's folder: classes are matched within one plugin, never across. */
function pluginDir(f) {
  const rel = relative(ROOT, f).split(/[\\/]/);
  const i = rel.indexOf('plugins'), j = rel.indexOf('libs');
  const k = i >= 0 ? i + 2 : j >= 0 ? j + 2 : rel.length - 1;
  return rel.slice(0, k).join('/');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const findings = check();
  if (json) console.log(JSON.stringify({ ok: !findings.length, findings }, null, 2));
  else if (!findings.length) console.log('✓ controls — every plugin and library button is a framework control');
  else {
    for (const f of findings) console.log(`✗ ${f.file}:${f.line}  ${f.why}\n    ${f.tag}`);
    console.log(`✗ ${findings.length} finding(s) (rule: plugins inherit the app's style)`);
  }
  process.exitCode = findings.length ? 1 : 0;
}
