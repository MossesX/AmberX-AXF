#!/usr/bin/env node
/**
 * Help coverage (Help mode, Brett Nov 1 2026): lists every control in the framework chrome, the Dev Console (its own
 * screens + every plugin) and axHub web, finds the help@1 entry each one would show, and keeps the number from falling.
 *
 *   node framework/cli/help-coverage.mjs                    summary per scope (framework, console-web, axhub-web)
 *   node framework/cli/help-coverage.mjs --missing <scope>  the controls of a scope still showing "No help yet"
 *   node framework/cli/help-coverage.mjs --check            CI: fail when a scope's coverage fell below the ratchet
 *   node framework/cli/help-coverage.mjs --update           raise the ratchet to today's numbers (never lowers it)
 *   node framework/cli/help-coverage.mjs --draft <scope>    write draft entries (draft: true) for every missing control
 *   node framework/cli/help-coverage.mjs --report <file.md> write the coverage report
 *   node framework/cli/help-coverage.mjs --json             the whole result as JSON
 *   node framework/cli/help-coverage.mjs --sync             copy framework/assets/help into every app's src/assets/help
 *
 * A control is found statically: framework controls with a literal label (Button text, IconButton / Switch / Checkbox /
 * TextField / SelectField / Slider label, Segmented options, raw <button> / <a>), menu / toolbar / nav items in the app's
 * assets and in code (`{ label, action }`), settings specs, settings tabs, views, grid columns and plugin banners. Ids are
 * the same ones the React Help layer derives at run time (core/engines/help-rules.mjs `helpTarget`). Controls whose
 * label is only known at run time are not counted here; the Help layer still shows "No help yet" for them and
 * `rt.missingHelp()` lists them.
 * Help comes from framework/assets/help/*.json, apps/<app>/src/assets/help/*.json and plugins/<folder>/help.json.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildHelpIndex, helpCoverage, helpErrors, helpTarget, ratchetErrors, resolveHelp, slugLabel } from '../core/engines/help-rules.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const RATCHET = join(ROOT, 'framework/spec/help-coverage.json');

/** The scopes counted, each with its sources and where its help lives. */
export const SCOPES = {
  framework: {
    label: 'Framework chrome (every app)',
    code: ['framework/react', 'framework/libs/settings', 'framework/libs/approvals', 'framework/libs/alerts', 'framework/libs/datagrid'],
    assets: [],
    help: ['framework/assets/help'],
    plugins: null,
  },
  'console-web': {
    label: 'Dev Console + plugins',
    code: ['apps/console-web/src'],
    assets: ['apps/console-web/src/assets'],
    help: ['apps/console-web/src/assets/help'],
    plugins: 'apps/console-web/plugins',
  },
  'axhub-web': {
    label: 'axHub web',
    code: ['apps/axhub-web/src'],
    assets: ['apps/axhub-web/src/assets'],
    help: ['apps/axhub-web/src/assets/help'],
    plugins: 'apps/axhub-web/src/plugins',
  },
};

const SKIP_DIR = new Set(['node_modules', 'axf', 'dist', 'assets', '_template', 'server', '__pycache__']);
/** The Help layer's own UI is never tagged (data-axf-help-ui), so it isn't a control to explain. */
const SKIP_FILE = /framework\/react\/components\/Help\.tsx$/;

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) { if (!SKIP_DIR.has(name) && !name.startsWith('_') && !name.startsWith('.')) walk(p, out); }
    else if (SKIP_FILE.test(p.replace(/\\/g, '/'))) continue;
    else if (/\.(tsx|ts)$/.test(name) && !/\.d\.ts$/.test(name) && !/(test|spec|check)[^/]*\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

/* ---------------- a small JSX reader (literal labels only) ---------------- */

/** From `i` (just after `<Tag`), the attribute text up to the closing `>` at depth 0, and whether it self-closes. */
function readTag(src, i) {
  let depth = 0;
  let q = null;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (q) { if (c === '\\') { j++; continue; } if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth === 0) return { attrs: src.slice(i, j), end: j + 1, self: src[j - 1] === '/' };
  }
  return null;
}

/** A literal attribute value: name="x", name='x', name={'x'} or name={"x"}. */
function attr(attrs, name) {
  const m = new RegExp(`(?:^|\\s)${name}=(?:"([^"]*)"|'([^']*)'|\\{\\s*'([^'{}]*)'\\s*\\}|\\{\\s*"([^"{}]*)"\\s*\\})`).exec(attrs);
  return m ? (m[1] ?? m[2] ?? m[3] ?? m[4]) : undefined;
}

/** Children text with expressions and tags taken out (null when it is only dynamic). */
function childrenText(src, from, tag) {
  const close = src.indexOf(`</${tag}>`, from);
  if (close < 0 || close - from > 2000) return null;
  let body = src.slice(from, close);
  // {'x'} / {"x"} are literal text
  body = body.replace(/\{\s*'([^'{}]*)'\s*\}|\{\s*"([^"{}]*)"\s*\}/g, (_m, a, b) => a ?? b);
  let out = '';
  let depth = 0;
  for (const c of body) { if (c === '{') depth++; else if (c === '}') depth--; else if (depth === 0) out += c; }
  out = out.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  return out || null;
}

const lineOf = (src, i) => src.slice(0, i).split('\n').length;
const sane = (label) => typeof label === 'string' && label.length >= 2 && label.length <= 60 && /[a-z]/i.test(label) && !/^[A-Z0-9_]+$/.test(label.trim()) && slugLabel(label);

/** The controls one source file draws, found statically. */
export function controlsInSource(src, file) {
  const out = [];
  const add = (desc, kind, at) => {
    const t = helpTarget(desc);
    if (!t.id) return;
    out.push({ id: t.id, lookup: t.lookup, kind, label: desc.label ?? desc.view ?? desc.action ?? '', file, line: lineOf(src, at) });
  };
  const tags = /<(Button|IconButton|Switch|Checkbox|TextField|SelectField|ColorField|Slider|Segmented|button|a)\b/g;
  let m;
  while ((m = tags.exec(src))) {
    const tag = m[1];
    const t = readTag(src, m.index + m[0].length);
    if (!t) continue;
    const at = m.index;
    const help = attr(t.attrs, 'data-help');
    const action = attr(t.attrs, 'data-axf-action');
    if (tag === 'Segmented') {
      const opts = /options=\{\s*\[([\s\S]*?)\]\s*\}/.exec(t.attrs);
      if (opts) for (const o of opts[1].matchAll(/label:\s*'([^']+)'/g)) if (sane(o[1])) add({ label: o[1] }, 'tab', at);
      continue;
    }
    let label;
    if (['IconButton', 'Switch', 'Checkbox', 'TextField', 'SelectField', 'ColorField', 'Slider'].includes(tag)) label = attr(t.attrs, 'label');
    else label = attr(t.attrs, 'aria-label') ?? (t.self ? undefined : childrenText(src, t.end, tag)) ?? attr(t.attrs, 'title');
    if (tag === 'a' && !/\shref=/.test(t.attrs)) continue;
    if (!help && !action && !sane(label)) continue;
    const kind = { Switch: 'toggle', Checkbox: 'toggle', TextField: 'field', SelectField: 'field', ColorField: 'field', Slider: 'slider', a: 'link' }[tag] ?? 'button';
    add({ help, action, label: sane(label) ? label : undefined }, kind, at);
  }
  // object-literal controls: menu items / toolbar items ({ label, action }), settings specs ({ key, label, kind }), nav ({ label, view })
  for (const o of src.matchAll(/\{[^{}]*\}/g)) {
    const body = o[0];
    const label = /\blabel:\s*'([^'\\]+)'|\blabel:\s*"([^"\\]+)"/.exec(body);
    const text = label ? (label[1] ?? label[2]) : undefined;
    if (!text || !sane(text)) continue;
    const action = /\baction:\s*'([^'$`]+)'/.exec(body)?.[1];
    const view = /\bview:\s*'([a-z0-9][a-z0-9._-]*)'/.exec(body)?.[1];
    if (action) add({ action, label: text }, 'menu-item', o.index);
    else if (view && /\bicon:/.test(body)) add({ view, label: text }, 'nav', o.index);
    else if (/\bkey:\s*['A-Z`]/.test(body) && /\bkind:\s*'(toggle|text|number|slider|choice|multi_choice|color|asset_slot|action|link|secret)'/.test(body)) add({ label: text }, 'field', o.index);
    else if (/\bid:\s*'/.test(body) && /\b(width|sortable|sort|get|cell|align|minWidth):/.test(body) && !/\bicon:/.test(body)) add({ label: text, column: true }, 'column', o.index);
  }
  // settings tabs and sub-tabs (their labels are tab buttons)
  for (const r of src.matchAll(/settingsTabs:\s*\[([\s\S]*?)\]/g)) for (const l of r[1].matchAll(/label:\s*'([^']+)'/g)) if (sane(l[1])) add({ label: l[1] }, 'tab', r.index);
  // views (screens): `id: { title: '…'` inside a views map
  for (const r of src.matchAll(/views\s*(?::\s*ViewMap\s*)?[:=]\s*\{/g)) {
    const slice = src.slice(r.index, r.index + 6000);
    for (const v of slice.matchAll(/(?:^|[\s,{])['"]?([a-z0-9][a-z0-9._-]*)['"]?\s*:\s*\{\s*title:\s*'([^']+)'/g)) add({ view: v[1], label: v[2] }, 'screen', r.index);
    for (const v of slice.matchAll(/\[\s*([A-Z_]+)\s*\]\s*:\s*\{\s*title:\s*'([^']+)'/g)) {
      const k = new RegExp(`const ${v[1]}\\s*=\\s*'([a-z0-9._-]+)'`).exec(src)?.[1];
      if (k) add({ view: k, label: v[2] }, 'screen', r.index);
    }
  }
  // plugin banners
  for (const r of src.matchAll(/banners:\s*\[\s*\{\s*id:\s*'([^']+)'/g)) add({ banner: r[1] }, 'banner', r.index);
  return out;
}

/** Controls in the app's chrome assets: app-menu, context-menu, toolbar and nav-menu items. */
export function controlsInAssets(dir) {
  const out = [];
  const add = (desc, kind, file) => { const t = helpTarget(desc); if (t.id) out.push({ id: t.id, lookup: t.lookup, kind, label: desc.label ?? '', file }); };
  const items = (list, file) => {
    for (const i of list ?? []) {
      if (!i || i.separator) continue;
      if (i.action || i.label) add({ action: i.action, label: i.label }, 'menu-item', file);
      if (i.items) items(i.items, file);
    }
  };
  for (const type of ['app-menu', 'context-menu', 'toolbar', 'nav-menu']) {
    const d = join(dir, type);
    if (!existsSync(d)) continue;
    for (const f of readdirSync(d).filter((n) => n.endsWith('.json'))) {
      const file = relative(ROOT, join(d, f));
      const a = readJson(join(d, f));
      if (type === 'app-menu') for (const menu of a.data?.menus ?? []) { add({ menu: menu.id, label: menu.label }, 'menu', file); items(menu.items, file); }
      if (type === 'context-menu') for (const list of Object.values(a.data?.targets ?? {})) items(list, file);
      if (type === 'toolbar') for (const g of a.data?.groups ?? []) items(g.items, file);
      if (type === 'nav-menu') for (const s of a.data?.sections ?? []) for (const it of s.items ?? []) add({ view: it.view, label: it.label }, 'nav', file);
    }
  }
  return out;
}

/** Apps that ship the framework's help pack in src/assets/help (Patches is paused; demo keeps its old baked framework). */
export const HELP_APPS = ['console-web', 'axhub-web', 'amberx-droid', 'walkthrough-studio'];
const FRAMEWORK_HELP = 'framework/assets/help';

/** Copy the framework's help packs into every app's assets (what `--sync` does), or list the stale copies. */
export function syncFrameworkHelp(write) {
  const stale = [];
  for (const f of readdirSync(join(ROOT, FRAMEWORK_HELP)).filter((n) => n.endsWith('.json'))) {
    const want = readFileSync(join(ROOT, FRAMEWORK_HELP, f), 'utf8');
    for (const app of HELP_APPS) {
      const dest = join(ROOT, 'apps', app, 'src/assets/help', f);
      const have = existsSync(dest) ? readFileSync(dest, 'utf8') : null;
      if (have === want) continue;
      stale.push(relative(ROOT, dest));
      if (write) { mkdirSync(dirname(dest), { recursive: true }); writeFileSync(dest, want); }
    }
  }
  return stale;
}

/** Every help pack a scope loads, as { id, data, file, plugin? }, with validation errors. */
export function helpPacks(scope) {
  const s = SCOPES[scope];
  const packs = [];
  const errors = [];
  const load = (path, plugin) => {
    try {
      const raw = readJson(path);
      const rel = relative(ROOT, path);
      if (raw.$axf !== 'asset@1' || raw.type !== 'help') { errors.push(`${rel}: not a help@1 asset ($axf asset@1, type help)`); return; }
      for (const e of helpErrors('help', raw.data)) errors.push(`${rel}: ${e}`);
      packs.push({ id: raw.id, data: raw.data, file: rel, plugin });
    } catch (e) { errors.push(`${relative(ROOT, path)}: ${e.message}`); }
  };
  for (const d of s.help) if (existsSync(join(ROOT, d))) for (const f of readdirSync(join(ROOT, d)).filter((n) => n.endsWith('.json')).sort()) load(join(ROOT, d, f));
  if (s.plugins && existsSync(join(ROOT, s.plugins))) {
    for (const folder of readdirSync(join(ROOT, s.plugins)).filter((n) => !n.startsWith('_')).sort()) {
      const pj = join(ROOT, s.plugins, folder, 'plugin.json');
      let file = 'help.json';
      if (existsSync(pj)) { try { file = readJson(pj).help || 'help.json'; } catch { /* the plugin checks report it */ } }
      const p = join(ROOT, s.plugins, folder, file);
      if (existsSync(p)) load(p, folder);
    }
  }
  return { packs, errors };
}

/** Every control of a scope (deduped by id later), each with the plugin it belongs to when it has one. */
export function scopeControls(scope) {
  const s = SCOPES[scope];
  const out = [];
  for (const d of s.code) for (const f of walk(join(ROOT, d))) out.push(...controlsInSource(readFileSync(f, 'utf8'), relative(ROOT, f)));
  for (const d of s.assets) out.push(...controlsInAssets(join(ROOT, d)));
  if (s.plugins && existsSync(join(ROOT, s.plugins))) {
    for (const folder of readdirSync(join(ROOT, s.plugins)).filter((n) => !n.startsWith('_'))) {
      const web = join(ROOT, s.plugins, folder, 'web');
      for (const f of walk(web)) out.push(...controlsInSource(readFileSync(f, 'utf8'), relative(ROOT, f)).map((c) => ({ ...c, plugin: folder })));
    }
  }
  // the framework's own chrome is counted once, under `framework`, not again in each app
  if (scope !== 'framework') {
    const fw = new Set(scopeControlsCached('framework').map((c) => c.id));
    // starter nav menus / app menus name views other apps have: a link to a view this app doesn't have is never drawn
    const views = new Set([...out, ...scopeControlsCached('framework')].filter((c) => c.kind === 'screen').map((c) => c.id));
    return out.filter((c) => !fw.has(c.id) && !(c.id.startsWith('view:') && c.kind !== 'screen' && !views.has(c.id)));
  }
  return out;
}

const cache = new Map();
function scopeControlsCached(scope) {
  if (!cache.has(scope)) cache.set(scope, scopeControls(scope));
  return cache.get(scope);
}

/** Coverage of one scope. */
export function measure(scope) {
  const controls = scopeControlsCached(scope);
  const { packs, errors } = helpPacks(scope);
  const index = buildHelpIndex(packs);
  const cov = helpCoverage(controls, index);
  return { scope, label: SCOPES[scope].label, ...cov, packs: packs.length, entries: index.byTarget.size, intros: index.intros.size, errors, controls, index, packList: packs };
}

/* ---------------- drafts: plain sentences from what the code says ---------------- */

const VERBS = {
  refresh: 'Reloads this from the server, so you see what is true right now.',
  reload: 'Reloads this from the server, so you see what is true right now.',
  save: 'Saves your changes. Nothing is kept until you tap it.',
  cancel: 'Backs out without changing anything.',
  close: 'Closes this. Nothing is lost.',
  delete: 'Deletes it. Depending on your behaviour theme it asks first.',
  remove: 'Takes it off the list.',
  add: 'Adds a new one.',
  new: 'Starts a new one.',
  open: 'Opens it.',
  copy: 'Copies it to the clipboard, ready to paste.',
  export: 'Saves a copy to a file you can keep or share.',
  import: 'Brings one in from a file.',
  apply: 'Puts the change into effect now.',
  reset: 'Puts it back the way it was by default.',
  restore: 'Brings back an earlier version.',
  run: 'Starts it now.',
  start: 'Starts it now.',
  stop: 'Stops it.',
  retry: 'Tries the same thing again.',
  edit: 'Lets you change it.',
  rename: 'Gives it a new name.',
  approve: 'Says yes: the waiting call runs now instead of after the countdown.',
  deny: 'Says no: the waiting call is dropped and never runs.',
  show: 'Shows it.',
  hide: 'Hides it from view (it is still there; you can show it again).',
  send: 'Sends it.',
  upload: 'Uploads a file from this device.',
  download: 'Downloads a copy to this device.',
  search: 'Finds things by what you type.',
  filter: 'Narrows the list to what matches.',
  sort: 'Changes the order of the list.',
  select: 'Picks it (or several) so the next action works on them.',
  install: 'Installs it.',
  uninstall: 'Removes it completely.',
  enable: 'Turns it on.',
  disable: 'Turns it off.',
  test: 'Runs a quick check to see if it works.',
  back: 'Goes back one step.',
  next: 'Goes to the next step.',
  done: 'Finishes and closes this.',
  merge: 'Joins them into one.',
  move: 'Moves it somewhere else.',
  split: 'Breaks it into smaller pieces.',
  park: 'Puts it aside for later without building it.',
  build: 'Starts building it.',
  push: 'Sends the work to GitHub.',
  pull: 'Brings in the latest from GitHub.',
  watch: 'Shows it live while it changes.',
  more: 'Shows more options.',
  expand: 'Opens it up to show the details.',
  collapse: 'Folds it back up.',
};

function sentenceCase(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

/** Imperative → what it does ("open" → "Opens"), for labels that start with a verb. */
const CONJ = {
  go: 'Goes', do: 'Does', fix: 'Fixes', push: 'Pushes', pass: 'Passes', match: 'Matches', finish: 'Finishes', refresh: 'Refreshes', search: 'Searches',
  watch: 'Watches', switch: 'Switches', attach: 'Attaches', detach: 'Detaches', publish: 'Publishes', dismiss: 'Dismisses', copy: 'Copies', apply: 'Applies',
  try: 'Tries', retry: 'Retries', empty: 'Empties', reply: 'Replies', show: 'Shows', unhide: 'Unhides', hide: 'Hides', ask: 'Asks',
};
const IMPERATIVE = new Set(['open', 'close', 'save', 'add', 'remove', 'delete', 'copy', 'export', 'import', 'apply', 'reset', 'restore', 'run', 'start', 'stop', 'retry',
  'edit', 'rename', 'approve', 'deny', 'reject', 'show', 'hide', 'send', 'upload', 'download', 'install', 'uninstall', 'enable', 'disable', 'test', 'merge', 'move', 'split',
  'park', 'build', 'push', 'pull', 'watch', 'expand', 'collapse', 'check', 'clear', 'create', 'make', 'pick', 'choose', 'turn', 'use', 'load', 'reload', 'refresh', 'fix',
  'mark', 'record', 'play', 'pause', 'resume', 'replay', 'skip', 'switch', 'set', 'get', 'take', 'bring', 'hand', 'ask', 'tell', 'write', 'read', 'view', 'go', 'jump',
  'search', 'find', 'filter', 'sort', 'group', 'select', 'duplicate', 'attach', 'detach', 'publish', 'share', 'connect', 'disconnect', 'sign', 'log', 'link', 'unlink',
  'keep', 'drop', 'discard', 'archive', 'pin', 'unpin', 'lock', 'unlock', 'list', 'scan', 'sync', 'generate', 'draft', 'plan', 'schedule', 'queue', 'cancel', 'finish',
  'dismiss', 'snooze', 'ring', 'call', 'transcribe', 'speak', 'say', 'listen', 'zoom', 'fit', 'tidy', 'clean', 'wipe', 'empty', 'repair', 'rebuild', 'redo', 'undo',
  'paste', 'cut', 'print', 'preview', 'compare', 'review', 'submit', 'rehire', 'hire', 'fire', 'suspend', 'assign', 'divide', 'harvest', 'split', 'try', 'reply',
  'unhide', 'reorder', 'raise', 'lower', 'top', 'cycle', 'roll', 'randomize', 'dock', 'undock', 'minimize', 'maximize', 'detect', 'verify', 'probe', 'ping', 'swap']);
const conj = (v) => CONJ[v] ?? (/(s|x|z|ch|sh)$/.test(v) ? `${sentenceCase(v)}es` : /[^aeiou]y$/.test(v) ? `${sentenceCase(v.slice(0, -1))}ies` : `${sentenceCase(v)}s`);
/** What follows the verb sentence, so a tap holds no surprise. */
const AFTER = {
  save: 'Nothing is kept until you tap it.', delete: 'Depending on your behaviour theme it asks first.', remove: 'Depending on your behaviour theme it asks first.',
  discard: 'The saved version stays.', approve: 'It runs straight away.', deny: 'It never runs.', reject: 'It goes back with your comment.', reset: 'Your own changes go.',
  restore: 'What is there now is kept in the history.', copy: 'Paste it wherever you need it.', export: 'Keep it or share it.', uninstall: 'Code and data both go.',
  push: 'Through a pull request, never straight onto main.', merge: 'Only through its pull request, once CI is green.', hand: 'Claude picks it up from there.',
};

/** A draft entry for a control the code shows (plain, short; draft: true until a person edits it). */
export function draftEntry(c, ctx = {}) {
  const label = String(c.label || c.id).replace(/[…]+$/g, '').replace(/\s*\?$/, '').trim();
  const words = slugLabel(label).split('-');
  const verb = words[0];
  const rest = label.slice(label.toLowerCase().indexOf(verb) + verb.length).trim();
  const part = ctx.pluginName ? ` Part of ${ctx.pluginName}.` : '';
  let text;
  if (c.kind === 'screen' || c.kind === 'nav' || c.id.startsWith('view:')) text = `Opens the ${label} screen.${ctx.pluginLine ? ` ${ctx.pluginLine}` : ''}`;
  else if (c.kind === 'toggle') text = `Turns “${label}” on or off. It takes effect straight away and is remembered.${part}`;
  else if (c.kind === 'field') text = `Where you set “${label}”. Change it and the app uses the new value.${part}`;
  else if (c.kind === 'slider') text = `Slide to set “${label}”: left is less, right is more.${part}`;
  else if (c.kind === 'column') text = `The “${label}” column. Tap its header to sort the list by it.`;
  else if (c.kind === 'tab') text = `Shows the “${label}” part of this screen.${part}`;
  else if (c.kind === 'banner') text = `A banner${ctx.pluginName ? ` from ${ctx.pluginName}` : ''}: a strip at the top that keeps you posted. Right-click or long-press it for its settings.`;
  else if (c.kind === 'menu') text = `The ${label} menu. Tap it to see what's inside.`;
  else if (c.kind === 'link') text = `Opens ${label}.`;
  else if (/^(next|previous)\s/i.test(label)) text = `Goes to the ${label.toLowerCase()}.${part}`;
  else if (/^new\s/i.test(label)) text = `Starts a ${label.toLowerCase()}.${part}`;
  else if (/\b(settings|menu|list|page|log|details|results|history)$/i.test(label) && !IMPERATIVE.has(verb)) text = `Opens the ${label.charAt(0).toLowerCase()}${label.slice(1)}.${part}`;
  else if (IMPERATIVE.has(verb) && rest && new RegExp(`^${verb}\\s`, 'i').test(label)) text = `${conj(verb)} ${rest.charAt(0).toLowerCase()}${rest.slice(1)}.${AFTER[verb] ? ` ${AFTER[verb]}` : ''}${part}`;
  else if (VERBS[verb] && !rest) text = `${VERBS[verb]}${part}`;
  else text = `Shows “${label}”.${part}`;
  return { target: c.id, title: label.slice(0, 80) || c.id, text: text.replace(/\.\./g, '.').slice(0, 600), kind: c.kind === 'screen' || !c.kind ? 'screen' : c.kind, draft: true };
}

function pluginInfo(scope, folder) {
  const dir = SCOPES[scope].plugins;
  try {
    const m = readJson(join(ROOT, dir, folder, 'plugin.json'));
    const line = String(m.description ?? '').split(/(?<=[.!?])\s/)[0]?.slice(0, 220) ?? '';
    return { pluginName: m.name, pluginLine: line };
  } catch { return {}; }
}

function packFile(path, id, name, scopeLabel) {
  if (existsSync(path)) return readJson(path);
  return { $axf: 'asset@1', type: 'help', id, name, version: '0.1.0', description: `Help mode entries for ${scopeLabel}. Drafts (draft: true) were written from the code by framework/cli/help-coverage.mjs --draft; edit them into plain English and drop the draft flag.`, author: 'AmberX AXF', tags: ['help'], data: { scope: scopeLabel, entries: [], intros: [] } };
}

/** Write drafts for every missing control of a scope: plugin controls into that plugin's help.json, the rest into the app's drafts pack. */
export function writeDrafts(scope) {
  const r = measure(scope);
  const s = SCOPES[scope];
  const byFile = new Map();
  const seen = new Set();
  for (const c of r.missing) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    const owner = r.controls.find((x) => x.id === c.id && x.plugin)?.plugin;
    let path;
    let meta;
    if (owner) { path = join(ROOT, s.plugins, owner, 'help.json'); meta = { id: `${owner}-help`, name: `${owner} help`, label: `plugin:${owner}` }; }
    else if (scope === 'framework') { path = join(ROOT, 'framework/assets/help/framework-drafts.json'); meta = { id: 'framework-drafts', name: 'Framework help (drafts)', label: 'framework' }; }
    else { path = join(ROOT, s.help[s.help.length - 1], `${scope}-drafts.json`); meta = { id: `${scope}-drafts`, name: `${scope} help (drafts)`, label: scope }; }
    if (!byFile.has(path)) byFile.set(path, { pack: packFile(path, meta.id, meta.name, meta.label), owner });
    const f = byFile.get(path);
    if (f.pack.data.entries.some((e) => e.target === c.id)) continue;
    f.pack.data.entries.push(draftEntry(c, owner ? pluginInfo(scope, owner) : {}));
  }
  for (const [path, f] of byFile) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(f.pack, null, 2)}\n`);
  }
  return { files: [...byFile.keys()].map((p) => relative(ROOT, p)), drafted: seen.size };
}

/* ---------------- report ---------------- */

function numbers(r) { return { total: r.total, covered: r.covered, written: r.written, drafts: r.drafts, percent: r.percent }; }

export function reportMarkdown(results) {
  const lines = ['# Help coverage', '', `Generated by \`node framework/cli/help-coverage.mjs --report\` on ${new Date().toISOString().slice(0, 10)}. Ratchet: \`framework/spec/help-coverage.json\` (CI fails if a scope drops below it).`, '', '| Scope | Controls | With help | Written | Drafts | Coverage | Packs | Screen intros |', '|---|---:|---:|---:|---:|---:|---:|---:|'];
  for (const r of results) lines.push(`| ${r.label} (\`${r.scope}\`) | ${r.total} | ${r.covered} | ${r.written} | ${r.drafts} | ${r.percent}% | ${r.packs} | ${r.intros} |`);
  for (const r of results) {
    if (!r.missing.length) continue;
    lines.push('', `## Still "No help yet" — ${r.label} (${r.missing.length})`, '');
    for (const c of r.missing.slice(0, 200)) lines.push(`- \`${c.id}\` — ${c.kind ?? 'control'} “${c.label}” (${c.file}${c.line ? `:${c.line}` : ''})`);
    if (r.missing.length > 200) lines.push(`- … and ${r.missing.length - 200} more (\`--missing ${r.scope}\`)`);
  }
  return `${lines.join('\n')}\n`;
}

/* ---------------- CLI ---------------- */

function main(argv) {
  const has = (f) => argv.includes(f);
  const arg = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
  if (has('--draft')) {
    const scope = arg('--draft');
    if (!SCOPES[scope]) { console.error(`unknown scope "${scope}" (${Object.keys(SCOPES).join(', ')})`); return 2; }
    const w = writeDrafts(scope);
    console.log(`drafted ${w.drafted} entries into ${w.files.length} file(s)`);
    for (const f of w.files) console.log(`  ${f}`);
    return 0;
  }
  if (has('--sync')) { const done = syncFrameworkHelp(true); console.log(done.length ? `copied the framework help into ${done.length} app file(s)` : 'every app has the current framework help'); }
  const results = Object.keys(SCOPES).map(measure);
  const staleCopies = syncFrameworkHelp(false);
  for (const r of results) if (r.scope === 'framework') r.errors.push(...staleCopies.map((f) => `${f} is not the same as ${FRAMEWORK_HELP}: run node framework/cli/help-coverage.mjs --sync`));
  if (has('--json')) { console.log(JSON.stringify(results.map(({ index, controls, packList, ...r }) => r), null, 2)); return 0; }
  if (has('--missing')) {
    const r = results.find((x) => x.scope === arg('--missing'));
    if (!r) { console.error('unknown scope'); return 2; }
    for (const c of r.missing) console.log(`${c.id}\t${c.kind}\t${c.label}\t${c.file}${c.line ? `:${c.line}` : ''}`);
    return 0;
  }
  for (const r of results) console.log(`${r.scope.padEnd(12)} ${String(r.covered).padStart(4)}/${String(r.total).padEnd(4)} ${String(r.percent).padStart(5)}%  written ${r.written}, drafts ${r.drafts}, packs ${r.packs}, intros ${r.intros}`);
  const errs = results.flatMap((r) => r.errors.map((e) => `${r.scope}: ${e}`));
  for (const e of [...new Set(errs)]) console.error(`✗ ${e}`);
  if (has('--report')) { const p = join(ROOT, arg('--report')); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, reportMarkdown(results)); console.log(`report → ${relative(ROOT, p)}`); }
  const now = Object.fromEntries(results.map((r) => [r.scope, numbers(r)]));
  const base = existsSync(RATCHET) ? readJson(RATCHET) : { scopes: {} };
  if (has('--update')) {
    const next = { ...base, $doc: 'Help coverage ratchet (framework/cli/help-coverage.mjs --check fails when a scope falls below these; --update raises them, never lowers).', scopes: {} };
    for (const [k, v] of Object.entries(now)) {
      const b = base.scopes?.[k];
      next.scopes[k] = b ? { ...v, percent: Math.max(v.percent, b.percent), covered: Math.max(v.covered, b.covered), written: Math.max(v.written, b.written ?? 0) } : v;
    }
    writeFileSync(RATCHET, `${JSON.stringify(next, null, 2)}\n`);
    console.log(`ratchet → ${relative(ROOT, RATCHET)}`);
  }
  if (has('--check')) {
    const problems = [...new Set(errs), ...ratchetErrors(now, base.scopes ?? {})];
    if (problems.length) { for (const p of problems) console.error(`✗ ${p}`); return 1; }
    console.log('✓ help coverage at or above the ratchet');
  }
  return errs.length && has('--check') ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(main(process.argv.slice(2)));

export { resolveHelp };
