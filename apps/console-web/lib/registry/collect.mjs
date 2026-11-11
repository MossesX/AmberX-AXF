#!/usr/bin/env node
/**
 * Collectors: everything controllable, read from the files that already define it (control-registry@1; build
 * full-api-cli-control-of-everything-plus-an-offli, Nov 10 2026). No AI anywhere here: the repo is the source.
 *
 *   control   every control@1 target (framework/core/engines/control-rules.mjs): token sets as `display` entries whose
 *             paths and allowed values are enumerated, entities and the console / pass / plugins domains as `tool` and
 *             `behavior` entries whose ops and act verbs are actions with typed parameters
 *   plugins   every plugin of every app (plugin@1 manifests + plugin-commands@1 registry): a `plugin` entry, a `page`
 *             entry per view / settings tab / dialog it provides, a `display` entry per banner, menu or tab, a `tool`
 *             entry per command and read (input schema → params)
 *   ui-api    plugin.json `ui` (ui-api@1): state refs and control → ref actions onto the page entries
 *   voice     plugin.json `voice` (voice-intents@1) and AmberX registerVoiceCommands calls: phrases onto entries
 *   console   the console's own settings registries, display options and parameter conventions (console-entries.mjs)
 *   declared  plugin.json `control` and _claude/builds/registry/registry.d/*.json: hand-written facts win
 *
 *   node apps/console-web/lib/registry/collect.mjs [--json]     the entries (summary, or all of them)
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONTROL_TARGETS, controlEffectOf, controlPaths, controlPermission } from '../../../../framework/core/engines/control-rules.mjs';
import { commandToolName } from '../../../../framework/core/engines/plugin-commands.mjs';
import { applyDeclaration, cleanParam, paramFromDecl, paramsFromSchema, REGISTRY_FRAME } from '../../../../framework/core/engines/control-registry.mjs';
import { readPlugins, registry as pluginRegistry } from '../../../../framework/cli/plugin-commands.mjs';
import { applyUiApi } from '../ui-api-parity/index.mjs';
import { applyVoiceIntents, readVoiceIntents, scanVoiceCommands } from '../voice-api/index.mjs';
import { appDeclarationFiles, applyConventions, collectAppPlugins, collectDisplayOptions, collectSettingsRegistries, generatePhrases } from './console-entries.mjs';

export const ROOT = resolve(process.env.AXF_ROOT || join(dirname(fileURLToPath(import.meta.url)), '../../../..'));
export const DECL_DIR = process.env.AXF_REGISTRY_DECL_DIR || join(ROOT, '_claude', 'builds', 'registry', 'registry.d');
export const COLLECTORS = ['control', 'plugins', 'ui-api', 'voice', 'console', 'declared'];
const CONSOLE = 'console-web';
const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
const read = (f) => { try { return readFileSync(f, 'utf8'); } catch { return ''; } };
const rel = (f) => relative(ROOT, f).split('\\').join('/');
/** "plan-studio" → "Plan studio". */
export const humanize = (id) => { const t = String(id ?? '').replace(/^.*[/:]/, '').replace(/[-_.]+/g, ' ').trim(); return t ? t[0].toUpperCase() + t.slice(1) : String(id ?? ''); };

/* ================================================================== control@1 */

const pathParam = (target, t, extra = {}) => {
  const paths = t.paths === 'static' ? controlPaths(target) : [];
  return cleanParam(paths.length ? { name: 'path', type: 'enum', enum: paths.map((p) => p.id), description: 'which token', position: 0, ...extra }
    : { name: 'path', type: 'id', of: target, description: t.pathShape ?? (t.paths === 'entity' ? 'the record id' : t.paths === 'scope' ? `the scope: ${(t.scopes ?? []).join(', ')}` : 'the id the running app lists'), position: 0, ...(t.scopes ? { enum: t.scopes, type: 'enum' } : {}), ...extra });
};
/** A token path as a typed field: colour, number with range and default, enum with its options, boolean. */
const tokenField = (p) => cleanParam({ name: p.id, type: p.kind === 'color' ? 'color' : p.kind === 'enum' ? 'enum' : p.kind === 'boolean' ? 'boolean' : p.kind === 'number' ? 'number' : 'string', ...(p.options ? { enum: p.options } : {}), ...(p.min !== undefined ? { min: p.min } : {}), ...(p.max !== undefined ? { max: p.max } : {}), ...(p.default !== undefined ? { default: p.default } : {}), ...(p.token ? { description: `CSS ${p.token}${p.unit ? ` (${p.unit})` : ''}` } : p.unit ? { description: p.unit } : {}) });

/** Every control@1 target as an entry. */
export function collectControl() {
  const out = [];
  for (const [target, t] of Object.entries(CONTROL_TARGETS)) {
    const isTokens = t.domain === 'tokens';
    const type = isTokens ? 'display' : t.domain === 'pass' ? 'behavior' : 'tool';
    const id = `${CONSOLE}/${type}/${target}`;
    const actions = [];
    const run = (op, verb) => `control:${target}/${op}${verb ? `/${verb}` : ''}`;
    const perm = (op, verb) => controlPermission(target, op, verb);
    const selectParams = Object.entries(t.select ?? {}).map(([k, d]) => paramFromDecl(k, d, { description: 'filter' }));
    for (const op of t.ops) {
      if (op === 'act') {
        for (const [verb, want] of Object.entries(t.acts ?? {})) {
          const effect = controlEffectOf(target, op, verb);
          const params = [...(t.paths === 'static' && target === 'console.nav' ? [] : [pathParam(target, t, { required: !(target === 'console.dialogs' && verb === 'close'), ...(target.startsWith('console.') && t.paths === 'host' ? { type: 'string', description: 'the id, its title or words to search for', enum: undefined } : {}) })]),
            ...Object.entries(want ?? {}).map(([k, d]) => paramFromDecl(k, d)), ...(t.domain === 'console' ? [cleanParam({ name: 'to', type: 'string', description: 'recent (default), all, or a console client id', default: 'recent' })] : [])].filter(Boolean);
          actions.push({ id: verb, label: `${humanize(verb)} · ${t.label}`, effect, run: run(op, verb), params, permission: perm(op, verb), ...(effect === 'destructive' ? { confirm: true } : {}),
            surfaces: { rest: 'POST /api/control', mcp: `control_act`, cli: `axf control act ${target} <path> ${verb}` } });
        }
        continue;
      }
      const effect = controlEffectOf(target, op);
      const params = [];
      if (['get', 'set', 'remove'].includes(op) || (op === 'reset' && t.paths !== 'entity')) params.push(pathParam(target, t, { required: op !== 'reset' }));
      if (op === 'set') params.push(...(t.fields ? Object.entries(t.fields).map(([k, d]) => paramFromDecl(k, d)) : [cleanParam({ name: 'value', type: t.value === 'color' ? 'color' : t.value === 'asset-id' ? 'id' : 'json', description: t.value === 'field' ? 'the field value; its type and range are the path field in state.fields' : t.value === 'host' ? 'what the running app accepts for this id' : 'the new value', required: true, position: 1 })]));
      if (op === 'add') params.push(...Object.entries(t.fields ?? {}).map(([k, d]) => paramFromDecl(k, d)));
      if (op === 'list') params.push(...selectParams);
      actions.push({ id: op, label: `${humanize(op)} · ${t.label}`, effect, run: run(op), params: params.filter(Boolean), permission: perm(op), ...(effect === 'destructive' ? { confirm: true } : {}),
        surfaces: { rest: 'POST /api/control', mcp: `control_${op}`, cli: `axf control ${op} ${target}${['get', 'set', 'remove', 'reset'].includes(op) ? ' <path>' : ''}${op === 'set' ? ' <value>' : ''}` } });
    }
    const fields = t.paths === 'static' ? controlPaths(target).map(tokenField).filter(Boolean) : [];
    out.push({ id, type, owner: CONSOLE, label: t.label, description: t.doc, where: { app: CONSOLE, plugin: 'token-control', file: 'framework/core/engines/control-rules.mjs' },
      state: { read: run(t.ops.includes('list') ? 'list' : 'get'), ...(fields.length ? { fields, shape: `${fields.length} tokens, each with its allowed values` } : { shape: t.paths === 'entity' ? 'the records' : 'what the running app lists' }) },
      actions, aliases: [target, ...(t.asset ? [t.asset] : [])], keywords: [t.domain, ...target.split('.')], tags: ['control@1', t.domain], source: { kind: 'control', file: 'framework/core/engines/control-rules.mjs', frame: 'control@1' } });
  }
  return out;
}

/* ================================================================== plugins */

const PROVIDES = {
  view: (app, folder, name) => ({ type: 'page', id: `${app}/page/${name}`, where: { view: name }, open: { kind: 'screen', target: name, deepLink: `?axf-view=${name}` }, run: `view:${name}` }),
  dialog: (app, folder, name) => ({ type: 'page', id: `${app}/page/dialog/${name}`, where: { dialog: name }, open: { kind: 'dialog', target: name, deepLink: `?axf-dialog=${name}` }, run: `dialog:${name}` }),
  'settings-tab': (app, folder, name) => ({ type: 'page', id: `${app}/page/settings/${name}`, where: { settingsTab: `plugins/${name}` }, open: { kind: 'settings', target: `plugins/${name}`, deepLink: `?axf-settings=plugins/${name}` }, run: `settings:plugins/${name}`, aliases: [`settings:${name}`, `plugins/${name}`] }),
  banner: (app, folder, name) => ({ type: 'display', id: `${app}/display/banner/${name}`, where: { menu: 'banner' } }),
  'context-menu': (app, folder, name) => ({ type: 'display', id: `${app}/display/context-menu/${name}`, where: { menu: 'context-menu' } }),
  tab: (app, folder, name) => ({ type: 'display', id: `${app}/display/tab/${name}`, where: { menu: 'tabs' } }),
  'settings-panel': (app, folder, name) => ({ type: 'display', id: `${app}/display/settings-panel/${name}`, where: { menu: 'settings' } }),
  search: (app, folder, name) => ({ type: 'display', id: `${app}/display/search/${name}`, where: { menu: 'search' } }),
  action: (app, folder, name) => ({ type: 'tool', id: `${app}/tool/action/${name}`, where: {}, run: `action:${name}` }),
};
const DESTRUCTIVE = /(^|[.:_/-])(delete|remove|reset|restore|clear|wipe|purge|uninstall|discard|drop|kill|destroy|revoke|rollback)([.:_/-]|$)/i;

/** Every plugin of every app: plugin, page, display and tool entries. Returns entries plus a map folder/command → command (for ui-api effects). */
export function collectPlugins({ apps = null } = {}) {
  const reg = pluginRegistry({ apps });
  const plugins = readPlugins({ apps });
  const out = []; const errors = [];
  const commands = new Map();
  for (const p of plugins) {
    const m = p.manifest ?? {};
    const app = p.app;
    const file = `${p.dir}/plugin.json`;
    const entry = reg.plugins.find((x) => x.folder === p.folder && x.app === app);
    const name = typeof m.name === 'string' && m.name.trim() ? m.name.trim() : humanize(p.folder);
    const offConsole = app !== CONSOLE;
    const channelGap = (what) => ({ what, why: `runs inside ${app}; reached over its app channel (step s13)`, plan: 'full-api-cli-control s13' });
    const src = (frame) => ({ kind: 'plugin-manifest', file, ...(frame ? { frame } : {}) });
    // the plugin itself
    out.push({ id: `${app}/plugin/${p.folder}`, type: 'plugin', owner: app, label: name, description: String(m.description ?? '').slice(0, 2000), where: { app, plugin: p.folder, file },
      ...(offConsole ? {} : { open: { kind: 'settings', target: `plugins/${p.folder}`, deepLink: `?axf-settings=plugins/${p.folder}` } }),
      state: { read: `${p.folder}/info`, shape: 'the manifest and every command and read' },
      actions: [...(offConsole ? [] : [{ id: 'open', label: `Open ${name} settings`, effect: 'navigate', run: `settings:plugins/${p.folder}`, surfaces: { mcp: 'console_settings', cli: `axf console settings plugins/${p.folder}` } }]),
        { id: 'info', label: 'Plugin info', effect: 'read', run: `${p.folder}/info`, surfaces: { rest: `GET /api/control/${p.folder}/info`, mcp: commandToolName(p.folder, 'info', app), cli: `axf ${p.folder} info` } }],
      aliases: [p.folder, ...(typeof m.id === 'string' ? [m.id] : [])], keywords: ['plugin', ...(Array.isArray(m.provides) ? m.provides.map((x) => String(x).split(':')[0]) : [])], tags: ['plugin'],
      ...(offConsole ? { surfaces: { rest: false, mcp: false }, gaps: [channelGap('rest'), channelGap('mcp')] } : {}), source: src('plugin@1') });
    // what it provides
    const provides = Array.isArray(m.provides) ? m.provides.map(String) : [];
    const views = provides.filter((x) => x.startsWith('view:'));
    for (const pr of provides) {
      const [kind, ...restParts] = pr.split(':');
      const pname = restParts.join(':');
      const make = PROVIDES[kind];
      if (!make || !pname) continue;
      if (kind === 'action' && entry?.commands.some((c) => c.run?.action === pname)) continue; // the command entry covers it
      const d = make(app, p.folder, pname);
      const label = kind === 'view' && views.length === 1 ? name : kind === 'settings-tab' ? `${name} settings` : kind === 'dialog' ? `${humanize(pname)} dialog` : kind === 'action' ? `${name}: ${humanize(pname)}` : `${name} ${kind.replace('-', ' ')}`;
      const actions = d.run ? [{ id: 'open', label: `Open ${label}`, effect: 'navigate', run: d.run, surfaces: { mcp: kind === 'view' ? 'console_open' : kind === 'dialog' ? 'console_dialog' : kind === 'settings-tab' ? 'console_settings' : 'console_action', cli: `axf console ${kind === 'view' ? 'open' : kind === 'dialog' ? 'dialog' : kind === 'settings-tab' ? 'settings' : 'action'} ${d.open?.target ?? pname}` } },
        ...(kind === 'dialog' ? [{ id: 'close', label: `Close ${label}`, effect: 'navigate', run: `control:console.dialogs/act/close/${pname}`, surfaces: { mcp: 'console_dialog', cli: `axf console dialog close ${pname}` } }] : [])] : [];
      if (kind === 'action') { actions[0] = { id: 'run', label, effect: DESTRUCTIVE.test(pname) ? 'destructive' : /(^|[.:_-])(open|show|settings|view|focus|toggle|help|pick)$/i.test(pname) ? 'navigate' : 'write', run: d.run, params: [cleanParam({ name: 'args', type: 'array', items: 'string', description: 'its arguments, when it takes any' })], surfaces: { mcp: 'console_action', cli: `axf console action ${pname}` } }; }
      out.push({ id: d.id, type: d.type, owner: app, label, description: kind === 'view' && views.length === 1 ? String(m.description ?? '').slice(0, 2000) : '', where: { app, plugin: p.folder, ...d.where, file }, ...(d.open ? { open: d.open } : {}),
        actions, aliases: [pr, ...(d.aliases ?? []), ...(kind === 'view' && views.length === 1 ? [p.folder] : [])], keywords: [kind, p.folder], tags: [kind], parent: `${app}/plugin/${p.folder}`,
        ...(!actions.length ? { gaps: [{ what: 'actions', why: `a ${kind} declares nothing to run by itself; its controls are reached as console elements (console.elements) once registered`, plan: 'full-api-cli-control s7' }] } : {}),
        ...(offConsole ? { surfaces: { rest: false, mcp: false }, gaps: [...(!actions.length ? [] : []), channelGap('rest'), channelGap('mcp')] } : {}), source: src('plugin@1') });
    }
    // its commands and reads (plugin-commands@1)
    for (const c of entry?.commands ?? []) {
      commands.set(`${p.folder}/${c.id}`, c);
      const isRead = c.kind === 'read';
      const method = isRead ? 'GET' : c.effect === 'destructive' ? 'DELETE' : 'POST';
      const params = paramsFromSchema(c.input);
      out.push({ id: `${app}/tool/${p.folder}/${c.id}`, type: 'tool', owner: app, label: c.title || humanize(c.id), description: c.description ?? '', where: { app, plugin: p.folder, ...(c.run?.route ? { route: `${c.run.route.method} /api/plugins/${p.folder}${c.run.route.path}` } : {}), file },
        ...(isRead ? { state: { read: `${p.folder}/${c.id}`, ...(c.output ? { shape: c.output } : {}) } } : {}),
        actions: [{ id: isRead ? 'read' : 'run', label: c.title || humanize(c.id), effect: c.effect, run: `${p.folder}/${c.id}`, params, ...(c.confirm ? { confirm: true } : {}), permission: `control.plugins.${c.effect === 'read' ? 'read' : c.effect === 'destructive' ? 'delete' : 'write'}`, ...(c.output ? { output: c.output } : {}),
          surfaces: offConsole ? { rest: false, mcp: false, cli: false } : { rest: `${method} /api/control/${p.folder}/${c.id}`, mcp: commandToolName(p.folder, c.id, app), cli: `axf ${p.folder} ${c.id}` } }],
        aliases: [`${p.folder}/${c.id}`, `${app}:${p.folder}/${c.id}`], keywords: [p.folder, c.id, c.kind, c.source ?? ''], tags: ['command', c.effect], parent: `${app}/plugin/${p.folder}`,
        ...(offConsole ? { surfaces: { rest: false, mcp: false, cli: false }, gaps: [channelGap('rest'), channelGap('mcp'), channelGap('cli')] } : {}), source: src('plugin-commands@1') });
    }
    for (const e of entry?.errors ?? []) errors.push(`${file}: ${e}`);
  }
  return { entries: out, commands, plugins, errors };
}

/* ================================================================== ui-api@1 + voice + declared */

/** AmberX registerVoiceCommands calls as voice intents, per plugin. */
export function collectAmberxVoice() {
  const out = []; const errors = [];
  const base = join(ROOT, 'apps/amberx-droid/src/plugins');
  if (!existsSync(base)) return { intents: out, errors };
  for (const folder of readdirSync(base).sort()) {
    const web = join(base, folder, 'web');
    if (folder.startsWith('_') || !existsSync(web)) continue;
    for (const f of readdirSync(web).filter((n) => /\.(tsx?|mjs)$/.test(n) && !/\.test\./.test(n))) {
      const { commands, unread } = scanVoiceCommands(read(join(web, f)), rel(join(web, f)));
      for (const u of unread) errors.push(`${u.file}:${u.line}: ${u.why}`);
      for (const c of commands) out.push({ app: 'amberx-droid', folder, file: rel(join(web, f)), intent: { id: c.id, phrases: c.phrases, run: `action:${c.action}`, ...(c.reply ? { reply: c.reply } : {}) } });
    }
  }
  return { intents: out, errors };
}

/** Declarations: plugin.json `control` blocks and registry.d/*.json files, in that order. */
export function collectDeclarations(plugins) {
  const out = [];
  for (const p of plugins) if (p.manifest?.control !== undefined) out.push({ file: `${p.dir}/plugin.json`, declaration: p.manifest.control, app: p.app, folder: p.folder });
  out.push(...appDeclarationFiles(ROOT));
  if (existsSync(DECL_DIR)) for (const f of readdirSync(DECL_DIR).filter((n) => n.endsWith('.json')).sort()) { const d = readJson(join(DECL_DIR, f)); out.push({ file: rel(join(DECL_DIR, f)), declaration: d ?? { $axf: REGISTRY_FRAME, error: 'not JSON' } }); }
  return out;
}

/* ================================================================== all together */

/**
 * Every entry from every collector, merged in order (control, plugins, ui-api, voice, declared). → { entries, owners,
 * errors, collectors }. Errors are facts about declarations (not JSON, a bad ref, a missing entry), never guesses.
 */
export function collectAll({ apps = null, collectors = COLLECTORS } = {}) {
  const on = new Set(collectors);
  const errors = [];
  let entries = [];
  const owners = [];
  if (on.has('control')) entries.push(...collectControl());
  let plugins = []; let commands = new Map();
  if (on.has('plugins')) { const r = collectPlugins({ apps }); entries.push(...r.entries); plugins = r.plugins; commands = r.commands; errors.push(...r.errors); }
  else plugins = readPlugins({ apps });
  if (on.has('ui-api')) for (const p of plugins) { const r = applyUiApi(entries, p.manifest, { app: p.app, folder: p.folder, commands, file: `${p.dir}/plugin.json` }); entries = r.entries; errors.push(...r.errors); }
  if (on.has('voice')) {
    for (const p of plugins) { const { intents, errors: e1 } = readVoiceIntents(p.manifest, { file: `${p.dir}/plugin.json` }); errors.push(...e1); if (intents.length) { const r = applyVoiceIntents(entries, intents, { app: p.app, folder: p.folder, file: `${p.dir}/plugin.json` }); entries = r.entries; errors.push(...r.errors); } }
    const ax = collectAmberxVoice(); errors.push(...ax.errors);
    for (const { app, folder, file, intent } of ax.intents) { const r = applyVoiceIntents(entries, [intent], { app, folder, file }); entries = r.entries; errors.push(...r.errors); }
  }
  if (on.has('console')) { const have = new Set(entries.map((e) => e.id)); entries.push(...[...collectSettingsRegistries(ROOT, plugins), ...collectDisplayOptions(ROOT), ...collectAppPlugins(ROOT)].filter((e) => !have.has(e.id))); }
  if (on.has('declared')) for (const d of collectDeclarations(plugins)) { const r = applyDeclaration(entries, d.declaration, { file: d.file }); entries = r.entries; owners.push(...r.owners); errors.push(...r.errors); }
  if (on.has('console')) { applyConventions(entries); generatePhrases(entries); }
  return { entries, owners, errors, collectors: [...on] };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const json = process.argv.includes('--json');
  const r = collectAll();
  if (json) console.log(JSON.stringify(r));
  else { const by = r.entries.reduce((m, e) => { m[e.type] = (m[e.type] ?? 0) + 1; return m; }, {}); console.log(`${r.entries.length} entries (${Object.entries(by).map(([k, v]) => `${k} ${v}`).join(', ')}) from ${r.collectors.join(', ')}${r.errors.length ? `\n${r.errors.map((e) => `  ✗ ${e}`).join('\n')}` : ''}`); }
}
