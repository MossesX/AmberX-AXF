#!/usr/bin/env node
/**
 * picker-dialog self-test: node apps/console-web/plugins/picker-dialog/test.mjs
 *
 * 1. API parity: REST routes, MCP / CLI commands (plugin-commands registry), the plugin CLI (picker.mjs) and voice
 *    phrases all reach the same console action (`picker.open:<id>`, `picker.choose:<id>:<option>`, `picker.close:-`)
 *    through the same server handlers.
 * 2. Removable: plugin-lifecycle data dir, install / uninstall scripts, no framework file names this folder.
 * 3. Plugin off = original drop-downs: the jsdom check (framework/spec/check-picker-ui.mts) turns the swap on and off
 *    and compares the native select byte for byte; this test runs it.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../../../..');
let n = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); n++; };

/* ---------------------------------------------------------------- 1. parity */
const py = (code) => execFileSync('python3', ['-c', `import sys, json; sys.path.insert(0, ${JSON.stringify(join(HERE, '../../server'))}); sys.path.insert(0, ${JSON.stringify(HERE)})\nfrom server import routes as r\n${code}`], { encoding: 'utf8' }).trim();

// REST: what each route body becomes
const rest = JSON.parse(py(`print(json.dumps({
  'open': r.action_spec('open', 'theme'),
  'choose': r.action_spec('choose', 'button:picker-theme', 'Dark'),
  'chooseOpen': r.action_spec('choose', None, 'Dark'),
  'close': r.action_spec('close', None),
}))`));
ok(rest.open === 'picker.open:theme' && rest.choose === 'picker.choose:theme:Dark' && rest.chooseOpen === 'picker.choose:-:Dark' && rest.close === 'picker.close:-', `REST → actions ${JSON.stringify(rest)}`);

// voice: the same actions
const voice = JSON.parse(py(`print(json.dumps({p: (lambda i: r.action_spec(i['verb'], i.get('target'), i.get('arg')) if i else None)(r.voice_intent(p)) for p in [
  'open the theme picker', 'choose Dark in the theme picker', 'close the picker', 'Amber, choose dark', 'open settings']}))`));
ok(voice['open the theme picker'] === rest.open, 'voice "open the theme picker" = REST open');
ok(voice['choose Dark in the theme picker'] === 'picker.choose:theme:dark', 'voice "choose Dark in the theme picker" = REST choose (words folded)');
ok(voice['close the picker'] === rest.close, 'voice "close the picker" = REST close');
ok(voice['Amber, choose dark'] === 'picker.choose:-:dark', 'voice "choose dark" = choose in the open picker');
ok(voice['open settings'] === null, 'non-picker phrases are left to the console');

// MCP + `axf picker-dialog …`: the plugin-commands registry exposes the same routes
const reg = JSON.parse(execFileSync('node', [join(ROOT, 'framework/cli/plugin-commands.mjs'), 'registry', '--json'], { encoding: 'utf8' }));
const mine = (reg.plugins ?? reg).find((p) => p.folder === 'picker-dialog');
const cmds = Object.fromEntries((mine?.commands ?? []).map((c) => [c.id, c]));
for (const id of ['state', 'open', 'choose', 'toggle', 'search', 'clear', 'close', 'settings', 'settings-set', 'voice']) ok(cmds[id], `MCP / CLI command ${id}`);
const route = (c) => c?.run?.route ?? {};
ok(route(cmds.open).method === 'POST' && route(cmds.open).path === '/open' && route(cmds.open).body === true, 'MCP / CLI open runs POST /open with a body');
ok(route(cmds.choose).path === '/choose' && route(cmds.choose).body === true && route(cmds.voice).path === '/voice', 'MCP / CLI choose and voice run the same routes');

// the plugin CLI maps onto those commands
const { toCommand } = await import('./picker.mjs');
ok(toCommand('open', ['theme']).join(' ') === 'picker-dialog open --target theme', 'CLI open → command open');
ok(toCommand('choose', ['Dark', 'mode'], 'theme').join(' ') === 'picker-dialog choose --target theme --option Dark mode', 'CLI choose --in → command choose');
ok(toCommand('close', []).join(' ') === 'picker-dialog close', 'CLI close → command close');
ok(toCommand('set', ['searchThreshold', '5']).join(' ') === 'picker-dialog settings-set --searchThreshold 5', 'CLI set → settings-set');

// settings keys agree across the web library, the server and the CLI
const webKeys = [...readFileSync(join(HERE, 'web/settings.ts'), 'utf8').matchAll(/'axf\.picker\.(\w+)'/g)].map((m) => m[1]).sort();
const srvKeys = JSON.parse(py('print(json.dumps(sorted(r.SETTINGS)))'));
ok(JSON.stringify(webKeys) === JSON.stringify(srvKeys), `settings keys agree (${webKeys.join(', ')})`);

/* ---------------------------------------------------------------- 2. removable */
const pj = JSON.parse(readFileSync(join(HERE, 'plugin.json'), 'utf8'));
ok(pj.lifecycle?.dataDir === '.axf-console/plugins/picker-dialog', 'lifecycle data dir');
ok(existsSync(join(HERE, 'install.mjs')) && existsSync(join(HERE, 'uninstall.mjs')), 'install + uninstall scripts');
const named = [];
const walk = (d) => { for (const x of readdirSync(d)) { const p = join(d, x); if (x === 'node_modules' || x.startsWith('.')) continue; if (statSync(p).isDirectory()) walk(p); else if (/\.(ts|tsx|mjs|css)$/.test(x) && readFileSync(p, 'utf8').includes('plugins/picker-dialog')) named.push(p); } };
for (const d of ['framework/react', 'framework/core', 'framework/ui']) walk(join(ROOT, d));
ok(!named.length, `the framework never names the plugin folder (${named.join(', ')})`);

/* ---------------------------------------------------------------- 3. off = original drop-downs */
const ui = spawnSync('npx', ['-y', 'tsx', join(ROOT, 'framework/spec/check-picker-ui.mts')], { encoding: 'utf8', cwd: ROOT });
ok(ui.status === 0, `jsdom check (swap on / off restores the select, SelectField routing, API): ${(ui.stdout || ui.stderr).trim().split('\n').pop()}`);

console.log(`✓ picker-dialog — ${n} checks (REST / MCP / CLI / voice parity, removable, plugin off = original drop-downs)`);
