#!/usr/bin/env node
/**
 * skin-audit — where a skin can't restyle what is drawn (build skins-restyle-everything, Nov 2026, Brett: "the skin
 * literally needs to change every single visual thing everywhere").
 *
 *   node framework/cli/skin-audit.mjs [--json] [--css <file>]   (default css: framework/ui/axf.css)
 *
 * A skin reaches the screen three ways: its colour / style / layout themes (the --fx-* tokens every rule reads), the
 * assets it picks for each slot, and its style parts (skin@1 `parts`), which the customize engine draws under each
 * type's style target (schemas/customize.json `targets`: a root and its items). This audit lists what the third way
 * misses and what no way reaches:
 *
 *   target     a style target whose root or item class nothing renders (framework/react, framework/libs): the type's
 *              parts never reach the screen (the bug this build fixed for banner badges)
 *   shadowed   a drawn element inside a typed element (`.fx-banner__logo` inside `.fx-banner`) that sets its own colour,
 *              font, radius, border or shadow: the type's parts set the root and items, the element keeps its own
 *   untyped    a component no asset type owns (tables, inputs, toasts, chips, scrollbars …) that sets colour, font,
 *              radius, border or shadow: only the theme tokens restyle it, a skin's parts can't
 *   literal    a look value written in instead of read from a token (font-weight numbers, pill radii, px outlines),
 *              which no theme, asset or part changes
 *
 * Read-only; exits 0 (it is a list, the gate is skins.mjs coverage + the s5 screenshot check).
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const json = args.includes('--json');
const cssArg = args.indexOf('--css');
const cssFile = cssArg >= 0 ? resolve(args[cssArg + 1]) : join(ROOT, 'framework/ui/axf.css');

const custom = JSON.parse(readFileSync(join(ROOT, 'framework/schemas/customize.json'), 'utf8'));
const split = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
const classOf = (sel) => (sel.match(/\.(fx-[a-z0-9_-]+)/) || [])[1] || '';
/** The block of a BEM class: fx-banner__logo → fx-banner, fx-nav--rail → fx-nav. */
const blockOf = (cls) => cls.replace(/(__|--).*$/, '');

/* type → { roots, items } (class names) */
const targets = Object.entries(custom.targets).map(([type, t]) => ({ type, roots: split(t.root).map(classOf), items: split(t.item).map(classOf) }));
const ownerOf = new Map();
for (const t of targets) for (const c of [...t.roots, ...t.items]) ownerOf.set(c, t.type);
const blockOwner = new Map();
// a block belongs to the type whose root or item IS the block (.fx-banner → banner, .fx-tab → tab-group); a root that
// is itself an element of another block (.fx-banner__clock) owns only its own children
for (const t of targets) for (const c of [...t.roots, ...t.items]) if (blockOf(c) === c && !blockOwner.has(c)) blockOwner.set(c, t.type);
for (const t of targets) for (const c of t.roots) if (!blockOwner.has(c)) blockOwner.set(c, t.type);
const ownerOfClass = (cls) => blockOwner.get(blockOf(cls)) || [...blockOwner.entries()].find(([b]) => cls.startsWith(`${b}__`))?.[1];

/* ---------- target: every root / item class is rendered somewhere ---------- */
function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out); else if (/\.(tsx|ts)$/.test(name)) out.push(p);
  }
  return out;
}
const code = [...walk(join(ROOT, 'framework/react')), ...walk(join(ROOT, 'framework/libs'))].map((f) => readFileSync(f, 'utf8')).join('\n');
const rendered = (cls) => new RegExp(`(["'\`\\s{])${cls}(["'\`\\s$}])`).test(code);
const target = [];
for (const t of targets) for (const c of [...t.roots, ...t.items]) if (c && !rendered(c)) target.push({ type: t.type, class: c });

/* ---------- css rules ---------- */
const css = readFileSync(cssFile, 'utf8').replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
const LOOK = /^(color|background|background-color|font-family|font-weight|font-size|border|border-color|border-radius|box-shadow|outline)$/;
const rules = [];
for (const m of css.matchAll(/([^{}@;]+)\{([^{}]*)\}/g)) {
  const line = css.slice(0, m.index).split('\n').length + (m[1].match(/^\s*/)[0].split('\n').length - 1);
  const decls = m[2].split(';').map((d) => d.trim()).filter(Boolean).map((d) => { const i = d.indexOf(':'); return [d.slice(0, i).trim(), d.slice(i + 1).trim()]; });
  for (const sel of split(m[1])) rules.push({ sel, decls, line });
}
/** The element a selector styles: its last compound's first fx class (pseudo-elements and states stripped). */
const subjectOf = (sel) => {
  const last = sel.split(/\s+|>|\+|~/).filter(Boolean).pop() || '';
  return classOf(last.replace(/::?[a-z-]+(\([^)]*\))?/g, ''));
};

const shadowed = [];
const untyped = new Map();
const literal = [];
for (const r of rules) {
  const subject = subjectOf(r.sel);
  const look = r.decls.filter(([p]) => LOOK.test(p));
  for (const [p, v] of r.decls) {
    if (p === 'font-weight' && /^\d+$/.test(v)) literal.push({ line: r.line, sel: r.sel, decl: `${p}: ${v}` });
    else if (p === 'border-radius' && /999px|50%/.test(v)) literal.push({ line: r.line, sel: r.sel, decl: `${p}: ${v}` });
    else if (/^outline(-width)?$/.test(p) && /\b\d+px\b/.test(v)) literal.push({ line: r.line, sel: r.sel, decl: `${p}: ${v}` });
  }
  if (!subject || !look.length) continue;
  if (ownerOf.has(subject)) continue; // a root or an item: the type's parts reach it
  // a modifier of a root or item (.fx-btn--primary) is the same element: parts (`:root body .fx-btn`) outrank it
  if (!subject.includes('__') && ownerOf.has(blockOf(subject))) continue;
  const owner = ownerOfClass(subject) || targets.find((t) => t.roots.some((c) => r.sel.includes(`.${c} `) || r.sel.includes(`.${c}>`)))?.type;
  if (owner) shadowed.push({ type: owner, line: r.line, sel: r.sel, props: look.map(([p]) => p) });
  else {
    const b = blockOf(subject);
    const u = untyped.get(b) || { block: b, rules: 0, lines: [] };
    u.rules++; if (u.lines.length < 3) u.lines.push(r.line);
    untyped.set(b, u);
  }
}
const untypedList = [...untyped.values()].sort((a, b) => b.rules - a.rules);

const report = { css: relative(ROOT, cssFile), target, shadowed, untyped: untypedList, literal };
if (json) { console.log(JSON.stringify(report, null, 1)); process.exit(0); }
console.log(`skin-audit — ${report.css}`);
console.log(`\ntarget (${target.length}): style-target classes nothing renders`);
for (const t of target) console.log(`  ${t.type.padEnd(14)} .${t.class}`);
const byType = {};
for (const s of shadowed) (byType[s.type] ||= []).push(s);
console.log(`\nshadowed (${shadowed.length} rules in ${Object.keys(byType).length} types): elements inside a typed element with their own look`);
for (const [type, xs] of Object.entries(byType)) console.log(`  ${type.padEnd(14)} ${xs.length} rules · ${[...new Set(xs.map((x) => subjectOf(x.sel)))].slice(0, 6).map((c) => '.' + c).join(' ')}`);
console.log(`\nuntyped (${untypedList.length} components): no asset type owns them, only theme tokens restyle them`);
for (const u of untypedList) console.log(`  .${u.block.padEnd(26)} ${String(u.rules).padStart(3)} rules  (axf.css:${u.lines.join(',')})`);
console.log(`\nliteral (${literal.length}): look values written in, not read from a token`);
const lit = {};
for (const l of literal) lit[l.decl.replace(/:.*/, '') + (/999px|50%/.test(l.decl) ? ' (pill/circle)' : '')] = (lit[l.decl.replace(/:.*/, '') + (/999px|50%/.test(l.decl) ? ' (pill/circle)' : '')] || 0) + 1;
for (const [k, n] of Object.entries(lit)) console.log(`  ${k.padEnd(28)} ${n}`);
