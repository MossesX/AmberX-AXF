#!/usr/bin/env node
/**
 * Molly menus: API parity (flagship skin s11). Every REST command this plugin serves has the same command on MCP, the
 * CLI and AmberX voice; and every look choice the API sets is a choice on Molly's menu rows with the same values.
 *
 *   node apps/console-web/plugins/molly-menus/test.mjs
 *
 * REST, MCP and CLI come from one registry (plugin-commands@1), so they can't drift; voice is a hand-written library
 * (AmberX lib-developer.ts), so this checks each REST command has a voice command whose task calls its MCP tool.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registry } from '../../../../framework/cli/plugin-commands.mjs';
import { pluginCommandCli, pluginCommandRoutes, pluginCommandTools } from '../../../../framework/core/engines/plugin-commands.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../../..');
const PLUGIN = 'molly-menus';
const AUTO = new Set(['info', 'data', 'data-file']);
let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  ${detail}`}`); if (!ok) fails++; };

const reg = registry();
const routes = pluginCommandRoutes(reg).filter((r) => r.path.startsWith(`/api/control/${PLUGIN}/`));
const commands = routes.map((r) => r.path.split('/').pop()).filter((id) => !AUTO.has(id));
check('REST serves every Molly command', ['state', 'tree', 'choices', 'set-choice', 'skin', 'set-skin', 'invoke', 'links', 'status', 'overrides', 'set-override', 'reset-override'].every((c) => commands.includes(c)), commands.join(', '));

const tools = new Set(pluginCommandTools(reg).map((t) => t.name));
const cli = JSON.stringify(pluginCommandCli(reg));
const voice = readFileSync(join(ROOT, 'apps/amberx-droid/src/plugins/commands/web/lib-developer.ts'), 'utf8');
for (const id of commands) {
  const tool = `molly_menus_${id.replace(/-/g, '_')}`;
  check(`${id}: MCP ${tool}`, tools.has(tool));
  check(`${id}: CLI axf ${PLUGIN} ${id}`, cli.includes(`${PLUGIN} ${id}`));
  check(`${id}: voice command calls ${tool}`, new RegExp(`A\\('Molly', '[a-z-]+'[^\\n]*\\b${tool}\\b`).test(voice));
}

// the server routes and the commands block name the same routes (a route without a declared command would still be
// projected, but without a title, description or input schema)
const server = readFileSync(join(HERE, 'server/__init__.py'), 'utf8');
const declared = JSON.parse(readFileSync(join(HERE, 'plugin.json'), 'utf8')).commands.items.map((i) => i.route);
const served = [...server.matchAll(/@router\.(get|put|post|patch|delete)\("([^"]+)"\)/g)].map((m) => `${m[1].toUpperCase()} ${m[2]}`);
check('every server route is a declared command', served.every((r) => declared.includes(r)), served.filter((r) => !declared.includes(r)).join(', '));
check('every declared command is a server route', declared.every((r) => served.includes(r)), declared.filter((r) => !served.includes(r)).join(', '));

// the look choices the API sets = the choice rows on Molly's menus, same keys, same values
const choices = JSON.parse(readFileSync(join(ROOT, 'apps/molly/menus/choices.json'), 'utf8')).choices;
const rows = [];
const walk = (items = []) => { for (const i of items) { if (i.setting) rows.push(i); walk(i.items); } };
const appMenu = JSON.parse(readFileSync(join(ROOT, 'apps/molly/src/assets/app-menu/molly.json'), 'utf8'));
const ctxMenu = JSON.parse(readFileSync(join(ROOT, 'apps/molly/src/assets/context-menu/molly.json'), 'utf8'));
for (const m of appMenu.data.menus) walk(m.items);
for (const t of Object.values(ctxMenu.data.targets)) walk(t);
for (const c of choices) {
  const mine = rows.filter((r) => r.setting === c.key);
  check(`choice ${c.id}: on the app menu`, mine.length > 0);
  for (const r of mine) check(`choice ${c.id}: row ${r.id} offers the API's values`, JSON.stringify(r.choices.map((x) => x.value)) === JSON.stringify(c.values), `${r.choices.map((x) => x.value)} vs ${c.values}`);
}
check('every choice row on the menus is an API choice', rows.every((r) => choices.some((c) => c.key === r.setting)), rows.filter((r) => !choices.some((c) => c.key === r.setting)).map((r) => r.id).join(', '));

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
