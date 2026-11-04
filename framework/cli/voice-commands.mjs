#!/usr/bin/env node
/**
 * Voice commands for every app (voice-command@1, core/engines/voice-command-rules.mjs; Brett, Nov 4 2026: "it needs to
 * build in voice commands for the API and MCP and CLI automatically, so they can be added to Molly and controlled by
 * voice"). Reads an app's command surface from what it already declares and keeps one voice-command asset per app:
 *
 *   node framework/cli/voice-commands.mjs surface <app> [--json]          the command surface (API / MCP / CLI / actions)
 *   node framework/cli/voice-commands.mjs generate <app> [--write]        the asset from the surface (authored commands kept)
 *   node framework/cli/voice-commands.mjs check [app…] [--json]           CI: every forFramework app's commands have phrases
 *   node framework/cli/voice-commands.mjs registry [--json]               every app's voice commands (Molly, the console)
 *   node framework/cli/voice-commands.mjs help [app]                      "what can I say in <app>?"
 *   node framework/cli/voice-commands.mjs say "<text>" [--app <app>]      what an utterance would run (no run)
 *   node framework/cli/voice-commands.mjs fill '<json>'                    {command, slots, name, text} → the slot filled (an answer to a question)
 *   node framework/cli/voice-commands.mjs bake <app-dir>                  copy every asset into <app-dir>/src/axf/assets/voice-command (Molly)
 *
 * <app> is a folder under apps/ (console-web, molly, expenses, …) or its project manifest name. The surface of an app:
 *   - apps/<app>/axf.commands.json (commands@1): commands the app declares by hand
 *       { "$axf": "commands@1", "wake": ["expenses"], "commands": [{ id, title, description?, effect?, run: { api?, mcp?, cli?, action? }, input?: { properties, required } }] }
 *   - its plugins (plugin-commands@1, framework/cli/plugin-commands.mjs): every plugin command and read, as its MCP tool
 *     name, REST route and CLI words;
 *   - the console: control@1's tools (framework/core/engines/control-rules.mjs);
 *   - its own web actions (`rt.actions.register('<id>', …, { label })`, and Molly's `on('<id>', …, { label })`).
 * The asset lives at apps/<app>/src/assets/voice-command/<name>.json. Regeneration keeps commands marked
 * `source: "authored"` and their phrases; everything else follows the surface. `check` fails (exit 1) for an app whose
 * project manifest says framework.forFramework and whose asset is missing, invalid, or leaves a surface command
 * without phrases, naming the command and the command to run.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLUGIN_HOMES, readPlugins } from './plugin-commands.mjs';
import { actionEffect, commandToolName, pluginCommandRegistry, scanWebActions } from '../core/engines/plugin-commands.mjs';
import { controlTools } from '../core/engines/control-rules.mjs';
import { fillSlot, generateVoiceCommands, mergeVoiceCommands, normalizeVoiceCommands, matchUtterance, voiceCommandErrors, voiceCoverage, whatCanISay, VOICE_COMMAND_TYPE } from '../core/engines/voice-command-rules.mjs';

export const ROOT = resolve(process.env.AXF_ROOT || join(dirname(fileURLToPath(import.meta.url)), '../..'));
export const COMMANDS_FILE = 'axf.commands.json';
export const COMMANDS_FRAME = 'commands@1';
export const ASSET_DIR = 'src/assets/voice-command';
/** Short names a person says for an app whose manifest name is longer (the asset's wake words; the manifest's displayName words are added). */
export const WAKE_WORDS = { 'axf-console-web': ['console', 'dev console'], 'amberx-droid': ['amberx', 'amber x'], 'axhub-web': ['axhub', 'ax hub', 'hub'], molly: ['molly'], expenses: ['expenses', 'expense'], 'walkthrough-studio': ['walkthrough studio', 'walkthroughs'], 'voice-vault': ['voice vault'], 'axf-demo': ['demo'] };

const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/* ------------------------------------------------------------------ apps */

/** Every app folder with a project manifest: { folder, dir, name, manifest, forFramework }. */
export function listApps() {
  const out = [];
  const appsDir = join(ROOT, 'apps');
  if (!existsSync(appsDir)) return out;
  for (const folder of readdirSync(appsDir).sort()) {
    const dir = join(appsDir, folder);
    const manifest = readJson(join(dir, 'project.manifest.json'));
    if (!manifest) continue;
    out.push({ folder, dir, name: manifest.name ?? folder, manifest, forFramework: manifest.framework?.forFramework === true });
  }
  return out;
}

/** An app by folder, manifest name or path. */
export function findApp(ref) {
  const apps = listApps();
  const r = String(ref ?? '').replace(/\/$/, '');
  return apps.find((a) => a.folder === r || a.name === r || a.dir === resolve(r) || relative(ROOT, resolve(r)) === `apps/${a.folder}`) ?? null;
}

/* ------------------------------------------------------------------ the surface */

function* sourceFiles(dir, depth = 0) {
  if (depth > 6 || !existsSync(dir)) return;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'axf' || e.name === 'dist' || e.name === 'plugins') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* sourceFiles(p, depth + 1);
    else if (/\.(tsx?|mjs|js)$/.test(e.name) && !/\.d\.m?ts$/.test(e.name) && !/\.test\./.test(e.name)) yield p;
  }
}

/** Web actions an app registers in its own sources (not its baked src/axf, not its plugins: those come through the plugin registry). */
export function appActions(app) {
  const out = []; const seen = new Set();
  // an app with its own plugin folder that is not a plugin home (Molly): its plugins' web actions are the app's too
  const roots = [join(app.dir, 'src'), ...(PLUGIN_HOMES.some((h) => h.app === app.folder) ? [] : [join(app.dir, 'plugins')].filter((d) => existsSync(d)).flatMap((d) => readdirSync(d).filter((n) => !n.startsWith('_') && !n.startsWith('.')).map((n) => join(d, n, 'web'))))];
  for (const f of roots.flatMap((r) => [...sourceFiles(r)])) {
    const text = readFileSync(f, 'utf8');
    const rel = relative(app.dir, f);
    for (const a of scanWebActions(text, rel)) if (!seen.has(a.id)) { seen.add(a.id); out.push(a); }
    // Molly's style: `const on = axf.actions.register.bind(…)` then on('<id>', …, { label: '…' })
    const re = /\bon\(\s*(['"`])([a-z][A-Za-z0-9_.:-]+)\1\s*,[\s\S]{0,400}?\blabel:\s*(['"`])((?:\\.|(?!\3)[^\\]){1,160})\3/g;
    let m;
    while ((m = re.exec(text))) if (!seen.has(m[2])) { seen.add(m[2]); out.push({ id: m[2], label: m[4], file: rel, line: text.slice(0, m.index).split('\n').length }); }
  }
  return out;
}

/** The hand-declared commands (apps/<app>/axf.commands.json), checked. */
export function declaredCommands(app) {
  const file = join(app.dir, COMMANDS_FILE);
  const raw = readJson(file);
  if (!raw) return { file, wake: [], commands: [], errors: existsSync(file) ? [`${relative(ROOT, file)} is not JSON`] : [] };
  const errors = [];
  if (raw.$axf !== COMMANDS_FRAME) errors.push(`${relative(ROOT, file)}: "$axf" must be "${COMMANDS_FRAME}"`);
  const commands = (Array.isArray(raw.commands) ? raw.commands : []).filter((c, i) => { if (!isObj(c) || typeof c.id !== 'string' || !isObj(c.run)) { errors.push(`${relative(ROOT, file)}: commands[${i}] needs id and run { api | mcp | cli | action }`); return false; } return true; });
  return { file, wake: Array.isArray(raw.wake) ? raw.wake : [], commands, errors };
}

/** The whole command surface of an app: { app, forFramework, wake, commands: [entry…], from: { declared, plugins, control, actions }, errors }. */
export function voiceSurface(app) {
  const declared = declaredCommands(app);
  const commands = [...declared.commands];
  const from = { declared: declared.commands.length, plugins: 0, control: 0, actions: 0 };
  const home = PLUGIN_HOMES.find((h) => h.app === app.folder);
  if (home) {
    const reg = pluginCommandRegistry(readPlugins({ apps: [app.folder] }));
    for (const p of reg.plugins ?? []) for (const c of p.commands ?? []) {
      const tool = commandToolName(p.folder, c.id);
      const method = c.run?.route?.method ?? (c.effect === 'read' ? 'GET' : 'POST');
      commands.push({ id: tool, title: `${p.name || p.folder}: ${c.title || c.id}`, description: c.description || '', effect: c.effect, readOnly: c.readOnly, destructive: c.destructive, input: c.input, run: { mcp: tool, api: `${method} /api/control/${p.folder}/${c.id}`, cli: `axf ${p.folder} ${c.id}` }, plugin: p.folder });
      from.plugins++;
    }
  }
  if (app.folder === 'console-web') {
    for (const t of controlTools()) { commands.push({ id: t.name, title: t.title || t.name, description: t.description || '', effect: t.annotations?.destructiveHint ? 'destructive' : t.annotations?.readOnlyHint ? 'read' : 'write', input: t.inputSchema, run: { mcp: t.name, api: `POST /api/control/${t.name.replace(/^control_/, '')}`, cli: `axf control ${t.name.replace(/^control_/, '')}` } }); from.control++; }
  }
  for (const a of appActions(app)) { commands.push({ id: a.id, title: a.label || a.id, effect: actionEffect(a.id), run: { action: a.id }, file: a.file, line: a.line }); from.actions++; }
  const seen = new Set();
  const unique = commands.filter((c) => { const id = String(c.id).toLowerCase(); if (seen.has(id)) return false; seen.add(id); return true; });
  const wake = [...new Set([...(WAKE_WORDS[app.name] ?? []), ...declared.wake, app.name, ...(app.manifest.displayName ? [String(app.manifest.displayName).toLowerCase()] : [])])].filter((w) => /^[a-z][a-z0-9 -]{0,30}$/.test(w)).slice(0, 6);
  return { app: app.name, forFramework: app.forFramework, wake, commands: unique, from, errors: declared.errors };
}

/* ------------------------------------------------------------------ the asset */

export function assetPath(app) { return join(app.dir, ASSET_DIR, `${app.name}.json`); }

export function readAsset(app) { return readJson(assetPath(app)); }

/** The asset an app should have now: generated from the surface, merged with what is on disk (authored commands kept). */
export function buildAsset(app) {
  const surface = voiceSurface(app);
  const generated = generateVoiceCommands(surface);
  const existing = readAsset(app);
  const data = existing?.data ? mergeVoiceCommands(existing.data, generated) : generated;
  const asset = { $axf: 'asset@1', type: VOICE_COMMAND_TYPE, id: existing?.id ?? app.name, name: existing?.name ?? `${app.manifest.displayName || app.name} voice commands`, version: existing?.version ?? '1', description: existing?.description ?? `What you can say to ${app.manifest.displayName || app.name}: generated from its API, MCP tools, CLI and actions by framework/cli/voice-commands.mjs; commands marked authored are hand-tuned and kept.`, data };
  return { asset, surface, changed: JSON.stringify(existing) !== JSON.stringify(compactAsset(asset)) };
}

/** The asset as written: defaults left out (normalizeVoiceCommands puts them back), one command per line, so a big app's file stays readable and small. */
export function compactAsset(asset) {
  const d = normalizeVoiceCommands(asset.data);
  const floor = { read: 'never', navigate: 'never', write: 'missing', destructive: 'always' };
  const commands = d.commands.map((c) => {
    const o = { id: c.id, title: c.title, effect: c.effect };
    if (c.confirm !== floor[c.effect]) o.confirm = c.confirm;
    o.run = c.run;
    const slots = {};
    for (const [n, s] of Object.entries(c.slots)) { const t = { type: s.type }; if (s.required) t.required = true; if (s.options) t.options = s.options; if (s.say && s.say !== n) t.say = s.say; if (s.default !== undefined) t.default = s.default; slots[n] = t; }
    if (Object.keys(slots).length) o.slots = slots;
    o.phrases = c.phrases;
    if (c.say && c.say !== (c.effect === 'read' ? '{title}: {result}' : `${c.title}: done.`)) o.say = c.say;
    if (c.help) o.help = c.help;
    if (c.source === 'authored') o.source = 'authored';
    return o;
  });
  const data = { app: d.app, ...(d.forFramework ? { forFramework: true } : {}), source: d.source, ...(d.generatedFrom.length ? { generatedFrom: d.generatedFrom } : {}), wake: d.wake, commands };
  return { ...asset, data };
}

export function writeAsset(app, asset) {
  const file = assetPath(app);
  mkdirSync(dirname(file), { recursive: true });
  const a = compactAsset(asset);
  const head = JSON.stringify({ ...a, data: { ...a.data, commands: '@@' } }, null, 2);
  const body = a.data.commands.map((c) => '      ' + JSON.stringify(c)).join(',\n');
  writeFileSync(file, head.replace('"commands": "@@"', `"commands": [\n${body}\n    ]`) + '\n');
  return file;
}

/** One app's check: problems as lines (empty = fine). Only forFramework apps are held to it; others get an info line when they have an asset. */
export function checkApp(app) {
  const problems = [];
  const file = relative(ROOT, assetPath(app));
  const fix = `run: node framework/cli/voice-commands.mjs generate ${app.folder} --write`;
  const surface = voiceSurface(app);
  problems.push(...surface.errors);
  const asset = readAsset(app);
  if (!app.forFramework) return { app: app.name, folder: app.folder, forFramework: false, problems, info: asset ? `${file}: ${asset.data?.commands?.length ?? 0} voice command(s) (not a forFramework app, not required)` : '' };
  if (!asset) { problems.push(`${file}: missing — ${app.name} is a forFramework app (project.manifest.json framework.forFramework), so its ${surface.commands.length} command(s) need voice phrases; ${fix}`); return { app: app.name, folder: app.folder, forFramework: true, problems }; }
  const errors = voiceCommandErrors(VOICE_COMMAND_TYPE, asset.data);
  for (const e of errors) problems.push(`${file}: ${e}`);
  if (asset.type !== VOICE_COMMAND_TYPE || asset.data?.app !== app.name) problems.push(`${file}: must be a voice-command asset for app "${app.name}"`);
  const cov = voiceCoverage(asset.data, surface);
  for (const id of cov.missing) { const e = surface.commands.find((c) => String(c.id).toLowerCase() === id); problems.push(`${file}: command "${id}" has no voice phrases${e?.file ? ` (${join('apps', app.folder, e.file)}:${e.line})` : e?.plugin ? ` (plugin ${e.plugin})` : ''}; ${fix}`); }
  return { app: app.name, folder: app.folder, forFramework: true, problems, coverage: cov };
}

/** Every voice-command asset in the repo (apps and framework starters), as data for Molly and the console. */
export function registry() {
  const apps = [];
  const files = [];
  for (const app of listApps()) { const a = readAsset(app); if (a?.data) { apps.push({ ...normalizeVoiceCommands(a.data), folder: app.folder, displayName: app.manifest.displayName || app.name, file: relative(ROOT, assetPath(app)) }); files.push(assetPath(app)); } }
  const starters = join(ROOT, 'framework/assets/voice-command');
  if (existsSync(starters)) for (const f of readdirSync(starters).filter((x) => x.endsWith('.json'))) { const a = readJson(join(starters, f)); if (a?.data && !apps.some((x) => x.app === a.data.app)) { apps.push({ ...normalizeVoiceCommands(a.data), folder: '', displayName: a.name, file: relative(ROOT, join(starters, f)) }); files.push(join(starters, f)); } }
  return { $axf: 'voice-registry@1', generatedAt: new Date().toISOString(), apps, files };
}

/* ------------------------------------------------------------------ CLI */

function main(argv) {
  const json = argv.includes('--json'); const write = argv.includes('--write');
  const args = argv.filter((a) => !a.startsWith('--'));
  const flag = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
  const [cmd = 'help', ...rest] = args;
  const out = (o, text) => console.log(json ? JSON.stringify(o, null, 2) : text);
  const need = (ref) => { const a = findApp(ref); if (!a) throw new Error(`no app "${ref}" (a folder under apps/ with a project.manifest.json)`); return a; };
  if (cmd === 'surface') {
    const s = voiceSurface(need(rest[0]));
    return out(s, [`${s.app}${s.forFramework ? ' (forFramework)' : ''}: ${s.commands.length} command(s) — declared ${s.from.declared}, plugins ${s.from.plugins}, control ${s.from.control}, actions ${s.from.actions}; wake: ${s.wake.join(', ')}`, ...s.commands.map((c) => `  ${c.id.padEnd(40)} ${(c.effect ?? '').padEnd(11)} ${Object.entries(c.run).map(([k, v]) => `${k}: ${v}`).join(' · ')}`), ...s.errors.map((e) => `! ${e}`)].join('\n'));
  }
  if (cmd === 'generate') {
    const app = need(rest[0]);
    const { asset, surface, changed } = buildAsset(app);
    const errors = voiceCommandErrors(VOICE_COMMAND_TYPE, asset.data);
    if (errors.length) throw new Error(`generated asset does not validate:\n  ${errors.join('\n  ')}`);
    const file = write ? writeAsset(app, asset) : assetPath(app);
    return out({ ok: true, file: relative(ROOT, file), written: write, changed, commands: asset.data.commands.length, source: asset.data.source, from: surface.from }, `${write ? (changed ? 'wrote' : 'unchanged') : 'would write'} ${relative(ROOT, file)}: ${asset.data.commands.length} command(s) (${asset.data.source}; declared ${surface.from.declared}, plugins ${surface.from.plugins}, control ${surface.from.control}, actions ${surface.from.actions})${surface.errors.length ? `\n! ${surface.errors.join('\n! ')}` : ''}`);
  }
  if (cmd === 'check') {
    const apps = rest.length ? rest.map(need) : listApps();
    const results = apps.map(checkApp);
    const bad = results.filter((r) => r.problems.length);
    const lines = results.flatMap((r) => (r.problems.length ? r.problems.map((p) => `✗ ${p}`) : [r.forFramework ? `✓ ${r.app}: ${r.coverage.covered}/${r.coverage.total} command(s) have voice phrases` : r.info || `· ${r.app}: not a forFramework app`]));
    out({ ok: bad.length === 0, results }, lines.join('\n'));
    if (bad.length) process.exitCode = 1;
    return;
  }
  if (cmd === 'registry') {
    const r = registry();
    return out(r, r.apps.map((a) => `${a.app.padEnd(20)} ${String(a.commands.length).padStart(4)} command(s)  wake: ${a.wake.join(', ')}  (${a.file})`).join('\n') || 'No voice commands yet.');
  }
  if (cmd === 'help') {
    const r = registry();
    const app = rest[0] ? need(rest[0]).name : '';
    const h = whatCanISay(r.apps, app);
    return out(h, h.map((a) => [a.header, ...a.commands.map((c) => `  ${c.line}`)].join('\n')).join('\n\n') || 'No voice commands yet.');
  }
  if (cmd === 'say') {
    const r = registry();
    const m = matchUtterance(r.apps, rest.join(' '), { now: new Date().toISOString(), app: flag('app') ? need(flag('app')).name : '' });
    return out(m ? { app: m.app, command: m.command, slots: m.slots, missing: m.missing, confirm: m.confirm, question: m.question, phrase: m.phrase } : null, m ? `${m.app} → ${m.command.id} ${JSON.stringify(m.slots)}${m.missing.length ? ` · missing: ${m.missing.join(', ')}` : ''}${m.confirm ? ` · asks: ${m.question}` : ' · runs at once'}\n  ${Object.entries(m.command.run).map(([k, v]) => `${k}: ${v}`).join(' · ')}` : 'Nothing matches.');
  }
  if (cmd === 'fill') {
    const q = JSON.parse(rest[0] ?? '{}');
    const r = fillSlot(q.command, q.slots, String(q.name ?? ''), String(q.text ?? ''), new Date().toISOString());
    return out(r, `${r.ok ? 'filled' : 'not filled'} ${q.name}: ${JSON.stringify(r.slots)}${r.missing.length ? ` · missing: ${r.missing.join(', ')}` : ''}${r.question ? ` · ${r.question}` : ''}`);
  }
  if (cmd === 'bake') {
    const dest = resolve(rest[0] ?? '.');
    const dir = join(dest, 'src/axf/assets/voice-command');
    mkdirSync(dir, { recursive: true });
    const r = registry(); let n = 0;
    for (const f of r.files) { writeFileSync(join(dir, basename(f)), readFileSync(f)); n++; }
    return out({ ok: true, files: n, dir: relative(ROOT, dir) }, `baked ${n} voice-command asset(s) into ${relative(ROOT, dir)}`);
  }
  throw new Error(`unknown command ${cmd}\n${readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter((l) => /^ \*   node/.test(l)).join('\n')}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exitCode = 1; }
}
