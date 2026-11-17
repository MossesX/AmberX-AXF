#!/usr/bin/env node
/**
 * Applying the flagship skins through the API (build flagship-professional-skin-covering-2, s24): every flagship skin
 * switches on at every scope (hub-wide, app, UI / screen, plugin) through the one writer, framework/cli/skins.mjs, run
 * against a throw-away hub folder; the resolved skin at each place is the one asked for (child overrides parent); an
 * unknown skin is refused. It also holds the other three ways in to the same writer: the theme-manager REST routes
 * (exposed as MCP by plugin-commands `auto`), the runtime actions (skin.use / skin.scope / skin.inherit) and the Skins
 * plugin's voice action (skin.use <skin> <hub|app|ui:…|plugin:…>), plus the skin map routes and actions.
 *
 *   node framework/spec/check-flagship-apply.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SKINS = ['flagship', 'flagship-graphite', 'flagship-daylight'];
const tmp = mkdtempSync(join(tmpdir(), 'axf-flagship-apply-'));
const env = { ...process.env, AXF_LOOKS_DIR: join(tmp, 'looks'), AXF_APPEARANCE_FILE: join(tmp, 'appearance.json'), AXF_SKINS_DIR: join(tmp, 'skins'), AXF_SKIN_CONFIG_DIR: join(tmp, 'cfg') };
mkdirSync(env.AXF_LOOKS_DIR, { recursive: true });
writeFileSync(env.AXF_APPEARANCE_FILE, '{}\n');
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const cli = (...args) => {
  const r = spawnSync('node', [join(ROOT, 'framework/cli/skins.mjs'), ...args, '--json'], { env, encoding: 'utf8' });
  return JSON.parse(r.stdout || '{}');
};
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

try {
  for (const app of ['console', 'axhub', 'amberx']) ok(cli('snapshot', app).ok, `snapshot ${app}`);
  for (const [i, skin] of SKINS.entries()) {
    const other = SKINS[(i + 1) % SKINS.length];
    const third = SKINS[(i + 2) % SKINS.length];
    ok(cli('global', skin).ok, `${skin}: hub-wide`);
    ok(cli('follow', 'axhub', 'on').ok, 'axhub follows the hub');
    const hub = cli('at', 'axhub').result;
    ok(hub.id === skin && hub.from === 'global', `${skin}: an app that follows the hub resolves it (got ${hub.id} from ${hub.from})`);
    ok(cli('use', 'console', other).ok, `${other}: app`);
    ok(cli('at', 'console').result.id === other, `${other}: the app's own skin wins over the hub-wide one`);
    ok(cli('use', 'console', third, '--scope', 'ui:home').ok, `${third}: ui scope`);
    const ui = cli('at', 'console', '--scope', 'ui:home').result;
    ok(ui.id === third && ui.from === 'ui:home', `${third}: the screen's skin wins inside the screen`);
    ok(cli('use', 'console', skin, '--scope', 'plugin:theme-manager').ok, `${skin}: plugin scope`);
    const pl = cli('at', 'console', '--scope', 'plugin:theme-manager').result;
    ok(pl.id === skin && pl.from === 'plugin:theme-manager', `${skin}: the plugin's skin wins inside the plugin`);
    ok(cli('use', 'amberx', skin).ok && cli('at', 'amberx').result.id === skin, `${skin}: AmberX app scope`);
  }
  ok(cli('use', 'console', 'no-such-skin').ok === false, 'an unknown skin is refused');

  // the other ways in reach the same writer
  const server = read('apps/console-web/plugins/theme-manager/server/__init__.py');
  for (const route of ['@router.post("/skins/global")', '@router.post("/skins/{app}/use")', '@router.post("/skins/{app}/follow")', '@router.get("/skins/{app}/at")', '@router.get("/skin-map")', '@router.get("/skin-map/{slot}")']) ok(server.includes(route), `theme-manager route ${route}`);
  ok(/"auto":\s*true/.test(read('apps/console-web/plugins/theme-manager/plugin.json')), 'theme-manager routes are MCP commands (plugin-commands auto)');
  const runtime = read('framework/core/runtime.ts');
  for (const a of ['skin.use', 'skin.scope', 'skin.inherit']) ok(runtime.includes(`a.register('${a}'`), `runtime action ${a}`);
  const gallery = read('apps/console-web/plugins/skin-gallery/web/actions.ts');
  ok(gallery.includes("rt.actions.register('skin.use'") && gallery.includes('hub|app'), 'voice skin.use <skin> <hub|app|ui:…|plugin:…> (Skins plugin)');
  const map = read('framework/libs/settings/SkinMap.tsx');
  for (const a of ['skin.map', 'skin.map.slot']) ok(map.includes(`'${a}'`), `action ${a}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
console.log(`✓ check-flagship-apply: ${n} checks (${SKINS.join(', ')} at hub, app, ui and plugin scope; REST, MCP, actions, voice)`);
