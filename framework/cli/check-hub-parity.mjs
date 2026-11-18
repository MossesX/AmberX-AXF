#!/usr/bin/env node
/**
 * check-hub-parity — every axHub web page and action has its console twin on every transport (hub-console@1,
 * framework/spec/HUB-CONSOLE.md; build move-everything-axhub-web-console s27). Walks the route table
 * framework/schemas/hub-console.json and fails when any screen or action lacks:
 *
 *   screen      a renderer in the Hub plugin's web part (SCREEN_RENDERERS in plugins/hub-admin/web/index.tsx)
 *   deep link   the tab row id `hub.tabs` on the page and the `hub.<screen>` action every screen gets (actions.ts)
 *   REST        the plugin's server route: GET /<screen>, GET /<screen>/{row} when the screen has a row read,
 *               POST /<screen>[/{row}]/<action> (DELETE /<screen>/{row} for a row-removing action) per action
 *   MCP         the plugin-commands registry tool: the table's read tools, and every non-person action's tool
 *   CLI         `axf hub <screen>` (hub.mjs cliWords) and `axf hub <screen> <action>` planning to that route
 *   voice       the `hub.<screen>` action (voice runs console actions by id) and `hub.<alias>` for aliases
 *   person      a person action is NEVER a tool: its route is skipped in the registry and it plans to no CLI line
 *   replaces    every axHub web hash route the table lists maps to a screen (routeToScreen), and every route axHub web
 *               ships today (apps/axhub-web/src/App.tsx views + hub/core.ts routes) is replaced or deferred
 *
 *   node framework/cli/check-hub-parity.mjs [--json]
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as hc from '../core/hub-console.mjs';
import { pluginCommandRegistry } from '../core/engines/plugin-commands.mjs';
import { readPlugin } from './plugin-commands.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const table = JSON.parse(read('framework/schemas/hub-console.json'));
hc.assertHubConsole(table);
const PLUGIN_DIR = `apps/console-web/plugins/${table.plugin}`;
const problems = [];
const miss = (what, where) => problems.push({ what, where });

// the plugin's facts: routes (server), actions (web), the command registry (tools, skips)
const plugin = readPlugin('console-web', 'apps/console-web/plugins', table.plugin);
const registry = pluginCommandRegistry([plugin]);
const entry = registry.plugins.find((p) => p.folder === table.plugin);
const tools = new Map(entry.commands.map((c) => [c.tool ?? c.id, c]));
const toolNames = new Set(entry.commands.map((c) => c.tool).filter(Boolean));
const skippedRoutes = new Set(entry.skipped.map((s) => s.route).filter(Boolean));
const routes = new Set(plugin.routes.map((r) => `${r.method} ${r.path}`));
const indexSrc = read(`${PLUGIN_DIR}/web/index.tsx`);
const actionsSrc = read(`${PLUGIN_DIR}/web/actions.ts`);
const cli = await import(pathToFileURL(join(ROOT, PLUGIN_DIR, 'hub.mjs')).href);

// every screen: renderer, tab row, read route + tool, row read, actions
if (!/id="hub\.tabs"/.test(indexSrc)) miss('the Hub tab row id hub.tabs is not a literal on the page', 'web/index.tsx');
if (!/on\(`hub\.\$\{s\.id\}`/.test(actionsSrc)) miss('no hub.<screen> action per screen (voice / deep link)', 'web/actions.ts');
if (!/for \(const alias of s\.aliases/.test(actionsSrc)) miss('no hub.<alias> action per alias (voice)', 'web/actions.ts');
for (const s of hc.screensOf(table)) {
  if (!new RegExp(`^\\s*${s.id}: \\(screen\\) =>`, 'm').test(indexSrc)) miss(`screen ${s.id} has no renderer`, 'web/index.tsx SCREEN_RENDERERS');
  if (!routes.has(`GET /${s.id}`)) miss(`screen ${s.id} has no REST read`, `server: GET /${s.id}`);
  if (!toolNames.has(s.state.tool)) miss(`screen ${s.id} read tool ${s.state.tool} is not an MCP tool`, 'plugin.json commands.items');
  if (!cli.cliWords.includes(s.id)) miss(`screen ${s.id} is not an axf hub word`, 'hub.mjs cliWords');
  for (const al of s.aliases ?? []) if (!cli.cliWords.includes(al)) miss(`alias ${al} of ${s.id} is not an axf hub word`, 'hub.mjs cliWords');
  const plan = cli.plan([s.id]);
  if (plan.error || plan.path !== `/${s.id}`) miss(`axf hub ${s.id} does not plan GET /${s.id}`, 'hub.mjs plan');
  if (s.rows?.read) {
    if (!routes.has(`GET /${s.id}/{row}`)) miss(`screen ${s.id} has no row read route`, `server: GET /${s.id}/{row}`);
    if (!toolNames.has(s.rows.read.tool)) miss(`row read tool ${s.rows.read.tool} is not an MCP tool`, 'plugin.json commands.items');
  }
  const sample = s.id === 'approvals' ? '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0' : s.id === 'handoff' ? '20261117-093000-ab12' : 'sample-row';
  for (const a of s.actions) {
    const r = hc.reachesOf(table, s.id, { action: a.id, row: a.row ? sample : null });
    if (!r) { miss(`action ${s.id}/${a.id} has no reaches (row sample ${sample} refused)`, 'hub-console.mjs reachesOf'); continue; }
    const route = r.rest.replace(`/${sample}/`, '/{row}/').replace(new RegExp(`/${sample}$`), '/{row}').replace(`/api/plugins/${table.plugin}`, '');
    if (!routes.has(route)) miss(`action ${s.id}/${a.id} has no REST route`, `server: ${route}`);
    if (a.who === 'person') {
      if (!skippedRoutes.has(route)) miss(`person action ${s.id}/${a.id} is not skipped in the command registry (it would become a tool)`, 'plugin.json commands.items skip');
      if (a.tool || toolNames.has(`hub_${s.id}_${a.id.replace(/-/g, '_')}`)) miss(`person action ${s.id}/${a.id} has an MCP tool`, 'plugin.json');
      const p = cli.plan([s.id, a.id, ...(a.row ? [sample] : [])]);
      if (!p.error) miss(`person action ${s.id}/${a.id} plans a CLI line`, 'hub.mjs plan');
      continue;
    }
    const tool = hc.toolOf(table, s.id, a.id);
    if (!toolNames.has(tool)) miss(`action ${s.id}/${a.id} tool ${tool} is not an MCP tool`, 'plugin.json commands.items');
    const cmd = tools.get(tool);
    if (a.who === 'confirm' && cmd && !cmd.confirm) miss(`confirm action ${s.id}/${a.id} is a tool without confirm`, 'plugin.json commands.items');
    const p = cli.plan([s.id, a.id, ...(a.row ? [sample] : [])]);
    const want = r.rest.replace(`/api/plugins/${table.plugin}`, '');
    if (p.error || `${p.method} ${p.path}` !== want) miss(`axf hub ${s.id} ${a.id} plans ${p.error ? p.error : `${p.method} ${p.path}`}, not ${want}`, 'hub.mjs plan');
  }
  for (const hash of s.replaces) {
    const sample = hash.replace(/<[^>]+>/g, s.id === 'handoff' ? '20261117-093000-ab12' : s.id === 'approvals' ? '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0' : 'x');
    const got = hc.routeToScreen(table, sample);
    if (!got || got.screen !== s.id) miss(`${hash} does not land on ${s.id}`, 'routeToScreen');
  }
}

// every route axHub web ships today is replaced or deferred
const appSrc = read('apps/axhub-web/src/App.tsx');
const views = [...appSrc.matchAll(/^\s+'?([a-z][a-z-]*)'?: \{ title:/gm)].map((m) => m[1]);
const replaced = new Set(hc.screensOf(table).flatMap((s) => s.replaces.map((r) => r.replace(/^#\//, '').split(/[/?]/)[0])));
const deferred = new Set(table.deferred.map((d) => d.id));
const VIEW_ROUTE = { home: 'approvals', 'approvals-log': 'approvals', approval: 'approvals', 'go-pass': 'go-pass', 'handoff-run': 'handoff' };
for (const v of views) {
  const route = VIEW_ROUTE[v] ?? v;
  if (!replaced.has(route) && !deferred.has(v) && !deferred.has(route)) miss(`axHub web view ${v} (#/${route}) is neither replaced by a screen nor deferred`, 'framework/schemas/hub-console.json');
}

const out = { ok: problems.length === 0, screens: hc.screensOf(table).length, actions: hc.screensOf(table).reduce((n, s) => n + s.actions.length, 0), tools: toolNames.size, axhubWebViews: views.length, problems };
if (process.argv.includes('--json')) console.log(JSON.stringify(out));
else if (out.ok) console.log(`✓ hub parity — ${out.screens} screens, ${out.actions} actions, ${out.tools} MCP tools, ${out.axhubWebViews} axHub web views all replaced or deferred`);
else { console.error(`✗ hub parity: ${problems.length} gap(s)`); for (const p of problems) console.error(`  ${p.what}  (${p.where})`); }
process.exitCode = out.ok ? 0 : 1;
