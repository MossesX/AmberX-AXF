#!/usr/bin/env node
/**
 * Every setting sits in a categorized, collapsible section (Brett, Nov 7 2026, build settings-sections-everywhere).
 * Fails when a settings group or panel names no section, or names one that doesn't exist, in any app, library or plugin:
 * libraries' `settings` and `settingsPanels`, `addGroup` / `addPanel` calls, and the option groups a settings asset brings.
 * A group of more than MAX_GROUP settings fails too: split it by kind of setting. Sections themselves come from
 * SETTINGS_SECTIONS (framework/core/engines/settingsui.ts) or a settings asset's `sections`.
 *
 *   node framework/cli/check-settings-sections.mjs [--json] [--list]
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const ROOTS = ['apps', 'framework/libs', 'framework/react', 'framework/templates', 'framework/library-templates', 'framework/boilerplates'];
const SKIP = /(^|\/)(node_modules|dist|src\/axf|\.next|server|android|\.git)(\/|$)/;
export const MAX_GROUP = 10;

function* walk(dir) {
  if (!existsSync(dir)) return;
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (SKIP.test(relative(ROOT, p))) continue;
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.tsx?$/.test(n) && !/\.d\.ts$/.test(n)) yield p;
  }
}

/** Standard section ids, read from the engine's source (this CLI runs on plain Node). */
export function standardSections() {
  const src = readFileSync(join(ROOT, 'framework/core/engines/settingsui.ts'), 'utf8');
  const block = src.slice(src.indexOf('export const SETTINGS_SECTIONS'), src.indexOf('export const SETTINGS_SECTION_DEFAULT'));
  return new Set([...block.matchAll(/\{ id: '([a-z0-9-]+)', title:/g)].map((m) => m[1]));
}

/** Bracket pairs of TS source, skipping strings, templates' text and comments: open index → close index. */
function pairs(s) {
  const out = new Map(), stack = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '/' && s[i + 1] === '/') { i = s.indexOf('\n', i); if (i < 0) break; continue; }
    if (c === '/' && s[i + 1] === '*') { i = s.indexOf('*/', i); if (i < 0) break; i += 1; continue; }
    if (c === "'" || c === '"') { for (i++; i < s.length && s[i] !== c && s[i] !== '\n'; i++) if (s[i] === '\\') i++; continue; }
    if (c === '`') { for (i++; i < s.length && s[i] !== '`'; i++) { if (s[i] === '\\') i++; else if (s[i] === '$' && s[i + 1] === '{') { let d = 1; i += 2; for (; i < s.length && d; i++) { if (s[i] === '{') d++; else if (s[i] === '}') d--; } i--; } } continue; }
    if ('([{'.includes(c)) stack.push(i);
    else if (')]}'.includes(c)) { const o = stack.pop(); if (o !== undefined) out.set(o, i); }
  }
  return out;
}

/** Top-level `{…}` entries of the bracket pair at `open`. */
function entries(s, br, open) {
  const end = br.get(open), out = [];
  for (let i = open + 1; i < end; i++) {
    if (s[i] === '{' && br.has(i)) { out.push([i, br.get(i)]); i = br.get(i); }
    else if ('([`'.includes(s[i]) && br.has(i)) i = br.get(i);
  }
  return out;
}

/** The object's own keys (depth 1): name → text position of the value. */
function keysOf(s, br, open) {
  const end = br.get(open), keys = {};
  let i = open + 1, atKey = true;
  while (i < end) {
    if (atKey) { const m = /^\s*(?:\/\/[^\n]*\n\s*)*([A-Za-z_$][\w$]*)\s*:/.exec(s.slice(i, i + 300)); if (m) { keys[m[1]] = i + m[0].length; i += m[0].length; atKey = false; continue; } }
    const c = s[i];
    if ('([{'.includes(c) && br.has(i)) { i = br.get(i) + 1; continue; }
    if (c === "'" || c === '"' || c === '`') { const q = c; for (i++; i < end && s[i] !== q; i++) if (s[i] === '\\') i++; i++; continue; }
    if (c === ',') atKey = true;
    i++;
  }
  return keys;
}

const word = (s, pos) => (s.slice(pos, pos + 120).match(/^\s*('[^']*'|`[^`]*`|"[^"]*"|[\w$.[\]]+)/)?.[1] ?? '').replace(/^['"`]|['"`]$/g, '');
const lineOf = (s, i) => s.slice(0, i).split('\n').length;

/** Every settings group and panel declared in one source file. */
export function scan(s) {
  const br = pairs(s), found = [], done = [];
  const inside = (i) => done.some(([a, b]) => i > a && i < b);
  const add = (kind, open) => {
    const k = keysOf(s, br, open);
    if (!k.id && /\.\.\./.test(s.slice(open, br.get(open)))) return; // a wrapper around entries checked where they are written
    const specs = k.settings ? (() => { const o = s.slice(k.settings).search(/\S/) + k.settings; return s[o] === '[' ? entries(s, br, o).length : undefined; })() : undefined;
    found.push({ kind, open, close: br.get(open), line: lineOf(s, open), id: k.id ? word(s, k.id) : '(no id)', title: word(s, k.title ?? k.label ?? 0) || '', section: k.section ? word(s, k.section) : undefined, specs, idAt: k.id });
    done.push([open, br.get(open)]);
  };
  for (const m of s.matchAll(/\bsettingsPanels\s*:\s*/g)) {
    const o = m.index + m[0].length;
    if (s[o] === '[') { let any = false; for (const [a] of entries(s, br, o)) { add('panel', a); any = true; } if (any) done.push([o, br.get(o)]); }
    else {
      // `settingsPanels: list.map((p) => ({ …p, … }))`: a wrapper's entries are checked where the list is written
      const name = /^([A-Za-z_$][\w$]*)\.map\(/.exec(s.slice(o, o + 80))?.[1];
      const decl = name && new RegExp(`\\bconst\\s+${name}\\b[^\\n]*?=\\s*\\[`).exec(s);
      if (decl) { const open = decl.index + decl[0].length - 1; for (const [a] of entries(s, br, open)) add('panel', a); continue; }
      const c = s.indexOf('{', s.indexOf('=>', o));
      if (br.has(c) && keysOf(s, br, c).id) add('panel', c);
    }
    if (s[o] === '[') { const spread = /\.map\([^]*?=>\s*\(\{/.exec(s.slice(o, br.get(o))); if (spread) { const c = o + spread.index + spread[0].length - 1; if (!found.some((f) => f.open === c)) add('panel', c); } }
  }
  for (const m of s.matchAll(/\bsettings\s*:\s*\[/g)) {
    const o = m.index + m[0].length - 1;
    if (inside(o) || !br.has(o)) continue;
    const list = entries(s, br, o);
    if (!list.length) continue;
    const first = keysOf(s, br, list[0][0]);
    if (first.key || first.kind) continue; // a list of settings: its group shows up by itself below
    for (const [a] of list) add('group', a);
    done.push([o, br.get(o)]);
  }
  // a group kept in a constant: { id, label, settings: [{ key… }] } outside any library list
  for (const m of s.matchAll(/\bsettings\s*:\s*\[/g)) {
    const o = m.index + m[0].length - 1;
    if (inside(o) || !br.has(o)) continue;
    const list = entries(s, br, o);
    if (!list.length || !keysOf(s, br, list[0][0]).key) continue;
    let owner = -1;
    for (const [a, b] of br) if (a < o && b > br.get(o) && s[a] === '{' && a > owner) owner = a;
    if (owner >= 0 && keysOf(s, br, owner).label) add('group', owner);
  }
  for (const m of s.matchAll(/\.add(Group|Panel)\(\s*\{/g)) { const o = m.index + m[0].length - 1; if (!inside(o) && br.has(o)) add(m[1] === 'Group' ? 'group' : 'panel', o); }
  return found.sort((a, b) => a.open - b.open);
}

/** Settings assets: their own groups need a section as well; their `sections` add to the known ids. */
function assetFiles() {
  const out = [];
  for (const d of ['framework/assets/settings', ...(existsSync(join(ROOT, 'apps')) ? readdirSync(join(ROOT, 'apps')).flatMap((a) => [`apps/${a}/src/assets/settings`, `apps/${a}/src/assets-overrides/settings`]) : [])]) {
    const dir = join(ROOT, d);
    if (existsSync(dir)) for (const n of readdirSync(dir)) if (n.endsWith('.json')) out.push(join(dir, n));
  }
  return out;
}

export function audit() {
  const known = standardSections(), problems = [], items = [];
  const assets = assetFiles().map((f) => ({ f, data: JSON.parse(readFileSync(f, 'utf8')).data ?? {} }));
  for (const a of assets) for (const x of a.data.sections ?? []) if (typeof x?.id === 'string') known.add(x.id);
  for (const a of assets) for (const g of a.data.groups ?? []) {
    const file = relative(ROOT, a.f);
    items.push({ file, kind: 'group', id: g.id, title: g.label, section: g.section });
    if (!g.section) problems.push(`${file}: settings group ${g.id} names no section`);
  }
  for (const root of ROOTS) for (const f of walk(join(ROOT, root))) {
    const src = readFileSync(f, 'utf8');
    if (!/settingsPanels|\bsettings\s*:\s*\[|\.add(Group|Panel)\(/.test(src)) continue;
    const file = relative(ROOT, f);
    for (const x of scan(src)) {
      items.push({ file, kind: x.kind, line: x.line, id: x.id, title: x.title, section: x.section, specs: x.specs });
      const at = `${file}:${x.line}: settings ${x.kind} ${x.id}`;
      if (!x.section) problems.push(`${at} names no section; add section: '<id>' (${[...standardSections()].join(', ')})`);
      else if (/^[a-z0-9-]+$/.test(x.section) && !known.has(x.section)) problems.push(`${at} names section '${x.section}', which is neither standard nor in a settings asset`);
      if (x.kind === 'group' && x.specs > MAX_GROUP) problems.push(`${at} has ${x.specs} settings (over ${MAX_GROUP}): split it by kind of setting`);
    }
  }
  return { items, problems };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { items, problems } = audit();
  if (process.argv.includes('--json')) console.log(JSON.stringify({ items, problems }, null, 1));
  else if (process.argv.includes('--list')) for (const x of items) console.log(`${x.section ?? '-'}\t${x.file}:${x.line ?? ''}\t${x.kind}\t${x.id}\t${x.title}\t${x.specs ?? ''}`);
  else {
    for (const p of problems) console.error(p);
    console.log(problems.length ? `settings sections: ${problems.length} problem(s) in ${items.length} groups and panels` : `settings sections: ok (${items.length} groups and panels, every one in a section)`);
  }
  process.exit(problems.length ? 1 : 0);
}
