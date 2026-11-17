#!/usr/bin/env node
/**
 * widget-icons@1 parity: every operation is on every channel, and the CLI and the server answer the same.
 *
 *   1. Presence: list / get / set / reset / open on REST (server/widget_icons.py), MCP (server/mcp_server.py),
 *      the CLI (cli/widget-icon.mjs), the console actions (react/widgetIcons.tsx, src/actions/widget-icon-voice.ts)
 *      and control@1 (console.widgeticons).
 *   2. Behaviour: the CLI (JS) and the server (Python) write the same keys and resolve the same list against one
 *      look document, including refusals and voice phrases.
 *
 *   node framework/spec/check-widget-icons-parity.mjs
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };

// ---- 1. presence ----
const rest = read('apps/console-web/server/widget_icons.py');
for (const r of ['@r.get("")', '@r.get("/glyphs")', '@r.get("/{wid}")', '@r.put("/{wid}")', '@r.delete("/{wid}")', '@r.post("/reset")', '@r.post("/{wid}/open")']) ok(rest.includes(r), `REST ${r}`);
ok(read('apps/console-web/server/main.py').includes('widget_icons.router_for(auth)'), 'REST mounted behind auth');
const mcp = read('apps/console-web/server/mcp_server.py');
for (const t of ['widget_icons_list', 'widget_icons_get', 'widget_icons_set', 'widget_icons_reset']) ok(mcp.includes(`async def ${t}(`), `MCP ${t}`);
const cli = read('framework/cli/widget-icon.mjs');
for (const c of ['list', 'get', 'set', 'reset', 'glyphs', 'open']) ok(cli.includes(`case '${c}':`), `CLI ${c}`);
ok(read('framework/cli/axf.mjs').includes("case 'widget-icon':"), 'axf widget-icon');
const acts = read('framework/react/widgetIcons.tsx') + read('apps/console-web/src/actions/widget-icon-voice.ts');
for (const a of ['widget.icons', 'widget.icon', 'widget.mode', 'widget.icons.reset', 'widget.icons.layout', 'widget.icon.set', 'widget.icon.reset']) ok(acts.includes(`register('${a}'`), `console action ${a}`);
const { CONTROL_TARGETS } = await import('../core/engines/control-rules.mjs');
const t = CONTROL_TARGETS['console.widgeticons'];
ok(t && t.ops.includes('list') && t.ops.includes('get'), 'control@1 console.widgeticons list / get');
eq(Object.keys(t.acts).sort(), ['open', 'reset', 'set'], 'control@1 acts');
ok(read('apps/console-web/plugins/console-commands/server/__init__.py').includes('return widget_icons_target('), 'control@1 host handler');

// ---- 2. behaviour: the CLI and the server on one look document ----
const dir = mkdtempSync(join(tmpdir(), 'wi-parity-'));
const look = join(dir, 'axf-console.json');
const fresh = () => writeFileSync(look, JSON.stringify({ $axf: 'app-look@1', app: 'axf-console', default: {}, own: { settings: { keep: 1 } } }));
const env = { ...process.env, AXF_LOOKS_DIR: dir };
const node = (...a) => execFileSync(process.execPath, [join(ROOT, 'framework/cli/widget-icon.mjs'), ...a, '--json'], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const py = (code) => JSON.parse(execFileSync('python3', ['-c', `import json,sys; sys.path.insert(0, ${JSON.stringify(join(ROOT, 'apps/console-web/server'))}); import widget_icons as wi; print(json.dumps(${code}))`], { env, encoding: 'utf8' }));
const pick = (w) => ({ id: w.id, icon: w.icon, via: w.via, mode: w.mode, pick: w.pick, default: w.default });

fresh();
node('set', 'banner:status:project', 'rocket', '--mode', 'icon');
const afterCli = JSON.parse(readFileSync(look, 'utf8')).own.settings;
fresh();
py('wi.set_widget("banner:status:project", icon="rocket", mode="icon")["ok"]');
const afterPy = JSON.parse(readFileSync(look, 'utf8')).own.settings;
eq(afterCli, afterPy, 'CLI and server write the same keys');
const cliList = JSON.parse(node('list')).widgets.map(pick);
const pyList = py('wi.list_widgets()["widgets"]').map(pick);
eq(cliList, pyList, 'CLI and server list the same widgets, icons, sources and modes');
eq(JSON.parse(node('get', 'settings:group:axf.appearance')).widget.icon, py('wi.get_widget("settings:group:axf.appearance")["widget"]["icon"]'), 'same rule default');
for (const bad of [['set', 'banner:status:project', 'nosuchglyph'], ['set', 'banner:status', 'rocket'], ['set', 'banner:status:project', '--mode', 'huge']]) {
  let code = '';
  try { node(...bad); } catch (e) { code = String(e.stderr).match(/✗ ([a-z_]+):/)?.[1] ?? 'error'; }
  ok(code && code !== '', `CLI refuses ${bad.slice(1).join(' ')}`);
}
node('reset');
eq(JSON.parse(readFileSync(look, 'utf8')).own.settings, { keep: 1 }, 'CLI reset all keeps the rest');
// voice: the console grammar (TS) and the server twin (Python) read the same phrases the same way
const phrases = ['use the rocket icon for the project widget', 'set the usage meter icon to star', 'show the ticker as text', 'show the project widget as icon and text', 'reset the project widget icon', 'reset all widget icons', 'scroll down'];
const ts = JSON.parse(execFileSync('npx', ['-y', 'tsx', '-e', `import { widgetVoiceIntent } from ${JSON.stringify(join(ROOT, 'apps/console-web/src/actions/widget-icon-voice.ts'))}; console.log(JSON.stringify(${JSON.stringify(phrases)}.map(widgetVoiceIntent)))`], { encoding: 'utf8', cwd: join(ROOT, 'apps/console-web') }).trim().split('\n').pop());
const pv = py(`[wi.voice_intent(p) for p in ${JSON.stringify(phrases)}]`);
eq(ts, pv, 'voice: console and server read every phrase the same');

console.log(`✓ widget-icons parity — ${n} checks (REST, MCP, CLI, console actions, control@1, voice; CLI = server on one look document)`);
