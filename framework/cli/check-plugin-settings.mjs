#!/usr/bin/env node
/**
 * check-plugin-settings — every console plugin has its settings interface (plugin-settings@1, CI).
 *
 * Brett, Nov 16 2026: "They all need a settings page. They all need a settings interface." Fails, naming file:line, when:
 *   1. a plugin.json has no `settings` block, or the block is wrong (core/plugin-settings.mjs checkSettings: its tab is a
 *      `settings-tab:` it provides, parent plugins, enable / info / logs kept, option keys, gear matches having a screen);
 *   2. a plugin with a screen has no shared gear in its web code: <PluginSettingsGear tab=…/>, <PluginScreenHeader tab=…/>
 *      (unless gear={false}) or a library's `gear: { tab }`, pointing at its own tab;
 *   3. a plugin screen still draws a hand-made gear: a `settings` icon button that opens its own settings tab (swap it for
 *      PluginSettingsGear, so every gear is the same control with the same console-control address).
 * Warns (never fails) when an option key isn't in the console's control inventory (src/control/inventory.json): such a key
 * is still set through the open console, but REST / MCP can't describe it without a browser.
 *
 *   node framework/cli/check-plugin-settings.mjs [--root apps/console-web/plugins] [--json] [--quiet]
 *
 * Folders starting with `_` (the template) are checked too: a new plugin copies it. Folders without plugin.json aren't plugins.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkSettings, hasScreen, normalizeSettings, pluginViews } from '../core/plugin-settings.mjs';

const REPO = resolve(fileURLToPath(new URL('../..', import.meta.url)));

const SHARED_GEAR = /<\s*(PluginSettingsGear|PluginScreenHeader)\b[^>]*?\btab=\{?\s*(?:['"`]([\w.-]+)['"`]|(\w+))|\bgear:\s*\{\s*tab:\s*(?:['"`]([\w.-]+)['"`]|(\w+))/;
const HAND_GEAR = /icon\s*=\s*\{?\s*['"]settings['"][^\n]*settings\.open:([\w.-]+)|settings\.open:([\w.-]+)[^\n]*icon\s*=\s*\{?\s*['"]settings['"]/;
const BUTTON = /<\s*(IconButton|Button|button)\b/;

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((n) => {
    if (n === 'node_modules' || n === '__pycache__') return [];
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.(tsx?|mts)$/.test(n) ? [p] : [];
  });
}

/** 1-based line of `"key":` in a JSON text (1 when absent). */
function lineOf(text, key) {
  const i = text.indexOf(`"${key}":`);
  return i < 0 ? 1 : text.slice(0, i).split('\n').length;
}

export function checkPlugin(dir, { repo = REPO, inventoryKeys = null } = {}) {
  const folder = dir.split('/').pop();
  const mpath = join(dir, 'plugin.json');
  const rel = (p) => relative(repo, p);
  const errors = [];
  const warnings = [];
  let text;
  let m;
  try { text = readFileSync(mpath, 'utf8'); m = JSON.parse(text); } catch (e) { return { folder, errors: [{ at: `${rel(mpath)}:1`, message: `plugin.json doesn't parse: ${e.message}` }], warnings }; }
  // the template's folder is "_template" but its tab is the example's
  const ctxFolder = folder.startsWith('_') ? (m.settings?.tab ?? folder) : folder;
  for (const p of checkSettings(m, { folder: ctxFolder, required: true })) errors.push({ at: `${rel(mpath)}:${lineOf(text, 'settings') }`, message: p });
  const s = normalizeSettings(m, { folder: ctxFolder });
  const files = walk(join(dir, 'web'));
  // string constants of the plugin's web files (`const FOLDER = 'x'`), so tab={FOLDER} resolves
  const consts = new Map();
  const srcs = files.map((f) => [f, readFileSync(f, 'utf8')]);
  for (const [, src] of srcs) for (const c of src.matchAll(/(?:export )?const (\w+) = ['"]([\w.-]+)['"]/g)) if (!consts.has(c[1])) consts.set(c[1], c[2]);
  const gears = [];
  for (const [f, src] of srcs) {
    const lines = src.split('\n');
    lines.forEach((line, i) => {
      const g = line.match(SHARED_GEAR);
      if (g && !/gear=\{false\}/.test(line)) gears.push({ at: `${rel(f)}:${i + 1}`, tab: g[2] ?? consts.get(g[3]) ?? g[4] ?? consts.get(g[5]) ?? null });
      const h = line.match(HAND_GEAR);
      if (h && (h[1] ?? h[2]) === s.tab && BUTTON.test(lines.slice(Math.max(0, i - 2), i + 1).join('\n'))) {
        errors.push({ at: `${rel(f)}:${i + 1}`, message: `a hand-made settings gear opens ${s.tab}: use <PluginSettingsGear tab="${s.tab}" /> (react/components/PluginSettingsGear) so every gear is the same control` });
      }
    });
  }
  if (hasScreen(m)) {
    const own = gears.filter((g) => g.tab === s.tab);
    if (!own.length) {
      // name where its screen is registered, else plugin.json's provides
      let at = `${rel(mpath)}:${lineOf(text, 'provides')}`;
      const view = pluginViews(m)[0];
      for (const [f, src] of srcs) {
        const i = src.split('\n').findIndex((l) => /\bviews\s*:/.test(l) || (view && l.includes(`'${view}'`) && /render/.test(l)));
        if (i >= 0) { at = `${rel(f)}:${i + 1}`; break; }
      }
      const wrong = gears.filter((g) => g.tab !== s.tab).map((g) => `${g.at} (tab ${g.tab ?? '?'})`);
      errors.push({ at, message: `its screen (view:${view}) has no PluginSettingsGear for its tab "${s.tab}" in the header${wrong.length ? `; found gears for other tabs: ${wrong.join(', ')}` : ''}: render <PluginScreenHeader tab="${s.tab}" …/> or put <PluginSettingsGear tab="${s.tab}" /> in the header's toolbar` });
    }
  }
  if (inventoryKeys) for (const k of s.options) if (!inventoryKeys.has(k)) warnings.push({ at: `${rel(mpath)}:${lineOf(text, 'settings')}`, message: `option ${k} isn't in the control inventory (apps/console-web/src/control/inventory.json): set only through the open console` });
  return { folder, tab: s.tab, screen: hasScreen(m), gears: gears.map((g) => g.at), errors, warnings };
}

export function checkAll({ root = join(REPO, 'apps/console-web/plugins'), repo = REPO } = {}) {
  const inv = join(repo, 'apps/console-web/src/control/inventory.json');
  let inventoryKeys = null;
  try { inventoryKeys = new Set(JSON.parse(readFileSync(inv, 'utf8')).settings.map((x) => x.key)); } catch { /* no inventory: no warnings */ }
  const folders = readdirSync(root).filter((n) => statSync(join(root, n)).isDirectory() && existsSync(join(root, n, 'plugin.json'))).sort();
  return folders.map((f) => checkPlugin(join(root, f), { repo, inventoryKeys }));
}

export function main(argv = process.argv.slice(2), io = { log: (s) => console.log(s), error: (s) => console.error(s) }) {
  const i = argv.indexOf('--root');
  const root = i >= 0 && argv[i + 1] ? resolve(argv[i + 1]) : undefined;
  const res = checkAll(root ? { root } : {});
  const errors = res.flatMap((r) => r.errors.map((e) => ({ ...e, folder: r.folder })));
  const warnings = res.flatMap((r) => r.warnings.map((w) => ({ ...w, folder: r.folder })));
  if (argv.includes('--json')) { io.log(JSON.stringify({ ok: errors.length === 0, plugins: res.length, errors, warnings }, null, 2)); return errors.length ? 1 : 0; }
  if (!argv.includes('--quiet')) for (const w of warnings) io.log(`! ${w.at}: ${w.message}`);
  for (const e of errors) io.error(`✗ ${e.at}: ${e.message}`);
  const screens = res.filter((r) => r.screen).length;
  if (errors.length) { io.error(`✗ plugin settings: ${errors.length} problem(s) in ${new Set(errors.map((e) => e.folder)).size} plugin(s)`); return 1; }
  io.log(`✓ plugin settings — ${res.length} plugins declare plugin-settings@1, ${screens} screens carry the shared gear${warnings.length ? `, ${warnings.length} option key(s) only the open console knows` : ''}`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exit(main());
