#!/usr/bin/env node
// API parity for the serial lander (build land-finish-auto-land-live-clear-backlog, Brett Nov 8 2026: "Everything comes
// with an API"): every lander action is one REST route of this plugin, one plugin command (MCP tool + console command),
// one `axf land <sub>` (plugin.json commands.cliGroups) and the same command for AmberX voice (control@1 plugins domain).
// All four resolve to the same route, so they run the same handler.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { commandToolName, pluginCommandTools, resolvePluginCommand } from '../../../../framework/core/engines/plugin-commands.mjs';
import { registry } from '../../../../framework/cli/plugin-commands.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FOLDER = 'push-banner';
const manifest = JSON.parse(readFileSync(join(HERE, 'plugin.json'), 'utf8'));
const server = readFileSync(join(HERE, 'server/__init__.py'), 'utf8');
const LANDER = {
  'GET /land/lander': 'status', 'GET /land/backlog': 'backlog', 'GET /land/dispatcher': 'dispatcher', 'GET /land/line': 'line',
  'POST /land/one': 'one', 'POST /land/archive': 'archive', 'POST /land/flag': 'flag', 'POST /land/fresh': 'fresh',
};
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; console.log(`ok ${m}`); };

const reg = registry({ folders: [FOLDER] });
const tools = new Set(pluginCommandTools(reg).map((t) => t.name));
const group = manifest.commands?.cliGroups?.land ?? {};
for (const [route, sub] of Object.entries(LANDER)) {
  const [method, path] = route.split(' ');
  const decorator = `@router.${method.toLowerCase()}("${path}")`;
  ok(server.includes(decorator), `REST: ${route} is a route of the plugin server`);
  const item = (manifest.commands?.items ?? []).find((c) => c.route === route);
  ok(item, `MCP / console command: ${route} is declared (plugin-commands@1)`);
  const resolved = resolvePluginCommand(reg, `${FOLDER}/${item.id}`);
  ok(resolved && `${resolved.command.run?.route?.method} ${resolved.command.run?.route?.path}` === route, `voice (control@1 plugins.commands): ${FOLDER}/${item.id} resolves to ${route}`);
  ok(tools.has(commandToolName(FOLDER, item.id)), `MCP tool ${commandToolName(FOLDER, item.id)} exists`);
  ok(group[sub] === item.id, `CLI: axf land ${sub} runs ${item.id} (${route})`);
}
ok(Object.keys(group).every((sub) => Object.values(LANDER).includes(sub)), 'every axf land subcommand is a lander route');
console.log(`api parity: ${n} checks passed`);
