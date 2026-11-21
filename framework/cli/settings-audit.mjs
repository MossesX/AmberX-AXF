#!/usr/bin/env node
/**
 * settings-audit.mjs — the inventory behind settings-sources@1 (framework/schemas/settings-sources.json).
 *
 * Lists every console setting it can find, with where it is stored and every screen that names it:
 *   - registry   the Claude settings registry (apps/console-web/plugins/claude-settings/registry.json)
 *   - framework  settings declared for the framework settings registry (`{ key: '…', kind: … }` in web code)
 *   - store      module stores: the keys of a `DEFAULTS` / `SETTING_KEYS` literal in a plugin, CLI, deploy or core module
 * and flags
 *   (a) one key name kept in more than one store, and
 *   (b) different keys whose wording says the same thing (same normalised label).
 * The curated verdicts (which of those are real duplicates and which key is the one source) live in
 * settings-sources.json; `framework/cli/check-settings-sources.mjs` holds CI to them.
 *
 *   node framework/cli/settings-audit.mjs            a summary
 *   node framework/cli/settings-audit.mjs --json     the whole inventory
 *   node framework/cli/settings-audit.mjs --md       markdown tables (the report's inventory section)
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCAN_DIRS = ['apps/console-web/plugins', 'apps/console-web/server', 'apps/console-web/src', 'deploy', 'framework/cli', 'framework/core', 'framework/libs', 'framework/react'];
const SKIP = /(^|\/)(node_modules|dist|addons|fixtures|assets|__pycache__)(\/|$)|(^|\/)src\/axf\/|(^|\/)(test[^/]*|[^/]*\.test|check-[^/]*|[^/]*e2e[^/]*)\.(mjs|mts|ts|tsx|py|sh)$|\/_template\//;
const CODE = /\.(mjs|ts|tsx|py)$/;

export function walk(dir, out = []) {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return out;
  for (const name of readdirSync(abs)) {
    const rel = `${dir}/${name}`;
    if (SKIP.test(rel)) continue;
    const st = statSync(join(ROOT, rel));
    if (st.isDirectory()) walk(rel, out); else if (CODE.test(name)) out.push(rel);
  }
  return out;
}

/** The text of the literal that opens at `open` ({ or [), braces matched, strings skipped. */
function literalAt(src, open) {
  const pair = { '{': '}', '[': ']' };
  const stack = [];
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') { for (i++; i < src.length && src[i] !== c; i++) if (src[i] === '\\') i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2) + 1; if (i <= 0) return ''; continue; }
    if (c === '#' && stack.length && /\n\s*$/.test(src.slice(Math.max(0, i - 80), i))) { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (pair[c]) stack.push(pair[c]);
    else if (c === stack[stack.length - 1]) { stack.pop(); if (!stack.length) return src.slice(open, i + 1); }
  }
  return '';
}

/** Top-level keys of an object literal (or the strings of a list / set literal). */
function topKeys(lit) {
  const keys = []; let depth = 0;
  const isList = lit[0] === '[';
  for (let i = 0; i < lit.length; i++) {
    const c = lit[i];
    if (c === '/' && lit[i + 1] === '/') { while (i < lit.length && lit[i] !== '\n') i++; continue; }
    if (c === '/' && lit[i + 1] === '*') { i = lit.indexOf('*/', i + 2) + 1; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const start = i; for (i++; i < lit.length && lit[i] !== c; i++) if (lit[i] === '\\') i++;
      if (depth === 1) { const s = lit.slice(start + 1, i); const after = /^\s*:/.test(lit.slice(i + 1)); if (isList ? !after : after) keys.push(s); else if (!isList && /^\s*[,}]/.test(lit.slice(i + 1)) && !/:\s*$/.test(lit.slice(0, start))) keys.push(s); }
      continue;
    }
    if (c === '{' || c === '[' || c === '(') depth++;
    else if (c === '}' || c === ']' || c === ')') depth--;
    else if (depth === 1 && !isList && /[A-Za-z_$]/.test(c) && /[\s,{]/.test(lit[i - 1] ?? '{')) {
      const m = /^([A-Za-z_$][\w$]*)\s*:/.exec(lit.slice(i));
      if (m) { keys.push(m[1]); i += m[1].length - 1; } else { const w = /^[\w$]+/.exec(lit.slice(i)); i += (w?.[0].length ?? 1) - 1; }
    }
  }
  return [...new Set(keys)].filter((k) => !k.startsWith('$'));
}

const STORE_DECL = /(?:^|\n)\s*(?:export\s+)?(?:const\s+)?((?:[A-Z][A-Z0-9_]*_)?DEFAULTS|DEFAULT_SETTINGS|SETTING_KEYS|SETTABLE)\s*(?::[^=\n]+)?=\s*(?:Object\.freeze\(\s*)?(?:new Set\(\s*)?([{[])/g;
/** Engine rule tables and look defaults are assets, not settings. */
const NOT_SETTINGS = /framework\/core\/engines\/|framework\/core\/(agents|assistant)\.ts$|status-styles|demonstration-designer|build-rules-migrate|predicted\.py|choices\.py/;

export function scanStores(files) {
  const out = [];
  for (const f of files) {
    if (NOT_SETTINGS.test(f)) continue;
    const src = readFileSync(join(ROOT, f), 'utf8');
    for (const m of src.matchAll(STORE_DECL)) {
      const open = m.index + m[0].length - 1;
      const keys = topKeys(literalAt(src, open));
      if (keys.length) out.push({ file: f, decl: m[1], keys });
    }
  }
  return out;
}

const FRAME_DECL = /\{\s*key:\s*'([A-Za-z0-9_.@-]+)',\s*label:\s*(?:'((?:[^'\\]|\\.)*)'|"([^"]*)")[^}]*?kind:\s*'(toggle|slider|number|choice|text|time|select)'/g;
export function scanFramework(files) {
  const out = [];
  for (const f of files) {
    if (!/\.tsx?$/.test(f)) continue;
    const src = readFileSync(join(ROOT, f), 'utf8');
    for (const m of src.matchAll(FRAME_DECL)) out.push({ key: m[1], label: (m[2] ?? m[3] ?? '').replace(/\\'/g, "'"), kind: m[4], file: f });
  }
  return out;
}

export function registry() {
  const f = 'apps/console-web/plugins/claude-settings/registry.json';
  return JSON.parse(readFileSync(join(ROOT, f), 'utf8')).settings.map((s) => ({ key: s.key, label: s.label, kind: s.kind, default: s.default, file: f, alias: s.alias ?? null, source: s.source ?? null }));
}

const STOP = new Set(['the', 'a', 'an', 'of', 'at', 'to', 'for', 'max', 'maximum', 'my', 'every', 'per', 'in', 'on', 'is', 'it', 'by', 'and', 'or', 'once']);
/** Wording reduced to its content words, sorted: "Max parallel builds" and "Parallel builds (max)" are the same. */
export const wordKey = (label) => [...new Set(String(label).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w && !STOP.has(w)).map((w) => w.replace(/(ing|s)$/, '')))].sort().join(' ');

export function audit() {
  const files = SCAN_DIRS.flatMap((d) => walk(d));
  const stores = scanStores(files);
  const frame = scanFramework(files);
  const reg = registry();
  const web = files.filter((f) => /\.tsx$/.test(f)).map((f) => [f, readFileSync(join(ROOT, f), 'utf8')]);
  /** Screens (tsx files) that name a key. Short names would match anything, so they need a word boundary and 6+ characters. */
  const screensOf = (key) => { const bare = key.split('.').pop(); if (bare.length < 6) return []; const re = new RegExp(`(^|[^A-Za-z0-9_])${key.replace(/[.$]/g, '\\$&')}([^A-Za-z0-9_]|$)`); return web.filter(([, s]) => re.test(s)).map(([f]) => f); };
  const byName = new Map();
  for (const s of stores) for (const k of s.keys) { if (!byName.has(k)) byName.set(k, []); byName.get(k).push(s.file); }
  const sameName = [...byName].map(([key, where]) => ({ key, stores: [...new Set(where.map((w) => (w.startsWith('apps/console-web/plugins/') ? w.split('/').slice(0, 4).join('/') : dirname(w))))] })).filter((x) => x.stores.length > 1);
  const byWords = new Map();
  for (const s of [...reg, ...frame]) { const w = wordKey(s.label); if (!w) continue; if (!byWords.has(w)) byWords.set(w, []); byWords.get(w).push({ key: s.key, label: s.label, file: s.file }); }
  const sameWords = [...byWords].map(([words, items]) => ({ words, items })).filter((x) => new Set(x.items.map((i) => i.key)).size > 1);
  return { $axf: 'settings-audit@1', counts: { registry: reg.length, framework: frame.length, stores: stores.length, storeKeys: stores.reduce((n, s) => n + s.keys.length, 0) }, registry: reg.map((s) => ({ ...s, screens: screensOf(s.key) })), framework: frame, stores: stores.map((s) => ({ ...s, screens: [...new Set(s.keys.flatMap((k) => screensOf(k)))] })), sameName, sameWords };
}

function md(a) {
  const rel = (f) => relative('.', f) || f;
  const L = [];
  L.push('| Key | Label | Default | Screens that name it |', '|---|---|---|---|');
  for (const s of a.registry) L.push(`| \`${s.key}\`${s.alias ? ` → \`${s.alias}\`` : ''} | ${s.label} | ${JSON.stringify(s.default)} | Settings → Claude${s.screens.filter((f) => !f.includes('claude-settings')).map((f) => `, \`${rel(f)}\``).join('')} |`);
  L.push('', '| Key | Label | Kind | Declared in |', '|---|---|---|---|');
  for (const s of a.framework) L.push(`| \`${s.key}\` | ${s.label} | ${s.kind} | \`${s.file}\` |`);
  L.push('', '| Store (module) | Keys | Screens that name a key |', '|---|---|---|');
  for (const s of a.stores) L.push(`| \`${s.file}\` \`${s.decl}\` | ${s.keys.map((k) => `\`${k}\``).join(' ')} | ${s.screens.map((f) => `\`${f.replace('apps/console-web/', '')}\``).join(' ') || '—'} |`);
  L.push('', '| Same key name in more than one store | Stores |', '|---|---|');
  for (const s of a.sameName) L.push(`| \`${s.key}\` | ${s.stores.map((x) => `\`${x}\``).join(' ')} |`);
  L.push('', '| Same wording, different keys | Keys |', '|---|---|');
  for (const s of a.sameWords) L.push(`| ${s.items[0].label} | ${s.items.map((i) => `\`${i.key}\` (${i.file.split('/').slice(-2).join('/')})`).join(' · ')} |`);
  return L.join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const a = audit();
  if (process.argv.includes('--json')) console.log(JSON.stringify(a, null, 1));
  else if (process.argv.includes('--md')) console.log(md(a));
  else {
    console.log(`settings audit: ${a.counts.registry} Claude settings · ${a.counts.framework} framework settings · ${a.counts.storeKeys} keys in ${a.counts.stores} module stores`);
    console.log(`  same key name in more than one store: ${a.sameName.length}`);
    for (const s of a.sameName) console.log(`    ${s.key}: ${s.stores.join(' · ')}`);
    console.log(`  same wording under different keys: ${a.sameWords.length}`);
    for (const s of a.sameWords) console.log(`    "${s.items[0].label}": ${s.items.map((i) => i.key).join(' · ')}`);
  }
}
