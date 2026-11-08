#!/usr/bin/env node
/**
 * ui-api@1 parity check: every UI is fully API-controllable (build ui-api-parity-rule, Nov 8 2026, Brett: "anything
 * with a UI must have API functions that can do everything the UI can (open, read state, every action, every setting).
 * Voice control is the app's main selling point and rides on this.").
 *
 * api-coverage@1 (api-coverage.mjs) proves every control has *some* API path; most are `generic` (console.elements: press
 * it by its label while it is on screen). Parity asks more: a named op. For every console plugin (and the console's and
 * framework's own UI) this lists each view and dialog with
 *
 *   open      its deep link (deep-link@1: ?axf-view= / axf-dialog=) — every declared view and dialog has one
 *   state     what reads what is on screen: refs in the plugin.json `ui` map (a read command, the console.values keys)
 *   actions   every control in its files → a named op (a plugin command, a console action, a setting key), or `uiOnly`
 *             with the reason (a scroll, a filter the read command already takes …)
 *   settings  every declared setting is a console.values key (counted, never a gap)
 *
 * The map lives in each plugin's plugin.json:
 *
 *   "ui": { "$axf": "ui-api@1", "views": { "<view or dialog id>": {
 *     "files": ["web/designer.tsx"],                      the sources whose controls belong to it (plugin-relative)
 *     "state": ["demos", "value:glossary.designer.open"],  refs that read it
 *     "actions": { "<control label>": "<ref>" | ["<ref>", …] },
 *     "uiOnly": { "<control label>": "<why the API needs no op>" } } } }
 *
 *   refs: <command id> (this plugin's plugin-commands@1 id) · <folder>/<command id> · action:<console action id> ·
 *         value:<setting key> · view:<id> · dialog:<id> · settings:<tab id>
 *
 * Gaps: a control no map names (one per label and file), a view or dialog without a state ref. A ref that names nothing
 * (no such command, action) is an error. CI (`check`) fails on errors, on a UI area whose gaps grow past
 * framework/spec/ui-parity-baseline.json (the ratchet; it only comes down), on a new area with any gap, and on a mapped
 * view that isn't full.
 *
 *   node framework/cli/ui-parity.mjs                    summary per plugin (views, mapped, gaps vs baseline)
 *   node framework/cli/ui-parity.mjs gaps [folder]      every gap: file, label, what to add
 *   node framework/cli/ui-parity.mjs show <folder>      one plugin's views with open / state / actions / settings
 *   node framework/cli/ui-parity.mjs check              CI
 *   node framework/cli/ui-parity.mjs write-baseline     after a real reduction (never to hide a new gap)
 *   --json on any of them
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanActions, scanFile } from './api-coverage.mjs';
import { registry as pluginRegistry } from './plugin-commands.mjs';
import { deepLink } from '../core/engines/deep-link.mjs';

export const ROOT = resolve(process.env.AXF_ROOT || join(dirname(fileURLToPath(import.meta.url)), '../..'));
export const FRAME = 'ui-api@1';
export const BASELINE = 'framework/spec/ui-parity-baseline.json';
const PLUGINS = 'apps/console-web/plugins';
/** The console's and the framework's own UI (not in a plugin): held by the same ratchet. */
const AREAS = [
  { area: 'console', dir: 'apps/console-web/src', skip: /(^|\/)(axf|assets|assets-overrides)(\/|$)|\.test\.|\.d\.ts$/ },
  { area: 'framework', dir: 'framework/react', skip: /\.test\.|\.d\.ts$|(^|\/)vendor\// },
  { area: 'framework', dir: 'framework/libs', skip: /\.test\.|\.d\.ts$|(^|\/)vendor\/|(^|\/)python\// },
];
const REF = /^(?:(action|value|view|dialog|settings):(.+)|([a-z0-9][a-z0-9-]*)\/([a-z0-9][a-z0-9._-]*)|([a-z0-9][a-z0-9._-]*))$/;

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
const srcTest = (n) => /\.(tsx?|mjs)$/.test(n) && !/\.d\.m?ts$|\.test\./.test(n);

/** Controls a person drives (api-coverage scan): only `generic` ones need a named op; covered / person-only don't. */
function controlsOf(src, rel, where) {
  const seen = new Map();
  for (const r of scanFile(src, rel, where)) {
    if (r.kind !== 'control' && r.kind !== 'menu') continue;
    if (r.status !== 'generic') continue;
    const label = String(r.label ?? '').trim();
    const key = `${rel}\u0000${label}`;
    if (!seen.has(key)) seen.set(key, { file: rel, label, verb: r.api?.split(' ')[1] ?? 'press', kind: r.kind });
  }
  return [...seen.values()];
}

/** Every console action id any web source registers (framework, console, plugins) + the runtime's own. */
function allActions() {
  const ids = new Set(['nav', 'settings.open', 'swap', 'dialog.open', 'search.open']);
  const dirs = [...AREAS.map((a) => a.dir), 'framework/core', PLUGINS];
  for (const d of dirs) for (const f of files(join(ROOT, d), srcTest)) for (const a of scanActions(read(f))) ids.add(a.id ?? a);
  // the runtime registers a few with a variable (a.register('nav', …)): take those too
  for (const f of [join(ROOT, 'framework/core/runtime.ts')]) if (existsSync(f)) for (const m of read(f).matchAll(/\ba\.register\(\s*'([^']+)'/g)) ids.add(m[1]);
  return ids;
}

function loadPlugins() {
  const dir = join(ROOT, PLUGINS);
  const cmds = new Map(pluginRegistry({ apps: ['console-web'] }).plugins.map((p) => [p.folder, p]));
  const out = [];
  for (const folder of existsSync(dir) ? readdirSync(dir).sort() : []) {
    if (folder.startsWith('_') || folder.startsWith('.')) continue;
    const pj = join(dir, folder, 'plugin.json');
    if (!existsSync(pj)) continue;
    let man; try { man = JSON.parse(read(pj)); } catch { continue; }
    const web = files(join(dir, folder, 'web'), srcTest).map((f) => relative(ROOT, f));
    if (!web.length) continue; // no UI
    const reg = cmds.get(folder);
    out.push({
      folder, name: man.name ?? folder, man, web,
      views: (man.provides ?? []).filter((x) => /^view:/.test(x)).map((x) => x.slice(5)),
      dialogs: (man.provides ?? []).filter((x) => /^dialog:/.test(x)).map((x) => x.slice(7)),
      commands: new Map((reg?.commands ?? []).map((c) => [c.id, c])),
    });
  }
  return out;
}

/** Resolve one ref → '' (fine) or why it names nothing. */
export function refError(ref, ctx) {
  const m = REF.exec(String(ref ?? ''));
  if (!m) return `"${ref}" is not a ref (<command>, <plugin>/<command>, action:<id>, value:<key>, view:<id>, dialog:<id>, settings:<tab>)`;
  const [, kind, rest, folder, cmd, own] = m;
  if (own) return ctx.plugin.commands.has(own) ? '' : `no command "${own}" in ${ctx.plugin.folder} (plugin-commands@1)`;
  if (folder) { const p = ctx.byFolder.get(folder); return p?.commands.has(cmd) ? '' : `no command "${cmd}" in plugin ${folder}`; }
  if (kind === 'action') { const id = rest.split(':')[0]; return ctx.actions.has(id) ? '' : `no console action "${id}" is registered anywhere`; }
  if (kind === 'value') return /^[A-Za-z][A-Za-z0-9._:@/-]{0,159}$/.test(rest) ? '' : `"${rest}" is not a setting key`;
  if (kind === 'view') return ctx.views.has(rest) ? '' : `no view "${rest}"`;
  if (kind === 'dialog') return ctx.dialogs.has(rest) ? '' : `no dialog "${rest}"`;
  return '';
}

/** The whole picture: { areas: [{ id, kind: plugin|console|framework, views: [...], gaps: [...], errors: [...] }] }. */
export function build() {
  const plugins = loadPlugins();
  const ctx = { byFolder: new Map(plugins.map((p) => [p.folder, p])), actions: allActions(), views: new Set(plugins.flatMap((p) => p.views)), dialogs: new Set(plugins.flatMap((p) => p.dialogs)) };
  const areas = [];
  for (const p of plugins) {
    const ui = p.man.ui && typeof p.man.ui === 'object' ? p.man.ui : null;
    const errors = [];
    if (ui && ui.$axf !== FRAME) errors.push(`plugin.json ui.$axf must be "${FRAME}"`);
    const maps = ui?.views && typeof ui.views === 'object' ? ui.views : {};
    const pctx = { ...ctx, plugin: p };
    const controls = p.web.flatMap((rel) => controlsOf(read(join(ROOT, rel)), rel, `plugin:${p.folder}`));
    const claimed = new Set(); // file\0label a map names
    const views = [];
    for (const [id, kind] of [...p.views.map((v) => [v, 'view']), ...p.dialogs.map((d) => [d, 'dialog'])]) {
      const m = maps[id];
      const v = { id, kind, open: deepLink({ [kind]: id }), mapped: !!m, files: [], state: [], actions: 0, uiOnly: 0, gaps: [] };
      if (m) {
        v.files = (m.files ?? []).map((f) => `${PLUGINS}/${p.folder}/${f}`);
        for (const f of v.files) if (!existsSync(join(ROOT, f))) errors.push(`${id}: files names ${f}, which doesn't exist`);
        v.state = Array.isArray(m.state) ? m.state : m.state ? [m.state] : [];
        for (const r of v.state) { const e = refError(r, pctx); if (e) errors.push(`${id} state: ${e}`); }
        const acts = m.actions && typeof m.actions === 'object' ? m.actions : {};
        const only = m.uiOnly && typeof m.uiOnly === 'object' ? m.uiOnly : {};
        for (const [label, refs] of Object.entries(acts)) for (const r of (Array.isArray(refs) ? refs : [refs])) { const e = refError(r, pctx); if (e) errors.push(`${id} "${label}": ${e}`); }
        for (const [label, why] of Object.entries(only)) if (String(why ?? '').trim().length < 8) errors.push(`${id} uiOnly "${label}": say why the API needs no op`);
        v.actions = Object.keys(acts).length; v.uiOnly = Object.keys(only).length;
        const own = controls.filter((c) => v.files.includes(c.file));
        for (const c of own) if (c.label in acts || c.label in only) claimed.add(`${c.file}\u0000${c.label}`);
        for (const c of own) if (!(c.label in acts) && !(c.label in only)) v.gaps.push({ what: 'action', file: c.file, label: c.label, fix: `map "${c.label}" in plugin.json ui.views["${id}"].actions (or uiOnly with why)` });
        const unused = [...Object.keys(acts), ...Object.keys(only)].filter((l) => !own.some((c) => c.label === l));
        for (const l of unused) errors.push(`${id}: maps "${l}", but no control in its files has that label (renamed?)`);
      }
      if (!v.state.length) v.gaps.push({ what: 'state', label: id, fix: `name what reads ${id} in plugin.json ui.views["${id}"].state (a read command, value:<key>)` });
      views.push(v);
    }
    for (const id of Object.keys(maps)) if (!p.views.includes(id) && !p.dialogs.includes(id)) errors.push(`ui.views names "${id}", which the plugin doesn't provide (provides view:/dialog:)`);
    // controls no mapped view owns: the plugin's gaps until its views are mapped
    const loose = controls.filter((c) => !claimed.has(`${c.file}\u0000${c.label}`) && !views.some((v) => v.mapped && v.files.includes(c.file)));
    const gaps = [...views.flatMap((v) => v.gaps.map((g) => ({ ...g, view: v.id }))), ...loose.map((c) => ({ what: 'action', file: c.file, label: c.label, view: '', fix: 'map its view in plugin.json ui (ui-api@1)' }))];
    const settings = (p.man.settings ?? []).length; // plugin-side declared settings (console.values covers web ones)
    areas.push({ id: p.folder, kind: 'plugin', name: p.name, views, controls: controls.length, gaps, errors, settings, full: views.length > 0 && views.every((v) => v.mapped) && !gaps.length && !errors.length });
  }
  for (const a of ['console', 'framework']) {
    const controls = AREAS.filter((x) => x.area === a).flatMap((x) => files(join(ROOT, x.dir), (n, f) => srcTest(n) && !x.skip.test(relative(join(ROOT, x.dir), f)))).flatMap((f) => controlsOf(read(f), relative(ROOT, f), a));
    areas.push({ id: a, kind: a, name: a === 'console' ? 'Dev Console (own screens)' : 'Framework (React layer, libs)', views: [], controls: controls.length, gaps: controls.map((c) => ({ what: 'action', file: c.file, label: c.label, view: '', fix: 'a named op (console action, setting, command) or a ui-api@1 map' })), errors: [], settings: 0, full: false });
  }
  return { $axf: FRAME, areas };
}

export function loadBaseline() {
  const f = join(ROOT, BASELINE);
  return existsSync(f) ? JSON.parse(read(f)) : { $axf: 'ui-parity-baseline@1', areas: {} };
}

/** CI verdict: { ok, problems: [...] }. */
export function check(model = build(), base = loadBaseline()) {
  const problems = [];
  for (const a of model.areas) {
    for (const e of a.errors) problems.push(`${a.id}: ${e}`);
    const was = base.areas?.[a.id];
    if (was === undefined && a.gaps.length) problems.push(`${a.id}: new UI with ${a.gaps.length} gap(s) — map it in plugin.json ui (ui-api@1): node framework/cli/ui-parity.mjs gaps ${a.id}`);
    else if (was !== undefined && a.gaps.length > was) problems.push(`${a.id}: ${a.gaps.length} gap(s), the baseline allows ${was} — node framework/cli/ui-parity.mjs gaps ${a.id}`);
    for (const v of a.views) if (v.mapped && v.gaps.length) problems.push(`${a.id}: ${v.kind} ${v.id} is mapped (ui-api@1) but not full: ${v.gaps.length} gap(s) — ${v.gaps.slice(0, 3).map((g) => g.label).join(', ')}`);
  }
  return { ok: !problems.length, problems };
}

export function baselineOf(model = build()) {
  return { $axf: 'ui-parity-baseline@1', note: 'Gaps per UI area (ui-parity.mjs). Only ever lowered: ui-parity.mjs write-baseline after a real reduction.', areas: Object.fromEntries(model.areas.filter((a) => a.gaps.length).map((a) => [a.id, a.gaps.length])) };
}

async function main(argv) {
  const json = argv.includes('--json');
  const [cmd = 'summary', arg] = argv.filter((a) => a !== '--json');
  const model = build();
  const base = loadBaseline();
  const out = (o, text) => console.log(json ? JSON.stringify(o) : text);
  if (cmd === 'check') {
    const r = check(model, base);
    const lowered = model.areas.filter((a) => base.areas?.[a.id] !== undefined && a.gaps.length < base.areas[a.id]);
    out(r, r.ok ? `ui-parity: ok — ${model.areas.filter((a) => a.full).length} UI area(s) full, ${model.areas.reduce((n, a) => n + a.gaps.length, 0)} gap(s) held by the baseline${lowered.length ? ` (${lowered.map((a) => a.id).join(', ')} went down: write-baseline to lock it)` : ''}` : `ui-parity: ${r.problems.length} problem(s)\n${r.problems.map((p) => `  ✗ ${p}`).join('\n')}`);
    return r.ok ? 0 : 1;
  }
  if (cmd === 'write-baseline') {
    const next = baselineOf(model);
    const rose = Object.entries(next.areas).filter(([id, n]) => (base.areas?.[id] ?? 0) < n && base.areas?.[id] !== undefined);
    if (rose.length && !argv.includes('--force')) { console.error(`ui-parity: gaps went UP in ${rose.map(([id]) => id).join(', ')}; fix them (the baseline only comes down). --force only for the first write.`); return 1; }
    writeFileSync(join(ROOT, BASELINE), `${JSON.stringify(next, null, 1)}\n`);
    console.log(`ui-parity: wrote ${BASELINE} (${Object.keys(next.areas).length} areas with gaps)`);
    return 0;
  }
  if (cmd === 'gaps') {
    const areas = model.areas.filter((a) => !arg || a.id === arg);
    out(areas.map((a) => ({ id: a.id, gaps: a.gaps })), areas.filter((a) => a.gaps.length).map((a) => `${a.id} (${a.gaps.length})\n${a.gaps.map((g) => `  ${g.what.padEnd(6)} ${g.view ? `[${g.view}] ` : ''}${g.label}${g.file ? `  ${g.file}` : ''}`).join('\n')}`).join('\n') || 'no gaps');
    return 0;
  }
  if (cmd === 'show') {
    const a = model.areas.find((x) => x.id === arg);
    if (!a) { console.error(`ui-parity: no UI area "${arg}"`); return 2; }
    out(a, [`${a.name} (${a.id}): ${a.full ? 'FULL parity' : `${a.gaps.length} gap(s)`}, ${a.controls} controls`, ...a.views.map((v) => `  ${v.kind} ${v.id}: open ${v.open} · state ${v.state.join(', ') || '—'} · ${v.actions} actions mapped, ${v.uiOnly} ui-only · ${v.gaps.length} gap(s)${v.mapped ? '' : ' (not mapped)'}`), ...a.errors.map((e) => `  ✗ ${e}`)].join('\n'));
    return 0;
  }
  const rows = model.areas.map((a) => ({ id: a.id, kind: a.kind, views: a.views.length, mapped: a.views.filter((v) => v.mapped).length, controls: a.controls, gaps: a.gaps.length, baseline: base.areas?.[a.id] ?? null, full: a.full, errors: a.errors.length }));
  out({ $axf: FRAME, areas: rows }, [...rows.map((r) => `${r.id.padEnd(24)} ${String(r.views).padStart(2)} views (${r.mapped} mapped) · ${String(r.controls).padStart(4)} controls · ${String(r.gaps).padStart(4)} gaps${r.baseline != null ? ` (baseline ${r.baseline})` : ''}${r.full ? ' · FULL' : ''}${r.errors ? ` · ${r.errors} error(s)` : ''}`), `${rows.filter((r) => r.full).length}/${rows.length} UI areas at full parity, ${rows.reduce((n, r) => n + r.gaps, 0)} gaps`].join('\n'));
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { console.error(`ui-parity: ${e.stack ?? e.message}`); process.exit(1); });
}
