#!/usr/bin/env node
/**
 * API coverage of the console's UI (api-coverage@1; build full-api-control, Nov 7 2026, Brett: "the API (control@1 /
 * MCP / CLI / voice) must be able to do anything Brett can do by hand in the console and every plugin").
 *
 * Walks the console screen by screen and plugin by plugin — its own source (apps/console-web/src), every console
 * plugin's web part and server routes, and the framework's React layer the console is drawn with — and lists every
 * switch, setting, button, menu item, context-menu entry, toolbar, dialog, tab, screen and action with the API path that
 * reads or changes or triggers it:
 *
 *   screen          console.screens open <id>                    (views, nav items, windows named as screens)
 *   dialog          console.dialogs open <id>
 *   settings-tab    console.settings open <id>                   settings-panel: the same, then its controls (below)
 *   setting         console.values get|set <key>                 (every key a settings group declares)
 *   action          console.actions run <id>                     (and plugins.commands <plugin>/<action>)
 *   menu            the item's action (app menu, context menu); runtime context entries: console.elements context + press
 *   route           plugins.commands | plugins.reads <plugin>/<command>   (server routes; plugin-commands@1)
 *   control         console.elements press|toggle|set "<where>/<role>:<label>"   (every button, switch, field, tab row …)
 *
 * Status: `covered` (a named API path), `generic` (console.elements, by its accessible name, while it is on screen),
 * `person-only` (Brett's own tap by design: approvals, owner-only settings; the API brings it up, he decides),
 * `skipped` (a plugin declared why: streams, the browser's own probes), `gap` (no API path: an unnamed control the API
 * can't address, an action nobody can run). CI fails on a gap and on a stale registry file.
 *
 *   node framework/cli/api-coverage.mjs                 summary (per area: elements, covered, generic, person-only, gaps)
 *   node framework/cli/api-coverage.mjs gaps            every gap with file:line and what to add
 *   node framework/cli/api-coverage.mjs table [words]   the coverage table (element, where, API path, status)
 *   node framework/cli/api-coverage.mjs write           rewrite framework/schemas/api-coverage.json
 *   node framework/cli/api-coverage.mjs check           CI: no gaps (exit 1 otherwise); --strict also fails a registry file that is out of date
 *   --json on any of them
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registry as pluginRegistry } from './plugin-commands.mjs';

export const ROOT = resolve(process.env.AXF_ROOT || join(dirname(fileURLToPath(import.meta.url)), '../..'));
export const FRAME = 'api-coverage@1';
export const OUT = 'apps/console-web/api-coverage.json';
export const STATUSES = ['covered', 'generic', 'person-only', 'skipped', 'gap'];

/** Where the console's UI lives: its own source, every plugin's web part, the framework's React layer. */
const AREAS = [
  { area: 'console', dir: 'apps/console-web/src', skip: /(^|\/)(axf|assets|assets-overrides)(\/|$)|\.test\.|\.d\.ts$/ },
  { area: 'framework', dir: 'framework/react', skip: /\.test\.|\.d\.ts$|(^|\/)vendor\// },
  { area: 'framework', dir: 'framework/libs', skip: /\.test\.|\.d\.ts$|(^|\/)vendor\/|(^|\/)python\// },
];
const PLUGINS_DIR = 'apps/console-web/plugins';

const read = (p) => readFileSync(p, 'utf8');
function files(dir, test) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const n of readdirSync(dir).sort()) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) { if (n !== 'node_modules' && n !== 'vendor' && !n.startsWith('.')) out.push(...files(p, test)); } else if (test(n, p)) out.push(p);
  }
  return out;
}
const lineOf = (src, i) => src.slice(0, i).split('\n').length;

/* ================================================================== JSX scanning (text in, facts out) */

/** The text of a JSX opening tag starting at `i` (the `<`): up to the `>` that closes it, braces and strings respected. */
export function tagAt(src, i) {
  let depth = 0; let q = null;
  for (let j = i + 1; j < src.length; j++) {
    const ch = src[j];
    if (q) { if (ch === '\\') { j++; continue; } if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { q = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    else if (ch === '>' && depth === 0) return { text: src.slice(i, j + 1), end: j + 1, selfClosing: src[j - 1] === '/' };
  }
  return null;
}

/** A prop's raw value in a tag (`label="x"` → "x", `label={…}` → "{…}"), or null. */
export function propOf(tag, name) {
  const re = new RegExp(`[\\s{]${name.replace(/[-]/g, '\\-')}=(?:"([^"]*)"|'([^']*)'|\\{)`, 'g');
  const m = re.exec(tag);
  if (!m) return null;
  if (m[1] !== undefined || m[2] !== undefined) return m[1] ?? m[2];
  let depth = 1; const start = m.index + m[0].length;
  for (let j = start; j < tag.length; j++) { if (tag[j] === '{') depth++; else if (tag[j] === '}' && --depth === 0) return `{${tag.slice(start, j)}}`; }
  return '{}';
}

/** Readable text of a label expression ("Save", {`Deny: ${x}`} → "Deny: …", {t('x')} → "{expr}"). */
const labelText = (v) => (v == null ? '' : v.startsWith('{') ? (v.match(/['"`]([^'"`$]{2,60})/)?.[1]?.trim() || '{expr}') : v.trim());

/** The children text of an element (up to its closing tag, inner tags dropped): its visible name when it has one. */
function childText(src, end, tag) {
  const close = src.indexOf(`</${tag}>`, end);
  const body = src.slice(end, close > end && close - end < 1500 ? close : end + 400);
  const text = body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  const plain = text.replace(/\{[^}]*\}/g, ' ').replace(/[\s()?:&|!.,;'"`-]+/g, ' ').trim();
  if (/[A-Za-z]{2}/.test(plain)) return plain.slice(0, 60);
  if (/\{[^}]*[A-Za-z][^}]*\}/.test(text) && !/^\{\s*\}$/.test(text)) return '{expr}'; // a name made at run time ({label}, {t.title})
  return '';
}

/** Inside a <label> that isn't closed yet: a field named by its label's text. */
function insideLabel(src, at) {
  const back = src.slice(Math.max(0, at - 600), at);
  if (back.lastIndexOf('<label') > back.lastIndexOf('</label>')) return true;
  return back.lastIndexOf('<Field') > back.lastIndexOf('</Field>'); // a Field (framework or a plugin's own) labels what it wraps
}

/** Controls a person presses, flips or fills: framework components and raw elements, with the verb the API uses. */
export const CONTROL_TAGS = {
  Button: 'press', IconButton: 'press', Chip: null, Switch: 'toggle', Checkbox: 'toggle', TextField: 'set', SelectField: 'set', Slider: 'set',
  Segmented: 'press', TabGroup: 'press', SearchField: 'set', NumberField: 'set', ColorField: 'set', Toggle: 'toggle', MenuButton: 'press',
  button: 'press', input: 'set', select: 'set', textarea: 'set',
};
const NAME_PROPS = ['aria-label', 'ariaLabel', 'label', 'title', 'tip', 'placeholder', 'data-axf-id', 'name', 'aria-labelledby', 'data-axf-toolbar'];

/** Every control in one TSX source: { tag, verb, label, line, personOnly, named }. */
export function scanControls(src) {
  const out = [];
  const re = /<([A-Z][A-Za-z]*|button|input|select|textarea)(?=[\s/>])/g;
  let m;
  while ((m = re.exec(src))) {
    const tag = m[1];
    if (!(tag in CONTROL_TAGS) || CONTROL_TAGS[tag] === null) continue;
    const t = tagAt(src, m.index);
    if (!t) continue;
    if (tag === 'input' && /type=["'](hidden|file)["']/.test(t.text)) continue; // a hidden value / a file picker behind a named button
    if (tag === 'Chip' || (/\bonClick=/.test(t.text) === false && ['Button', 'IconButton', 'button'].includes(tag) && !/type=["']submit/.test(t.text))) {
      // a button without onClick does nothing by itself (a submit, or a decorative one): still listed if it has a name
    }
    let label = '';
    for (const p of NAME_PROPS) { const v = propOf(t.text, p); if (v != null && v !== '{}' && v !== '') { label = labelText(v); break; } }
    if (!label && !t.selfClosing) label = childText(src, t.end, tag);
    if (!label && ['input', 'select', 'textarea', 'Checkbox'].includes(tag) && insideLabel(src, m.index)) label = '(its <label>)';
    if (!label && ['input', 'select', 'textarea'].includes(tag) && /\sid=/.test(t.text) && /htmlFor=/.test(src)) label = '(its <label htmlFor>)';
    // a spread of props ({...rest}) or a role="presentation" wrapper: named by its owner
    const spread = /\{\s*\.\.\.[A-Za-z_]/.test(t.text);
    const personOnly = /data-axf-person-only/.test(t.text);
    out.push({ tag, verb: CONTROL_TAGS[tag], label, line: lineOf(src, m.index), personOnly, named: !!label || spread, spread });
  }
  return out;
}

/** `rt.actions.register('<id>', …, { … personOnly: true … })` → [{ id, line, personOnly, params, screen }]. */
export function scanActions(src) {
  const out = [];
  const re = /actions\.register\(\s*(['"`])([^'"`$]+)\1/g;
  let m;
  while ((m = re.exec(src))) {
    const tail = src.slice(m.index, m.index + 1500);
    const meta = tail.match(/\{\s*label:[^]*?\}\s*\)/)?.[0] ?? '';
    out.push({ id: m[2], line: lineOf(src, m.index), personOnly: /personOnly:\s*true/.test(meta), params: /params:\s*true/.test(meta), screen: meta.match(/screen:\s*'([^']+)'/)?.[1] ?? '' });
  }
  return out;
}

/** The ids of a map literal in a library: `dialogs: { 'a': …, b: … }` → ['a', 'b'] (top-level keys only). */
export function mapKeys(src, field) {
  const i = src.search(new RegExp(`\\b${field}:\\s*\\{`));
  if (i < 0) return [];
  const open = src.indexOf('{', i);
  const keys = []; let depth = 0; let q = null; let tokStart = open + 1;
  for (let j = open; j < src.length; j++) {
    const ch = src[j];
    if (q) { if (ch === '\\') { j++; continue; } if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { if (depth === 1) { const k = src.slice(j).match(/^(['"`])([^'"`]+)\1\s*:/); if (k) keys.push({ id: k[2], line: lineOf(src, j) }); } q = ch; continue; }
    if (ch === '{' || ch === '(' || ch === '[') depth++;
    else if (ch === '}' || ch === ')' || ch === ']') { if (--depth === 0) break; }
    else if (depth === 1 && /[A-Za-z_]/.test(ch) && /[\s,{]/.test(src[j - 1])) { const k = src.slice(j).match(/^([A-Za-z_][\w-]*)\s*:/); if (k) { keys.push({ id: k[1], line: lineOf(src, j) }); j += k[1].length; } }
    void tokStart;
  }
  return keys;
}

/** Objects with an `id:` inside an array field (`settingsTabs: [{ id: 'x' … }]`). */
export function arrayIds(src, field) {
  const i = src.search(new RegExp(`\\b${field}:\\s*\\[`));
  if (i < 0) return [];
  const open = src.indexOf('[', i);
  let depth = 0; let end = src.length; let q = null;
  for (let j = open; j < src.length; j++) {
    const ch = src[j];
    if (q) { if (ch === '\\') { j++; continue; } if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { q = ch; continue; }
    if (ch === '[' || ch === '{' || ch === '(') depth++;
    else if ((ch === ']' || ch === '}' || ch === ')') && --depth === 0) { end = j; break; }
  }
  const body = src.slice(open, end);
  return [...body.matchAll(/\bid:\s*['"`]([^'"`$]+)['"`]/g)].map((x) => ({ id: x[1], line: lineOf(src, open + x.index) }));
}

/** Setting keys a settings group declares (`key: 'axf.x.y'`) and the actions menus and toolbars name (`action: 'x'`). */
export function settingKeys(src) {
  const out = [];
  for (const x of src.matchAll(/\{\s*key:\s*([^,{}]+?)\s*,\s*label:\s*(['"`])([^'"`]*)\2\s*,\s*kind:\s*['"](\w+)['"]/g)) {
    if (['section', 'custom', 'action', 'link'].includes(x[4])) continue;
    const expr = x[1].trim();
    let id = expr.match(/^['"`]([^'"`$]+)['"`]$/)?.[1] ?? '';
    if (!id) { // a constant (K.speak, KEYS.sort): its value in this file when it is a literal
      const name = (expr.split('.').pop() ?? '').replace(/[^\w]/g, '');
      if (!/^[A-Za-z_]\w*$/.test(name)) { out.push({ id: `${expr} (${x[3]})`, label: x[3], kind: x[4], line: lineOf(src, x.index) }); continue; }
      id = src.match(new RegExp(`\\b${name}:\\s*['"\`]([a-z][^'"\`$]+)['"\`]`))?.[1] ?? src.match(new RegExp(`\\b${name}\\s*=\\s*['"\`]([a-z][^'"\`$]+)['"\`]`))?.[1] ?? `${expr} (${x[3]})`;
    }
    out.push({ id, label: x[3], kind: x[4], line: lineOf(src, x.index) });
  }
  return out;
}
const menuActions = (src) => [...src.matchAll(/\baction:\s*['"`]([a-z][A-Za-z0-9._-]+)(?::[^'"`]*)?['"`]/g)].map((x) => ({ id: x[1], line: lineOf(src, x.index) }));

/* ================================================================== the registry */

const e = (o) => o;
/** The MCP tool call and CLI command for an entry's API path (what the API Browser shows next to REST). */
export const apiNames = (o) => ({ mcp: mcpOf(o), cli: cliOf(o) });
function mcpOf(o) {
  if (!o.api) return '';
  const [target, verb, ...p] = o.api.split(' ');
  const path = p.join(' ');
  if (target === 'console.screens') return `console_open(screen="${path}")`;
  if (target === 'console.dialogs') return `console_dialog(dialog="${path}")`;
  if (target === 'console.settings') return `console_settings(tab="${path}")`;
  if (target === 'console.actions') return `console_action(action="${path}")`;
  if (target === 'console.values') return `console_value(key="${path}")`;
  if (target === 'console.elements') return `console_press(element="${path}", action="${verb}")`;
  if (target === 'plugins.commands' || target === 'plugins.reads') { const [pl, c] = path.split('/'); return `${pl}_${c}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64); }
  return '';
}
function cliOf(o) {
  if (!o.api) return '';
  const [target, verb, ...p] = o.api.split(' ');
  const path = p.join(' ');
  const q = (s) => (/^[\w./:@-]+$/.test(s) ? s : `"${s}"`);
  switch (target) {
    case 'console.screens': return `axf console open ${q(path)}`;
    case 'console.dialogs': return `axf console dialog ${q(path)}`;
    case 'console.settings': return `axf console settings ${q(path)}`;
    case 'console.actions': return `axf console action ${q(path)}`;
    case 'console.values': return `axf console value ${q(path)} [value]`;
    case 'console.elements': return `axf console ${verb === 'set' ? 'fill' : verb === 'context' ? 'menu' : verb} ${q(path)}${verb === 'set' ? ' <value>' : ''}`;
    case 'plugins.commands': case 'plugins.reads': { const [pl, c] = path.split('/'); return `axf ${pl} ${c}`; }
    default: return '';
  }
}

/** Scan one source file of an area → entries. `where` = console | framework | plugin:<folder>. */
export function scanFile(src, rel, where) {
  const out = [];
  const isLib = /\b(views|dialogs|settingsTabs|settingsPanels|nav)\s*:/.test(src);
  if (isLib) {
    for (const k of mapKeys(src, 'views')) out.push(e({ kind: 'screen', id: k.id, label: k.id, where, file: `${rel}:${k.line}`, api: `console.screens open ${k.id}`, status: 'covered' }));
    for (const k of mapKeys(src, 'dialogs')) out.push(e({ kind: 'dialog', id: k.id, label: k.id, where, file: `${rel}:${k.line}`, api: `console.dialogs open ${k.id}`, status: 'covered' }));
    for (const k of arrayIds(src, 'settingsTabs')) out.push(e({ kind: 'settings-tab', id: k.id, label: k.id, where, file: `${rel}:${k.line}`, api: `console.settings open ${k.id}`, status: 'covered' }));
    for (const k of arrayIds(src, 'settingsPanels')) out.push(e({ kind: 'settings-panel', id: k.id, label: k.id, where, file: `${rel}:${k.line}`, api: `console.settings open ${k.id}`, status: 'covered', note: 'its controls are listed as controls' }));
  }
  for (const k of settingKeys(src)) out.push(e({ kind: 'setting', id: k.id, label: k.label || k.id, where, file: `${rel}:${k.line}`, api: `console.values set ${/\s/.test(k.id) ? k.label : k.id}`, status: 'covered', note: k.kind }));
  for (const a of scanActions(src)) {
    out.push(e(a.personOnly
      ? { kind: 'action', id: a.id, label: a.id, where, file: `${rel}:${a.line}`, api: `console.actions run ${a.id}`, status: 'person-only', note: 'Brett\'s own tap (personOnly): the API brings it up, he decides' }
      : { kind: 'action', id: a.id, label: a.id, where, file: `${rel}:${a.line}`, api: `console.actions run ${a.id}`, status: 'covered' }));
    if (a.screen) out.push(e({ kind: 'screen', id: a.screen, label: a.screen, where, file: `${rel}:${a.line}`, api: `console.screens open ${a.screen}`, status: 'covered', note: `a window, opened by ${a.id}` }));
  }
  for (const m of menuActions(src)) out.push(e({ kind: 'menu', id: m.id, label: m.id, where, file: `${rel}:${m.line}`, api: `console.actions run ${m.id}`, status: 'covered' }));
  if (/contextExtras\.set\(/.test(src)) {
    for (const x of src.matchAll(/contextExtras\.set\(\s*['"`]([^'"`]+)['"`]/g)) out.push(e({ kind: 'menu', id: `context:${x[1]}`, label: x[1], where, file: `${rel}:${lineOf(src, x.index)}`, api: `console.elements context <element>`, status: 'generic', note: 'right-click entry: open the menu, then press the item' }));
  }
  if (rel.endsWith('.tsx')) {
    for (const t of src.matchAll(/role="toolbar"[^>]*?aria-label=\{?["'`]([^"'`]+)["'`]/g)) out.push(e({ kind: 'toolbar', id: t[1], label: t[1], where, file: `${rel}:${lineOf(src, t.index)}`, api: `console.elements press ${t[1]}/button:<label>`, status: 'generic' }));
    for (const c of scanControls(src)) {
      const label = c.label || (c.spread ? '(named by its caller)' : '');
      const id = `${c.tag}:${label || '?'}`;
      if (c.personOnly) out.push(e({ kind: 'control', id, label, where, file: `${rel}:${c.line}`, api: `console.elements ${c.verb} <where>/${c.tag.toLowerCase()}:${label}`, status: 'person-only', note: 'data-axf-person-only: Brett\'s own tap' }));
      else if (c.named) out.push(e({ kind: 'control', id, label, where, file: `${rel}:${c.line}`, api: `console.elements ${c.verb} <where>/${c.tag === 'Switch' || c.tag === 'Checkbox' ? 'switch' : c.tag === 'TabGroup' || c.tag === 'Segmented' ? 'tab' : c.verb === 'set' ? 'textbox' : 'button'}:${label}`, status: 'generic' }));
      else out.push(e({ kind: 'control', id, label: '', where, file: `${rel}:${c.line}`, api: '', status: 'gap', fix: `give <${c.tag}> a name the API can address it by: aria-label="…" (or label= / title= / visible text)` }));
    }
  }
  return out;
}

/** Every entry: the console, the framework's React layer, every plugin (web + server routes). */
export function build() {
  const entries = [];
  for (const a of AREAS) {
    for (const f of files(join(ROOT, a.dir), (n, p) => /\.(tsx?|mjs)$/.test(n) && !a.skip.test(relative(join(ROOT, a.dir), p)))) entries.push(...scanFile(read(f), relative(ROOT, f), a.area));
  }
  const pdir = join(ROOT, PLUGINS_DIR);
  for (const folder of existsSync(pdir) ? readdirSync(pdir).sort() : []) {
    if (folder.startsWith('_') || folder.startsWith('.') || !existsSync(join(pdir, folder, 'plugin.json'))) continue;
    for (const f of files(join(pdir, folder, 'web'), (n) => /\.(tsx?|mjs)$/.test(n) && !/\.d\.m?ts$|\.test\./.test(n))) entries.push(...scanFile(read(f), relative(ROOT, f), `plugin:${folder}`));
  }
  // server routes and plugin commands: the plugin-commands@1 registry (the same one REST, MCP and the CLI are made from)
  for (const p of pluginRegistry({ apps: ['console-web'] }).plugins) {
    for (const c of p.commands ?? []) {
      const r = c.run?.route;
      const route = typeof r === 'string' ? r : r?.method ? `${r.method} ${r.path ?? ''}` : '';
      if (!route) continue; // actions and data reads are listed from the web sources
      const read = c.kind === 'read' || c.effect === 'read';
      entries.push(e({ kind: 'route', id: `${p.folder}/${c.id}`, label: c.title || c.id, where: `plugin:${p.folder}`, file: `${PLUGINS_DIR}/${p.folder}/server ${route}`, api: `${read ? 'plugins.reads read' : 'plugins.commands run'} ${p.folder}/${c.id}`, status: 'covered' }));
    }
    for (const s of p.skipped ?? []) {
      const why = String(s.why ?? s.skip ?? '');
      const person = /person|tap|brett|signed-in browser/i.test(why);
      entries.push(e({ kind: 'route', id: `${p.folder}/${s.route ?? s.id ?? '?'}`, label: s.route ?? s.id ?? '', where: `plugin:${p.folder}`, file: `${PLUGINS_DIR}/${p.folder}/plugin.json`, api: '', status: person ? 'person-only' : 'skipped', note: why }));
    }
  }
  // one entry per (kind, id, where): a key or an action named in several files is one element
  const seen = new Map();
  for (const x of entries) {
    const at = x.file;
    const file = x.file.replace(/:\d+$/, '');
    const k = x.kind === 'control' ? `${x.kind}|${file}|${x.id}|${x.status}` : `${x.kind}|${x.id}|${x.where}`;
    const had = seen.get(k);
    if (had) { had.count = (had.count ?? 1) + 1; if (x.status === 'gap') had.at.push(at); continue; }
    seen.set(k, { ...x, file, ...(x.status === 'gap' ? { at: [at] } : {}) });
  }
  const items = [...seen.values()].sort((a, b) => a.where.localeCompare(b.where) || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
  return { $axf: FRAME, note: 'Generated by node framework/cli/api-coverage.mjs write. Every UI element of the Dev Console with its API path (control@1 / MCP / CLI). CI: api-coverage.mjs check.', summary: summarize(items), items };
}

export function summarize(items) {
  const by = (f) => items.reduce((m, x) => { const k = f(x); m[k] ??= Object.fromEntries(STATUSES.map((s) => [s, 0])); m[k][x.status]++; return m; }, {});
  const totals = Object.fromEntries(STATUSES.map((s) => [s, items.filter((x) => x.status === s).length]));
  return { elements: items.length, ...totals, byKind: by((x) => x.kind), byArea: by((x) => x.where.startsWith('plugin:') ? x.where : x.where) };
}

/** The registry file's text: the header pretty, then one element per line (small diffs, greppable). */
export function serialize(reg) {
  const { items, ...head } = reg;
  return `${JSON.stringify(head, null, 1).replace(/\n}$/, ',\n "items": [\n')}${items.map((x) => `  ${JSON.stringify(x)}`).join(',\n')}\n ]\n}\n`;
}

/* ================================================================== CLI */

function main(argv) {
  const json = argv.includes('--json');
  const [cmd = 'summary', ...rest] = argv.filter((a) => a !== '--json' && a !== '--strict');
  const reg = build();
  if (cmd === 'write') { writeFileSync(join(ROOT, OUT), serialize(reg)); console.log(`wrote ${OUT}: ${reg.summary.elements} elements, ${reg.summary.gap} gap(s)`); return 0; }
  if (cmd === 'check') {
    const gaps = reg.items.filter((x) => x.status === 'gap');
    let stale = false;
    try { stale = read(join(ROOT, OUT)) !== serialize(reg); } catch { stale = true; }
    const strict = argv.includes('--strict');
    if (json) console.log(JSON.stringify({ ok: !gaps.length && !(strict && stale), gaps, stale }, null, 1));
    else {
      for (const g of gaps) for (const at of g.at ?? [g.file]) console.log(`✗ ${at}  ${g.fix}`);
      if (stale) console.log(`${strict ? '✗' : '!'} ${OUT} is out of date: node framework/cli/api-coverage.mjs write${strict ? '' : ' (a note: the API Browser reads it live)'}`);
      if (!gaps.length) console.log(`✓ api coverage — ${reg.summary.elements} UI elements, every one has an API path (${reg.summary.covered} named, ${reg.summary.generic} on screen, ${reg.summary['person-only']} Brett's own tap, ${reg.summary.skipped} skipped with a reason)`);
    }
    return gaps.length || (strict && stale) ? 1 : 0;
  }
  if (cmd === 'gaps') {
    const gaps = reg.items.filter((x) => x.status === 'gap');
    console.log(json ? JSON.stringify(gaps, null, 1) : gaps.flatMap((g) => (g.at ?? [g.file]).map((at) => `${at}  ${g.fix}`)).join('\n') || 'no gaps');
    return 0;
  }
  if (cmd === 'table') {
    const words = rest.join(' ').toLowerCase().split(/\s+/).filter(Boolean);
    const rows = reg.items.filter((x) => words.every((w) => `${x.kind} ${x.id} ${x.label} ${x.where} ${x.api} ${x.status}`.toLowerCase().includes(w)));
    if (json) { console.log(JSON.stringify(rows, null, 1)); return 0; }
    console.log('| element | kind | where | API path | MCP | status |\n|---|---|---|---|---|---|');
    for (const x of rows) console.log(`| ${x.label || x.id}${x.count > 1 ? ` (×${x.count})` : ''} | ${x.kind} | ${x.where} (${x.file}) | ${x.api ? `\`${x.api}\`` : '—'} | ${apiNames(x).mcp ? `\`${apiNames(x).mcp}\`` : '—'} | ${x.status} |`);
    return 0;
  }
  if (json) { console.log(JSON.stringify(reg.summary, null, 1)); return 0; }
  const s = reg.summary;
  console.log(`${s.elements} UI elements: ${s.covered} covered, ${s.generic} generic (console.elements), ${s['person-only']} person-only, ${s.skipped} skipped, ${s.gap} gap(s)`);
  for (const [k, v] of Object.entries(s.byKind)) console.log(`  ${k.padEnd(15)} ${STATUSES.map((st) => `${st} ${v[st]}`).join(' · ')}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
