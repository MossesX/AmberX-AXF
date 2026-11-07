#!/usr/bin/env node
/**
 * The API registry (api-registry@1; build full-api-control addendum, Nov 7 2026, Brett: "A real, polished API Browser
 * plugin in the console listing EVERY API path … from one generated registry").
 *
 * One list of every way in, made from the sources that already define them, so nothing is written twice:
 *   control@1     every target × op (and act verb) from core/engines/control-rules.mjs: REST POST /api/control,
 *                 MCP control_<op> (+ the console_* shortcuts), CLI axf control … / axf console …
 *   plugins       every plugin read and command (plugin-commands@1 registry): REST /api/control/<plugin>/<command>,
 *                 MCP <plugin>_<command>, CLI axf <plugin> <command>
 *   mcp           every other tool the console's MCP server publishes (apps/console-web/server/mcp_server.py)
 *   rest          every route the console server itself answers (apps/console-web/server/main.py)
 *   cli           every axf CLI command (framework/cli/axf.mjs)
 * Each entry: id, group, title, doc, effect (read | navigate | write | destructive | person), policy (instant | veto |
 * confirm | approve | person: what axHub does with a remote call), input schema, rest / mcp / cli names, and `ui` = the
 * UI elements it stands for (api-coverage@1, framework/cli/api-coverage.mjs).
 *
 *   node framework/cli/api-registry.mjs [--json]      summary (or the whole registry)
 *   node framework/cli/api-registry.mjs find <words>  entries matching
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONTROL_TARGETS, CONTROL_EFFECT, controlEffectOf, controlPermission } from '../core/engines/control-rules.mjs';
import { CONSOLE_TOOLS } from '../core/engines/console-commands.mjs';
import { pluginCommandTools } from '../core/engines/plugin-commands.mjs';
import { registry as pluginRegistry } from './plugin-commands.mjs';
import { apiNames, build as buildCoverage } from './api-coverage.mjs';

export const ROOT = resolve(process.env.AXF_ROOT || join(dirname(fileURLToPath(import.meta.url)), '../..'));
export const FRAME = 'api-registry@1';
export const GROUPS = ['control', 'plugins', 'mcp', 'rest', 'cli'];
export const POLICIES = ['instant', 'veto', 'confirm', 'approve', 'person'];
const read = (p) => { try { return readFileSync(join(ROOT, p), 'utf8'); } catch { return ''; } };

/** What axHub does with a remote call of this effect (framework/spec/CONTROL.md → Recommended axHub policy). */
export function policyOf(effect) {
  switch (effect) {
    case 'read': case 'navigate': return 'instant';
    case 'destructive': return 'confirm';
    case 'person': return 'person';
    case 'approve': return 'approve';
    default: return 'veto';
  }
}

/** Which console_* shortcut tool stands for a control@1 command (the MCP names Claude sessions use most). */
const SHORTCUT = {
  'console.screens/act/open': 'console_open', 'console.dialogs/act/open': 'console_dialog', 'console.dialogs/act/close': 'console_dialog',
  'console.settings/act/open': 'console_settings', 'console.actions/act/run': 'console_action', 'console.nav/act/back': 'console_back',
  'console.nav/act/home': 'console_back', 'console.nav/act/close': 'console_back', 'console.nav/act/refresh': 'console_refresh', 'console.nav/get': 'console_where',
  'console.clients/list': 'console_clients', 'console.screens/list': 'console_list', 'console.dialogs/list': 'console_list', 'console.settings/list': 'console_list',
  'console.actions/list': 'console_list', 'console.values/list': 'console_list', 'console.values/get': 'console_value', 'console.values/set': 'console_value',
  'console.values/reset': 'console_value', 'console.elements/list': 'console_elements', 'console.elements/get': 'console_elements',
  ...Object.fromEntries(['press', 'toggle', 'set', 'focus', 'context'].map((v) => [`console.elements/act/${v}`, 'console_press'])),
};

const fieldSchema = (decl) => (decl === 'object' ? { type: 'object' } : decl === 'object[]' ? { type: 'array', items: { type: 'object' } } : decl === 'string[]' ? { type: 'array', items: { type: 'string' } } : typeof decl === 'string' && decl.startsWith('enum:') ? { enum: decl.slice(5).split(',') } : { type: String(decl ?? 'string').replace('|null', '') });

/** control@1: one entry per target × op (act: per verb). */
export function controlEntries() {
  const out = [];
  for (const [target, t] of Object.entries(CONTROL_TARGETS)) {
    for (const op of t.ops) {
      const verbs = op === 'act' ? Object.keys(t.acts ?? {}) : [null];
      for (const verb of verbs) {
        const effect = controlEffectOf(target, op, verb ?? undefined) ?? CONTROL_EFFECT[op];
        const key = verb ? `${target}/act/${verb}` : `${target}/${op}`;
        const props = { op: { const: op }, target: { const: target } };
        const required = ['op', 'target'];
        if (['get', 'set', 'remove', 'act'].includes(op) || (op === 'reset' && t.paths !== 'entity')) { props.path = { type: 'string', description: t.paths === 'entity' ? 'the record id' : t.pathShape ?? 'the id, key or name' }; if (op !== 'reset') required.push('path'); }
        if (op === 'set' || op === 'add') { props.value = t.fields ? { type: 'object', properties: Object.fromEntries(Object.entries(t.fields).map(([k, d]) => [k, fieldSchema(d)])) } : { description: 'the new value' }; required.push('value'); }
        if (op === 'list' && t.select) props.select = { type: 'object', properties: Object.fromEntries(Object.entries(t.select).map(([k, d]) => [k, fieldSchema(d)])) };
        if (verb) { props.action = { const: verb }; required.push('action'); const want = t.acts[verb] ?? {}; props.input = { type: 'object', properties: { ...Object.fromEntries(Object.entries(want).map(([k, d]) => [k, fieldSchema(d)])), ...(t.domain === 'console' ? { to: { type: 'string', description: 'recent | all | a client id' } } : {}) } }; }
        if (effect === 'destructive' || target === 'console.elements') props.confirm = { type: 'string', description: 'the confirm token the first try answered with' };
        props.reason = { type: 'string' }; props.by = { type: 'string' };
        const shortcut = SHORTCUT[key];
        out.push({
          id: `control/${key}`, group: 'control', area: t.domain, title: `${verb ?? op} · ${t.label}`, doc: t.doc, target, op, ...(verb ? { verb } : {}),
          effect, policy: policyOf(effect), permission: controlPermission(target, op, verb ?? undefined),
          input: { type: 'object', properties: props, required },
          rest: { method: 'POST', path: '/api/control', body: { op, target, ...(verb ? { action: verb } : {}) } },
          mcp: [`control_${op}`, ...(shortcut ? [shortcut] : [])],
          cli: op === 'act' ? `axf control act ${target} <path> ${verb} [json input]` : `axf control ${op} ${target}${['get', 'set', 'remove', 'reset'].includes(op) ? ' <path>' : ''}${op === 'set' ? ' <value>' : ''}`,
          docs: 'framework/spec/CONTROL.md',
        });
      }
    }
  }
  return out;
}

/** Every plugin read and command (plugin-commands@1). */
export function pluginEntries() {
  const reg = pluginRegistry({ apps: ['console-web'] });
  const tools = new Map(pluginCommandTools(reg).map((x) => [`${x.plugin}/${x.command}`, x.name]));
  const out = [];
  for (const p of reg.plugins) {
    for (const c of p.commands ?? []) {
      const effect = c.effect ?? (c.kind === 'read' ? 'read' : 'write');
      const route = c.run?.route ? `${c.run.route.method} ${c.run.route.path}` : c.run?.action ? `action ${c.run.action}` : c.run?.data ? 'data folder' : 'info';
      out.push({
        id: `plugins/${p.folder}/${c.id}`, group: 'plugins', area: p.folder, plugin: p.folder, title: c.title || c.id, doc: c.description ?? '', command: c.id, runs: route,
        effect, policy: policyOf(effect), permission: `control.plugins.${effect === 'read' ? 'read' : effect === 'destructive' ? 'delete' : 'write'}`,
        input: c.input ?? { type: 'object' }, ...(c.output ? { output: c.output } : {}),
        rest: { method: effect === 'read' ? 'GET' : effect === 'destructive' ? 'DELETE' : 'POST', path: `/api/control/${p.folder}/${c.id}` },
        mcp: [tools.get(`${p.folder}/${c.id}`) ?? `${p.folder}_${c.id}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64)],
        cli: `axf ${p.folder} ${c.id}`, docs: `apps/console-web/plugins/${p.folder}/README.md`,
      });
    }
    for (const s of p.skipped ?? []) {
      const why = String(s.why ?? s.skip ?? '');
      out.push({ id: `plugins/${p.folder}/~${String(s.route ?? s.id ?? '').replace(/\s+/g, ' ')}`, group: 'plugins', area: p.folder, plugin: p.folder, title: String(s.route ?? s.id ?? ''), doc: why,
        effect: /person|tap|brett|signed-in/i.test(why) ? 'person' : 'read', policy: /person|tap|brett|signed-in/i.test(why) ? 'person' : 'instant', skipped: true, input: { type: 'object' }, rest: null, mcp: [], cli: '' });
    }
  }
  return out;
}

/** MCP tools of the console's own server (mcp_server.py), with their annotation and first doc line. */
export function mcpEntries(exclude = new Set()) {
  const src = read('apps/console-web/server/mcp_server.py');
  const out = [];
  for (const m of src.matchAll(/@mcp\.tool\(([^)]*)\)\s*\n\s*async def ([a-z_0-9]+)\(([^)]*)\)[^:]*:\s*\n\s*"""([^]*?)"""/g)) {
    const name = m[2];
    if (exclude.has(name)) continue;
    const ann = m[1];
    const effect = /DESTRUCT/.test(ann) ? 'destructive' : /NAVIGATE/.test(ann) ? 'navigate' : /READ/.test(ann) ? 'read' : 'write';
    const params = m[3].split(',').map((x) => x.trim()).filter((x) => x && x !== 'self');
    const props = Object.fromEntries(params.map((x) => { const [n, rest = ''] = x.split(':'); const typ = rest.split('=')[0].trim(); return [n.trim(), { type: /int|float/.test(typ) ? 'number' : /bool/.test(typ) ? 'boolean' : /list/.test(typ) ? 'array' : /dict/.test(typ) ? 'object' : 'string', ...(rest.includes('=') ? { default: rest.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '') } : {}) }]; }));
    const required = params.filter((x) => !x.includes('=')).map((x) => x.split(':')[0].trim());
    const doc = m[4].replace(/\s+/g, ' ').trim();
    out.push({ id: `mcp/${name}`, group: 'mcp', area: name.split('_')[0], title: name, doc, effect, policy: policyOf(effect), input: { type: 'object', properties: props, required }, rest: { method: 'POST', path: '/mcp', body: { tool: name } }, mcp: [name], cli: '', docs: 'apps/console-web/server/mcp_server.py' });
  }
  return out;
}

/** Routes the console server answers itself (main.py), first doc line each. */
export function restEntries() {
  const src = read('apps/console-web/server/main.py');
  const out = [];
  for (const m of src.matchAll(/@app\.(get|post|put|patch|delete)\(\s*"([^"]+)"/g)) {
    const method = m[1].toUpperCase();
    const after = src.slice(m.index, m.index + 3000);
    m[4] = after.match(/\n\s*(?:async )?def [a-z_0-9]+\([^]*?\)[^:\n]*:\s*\n\s*"""([^]*?)"""/)?.[1] ?? '';
    const effect = method === 'GET' ? 'read' : method === 'DELETE' ? 'destructive' : 'write';
    out.push({ id: `rest/${method} ${m[2]}`, group: 'rest', area: m[2].split('/')[2] ?? 'api', title: `${method} ${m[2]}`, doc: (m[4] ?? '').replace(/\s+/g, ' ').trim(), effect, policy: policyOf(effect), input: { type: 'object' }, rest: { method, path: m[2] }, mcp: [], cli: '', docs: 'apps/console-web/server/main.py' });
  }
  return out;
}

/** axf CLI commands (axf.mjs's own; plugin and control commands are listed with their entries). */
export function cliEntries() {
  const src = read('framework/cli/axf.mjs');
  const out = [];
  const seen = new Set();
  for (const m of src.matchAll(/case '([a-z][a-z0-9-]*)':/g)) {
    if (seen.has(m[1])) continue; seen.add(m[1]);
    const near = src.slice(m.index, m.index + 600);
    const usage = near.match(/usage:? ?([^'`"\n]{4,160})/i)?.[1] ?? '';
    out.push({ id: `cli/${m[1]}`, group: 'cli', area: 'axf', title: `axf ${m[1]}`, doc: usage.trim(), effect: /^(list|validate|schemas|libraries|modules|templates|boilerplates|ported-kits|library-templates)$/.test(m[1]) ? 'read' : 'write', policy: 'instant', input: { type: 'object' }, rest: null, mcp: [], cli: `axf ${m[1]}`, local: true, docs: 'framework/cli/axf.mjs' });
  }
  return out;
}

/** The whole registry: every entry, with the UI elements each stands for. */
export function buildRegistry() {
  const control = controlEntries();
  const plugins = pluginEntries();
  const mcp = mcpEntries(new Set([...CONSOLE_TOOLS, 'control_list', 'control_get', 'control_set', 'control_reset', 'control_add', 'control_remove', 'control_act']));
  const rest = restEntries();
  const cli = cliEntries();
  const entries = [...control, ...plugins, ...mcp, ...rest, ...cli];
  // UI elements → the entry they map to (api-coverage@1)
  const coverage = buildCoverage();
  const byKey = new Map();
  for (const x of coverage.items) {
    if (!x.api) continue;
    const [target, verb, ...rest2] = x.api.split(' ');
    const key = target === 'plugins.commands' || target === 'plugins.reads' ? `plugins/${rest2.join(' ')}`
      : ['console.screens', 'console.dialogs', 'console.settings', 'console.actions', 'console.elements'].includes(target) ? `control/${target}/act/${verb === 'run' || verb === 'open' ? verb : verb}`
        : target === 'console.values' ? `control/console.values/${verb}` : '';
    if (!key) continue;
    const list = byKey.get(key) ?? []; list.push(x); byKey.set(key, list);
  }
  for (const en of entries) {
    const ui = byKey.get(en.id);
    if (ui?.length) { en.uiCount = ui.length; en.ui = ui.slice(0, 40).map((x) => ({ kind: x.kind, label: x.label || x.id, where: x.where, file: x.file, path: x.api.split(' ').slice(2).join(' ') })); }
  }
  const count = (f) => entries.reduce((m, x) => { const k = f(x); m[k] = (m[k] ?? 0) + 1; return m; }, {});
  return {
    $axf: FRAME, generatedAt: new Date().toISOString(),
    summary: { entries: entries.length, byGroup: count((x) => x.group), byPolicy: count((x) => x.policy), mcpTools: new Set(entries.flatMap((x) => x.mcp ?? [])).size, uiElements: coverage.summary.elements, uiGaps: coverage.summary.gap },
    entries,
    coverage: coverage.items.map((x) => ({ ...x, ...apiNames(x) })),
    coverageSummary: coverage.summary,
  };
}

function main(argv) {
  const json = argv.includes('--json');
  const [cmd = 'summary', ...rest] = argv.filter((a) => a !== '--json');
  const reg = buildRegistry();
  if (cmd === 'find') {
    const words = rest.join(' ').toLowerCase().split(/\s+/).filter(Boolean);
    const hits = reg.entries.filter((x) => words.every((w) => `${x.id} ${x.title} ${x.doc} ${x.mcp.join(' ')} ${x.cli}`.toLowerCase().includes(w)));
    console.log(json ? JSON.stringify(hits, null, 1) : hits.map((x) => `${x.policy.padEnd(8)} ${x.id.padEnd(48)} ${x.title}`).join('\n') || 'nothing matches');
    return 0;
  }
  if (json) { console.log(JSON.stringify(reg)); return 0; }
  const s = reg.summary;
  console.log(`${s.entries} API paths (${Object.entries(s.byGroup).map(([k, v]) => `${k} ${v}`).join(', ')}); ${s.mcpTools} MCP tools; policy ${Object.entries(s.byPolicy).map(([k, v]) => `${k} ${v}`).join(', ')}; UI ${s.uiElements} elements, ${s.uiGaps} gaps`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
