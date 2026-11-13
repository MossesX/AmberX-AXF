/**
 * The UI Manager's catalog (ui-catalog@1): everything the predetermined choices come from, read from the framework and the
 * console. IO lives here; the rules (framework/core/engines/ui-manager-rules.mjs) are pure.
 *
 *   types    framework/schemas/asset-types.json → types (enums, required, nested, optional fields)
 *   assets   framework/assets/<type>/*.json + every installed plugin's assets/<type>/*.json ({ id, name, data })
 *   active   the asset in force per slot: the skin's picks (skin@1 data.assets / colorTheme / styleTheme / layoutTheme),
 *            then the look document's slots (appearance@1, the same file Token control writes), else the first asset
 *   paths    control@1 token paths per set (control-rules.mjs controlPaths): colour, number + range, enum, boolean, string
 *   skin     the skin id in force ('' when none)
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { controlPaths } from '../../../../../framework/core/engines/control-rules.mjs';
import { CATALOG_FRAME, TOKEN_TARGETS } from '../../../../../framework/core/engines/ui-manager-rules.mjs';
import { ROOT } from './common.mjs';

const ASSETS = join(ROOT, 'framework', 'assets');
const PLUGINS = join(ROOT, 'apps', 'console-web', 'plugins');
const SKIN_SLOTS = { colorTheme: 'color-theme', styleTheme: 'style-theme', layoutTheme: 'layout', behaviorTheme: 'behavior-theme', iconPack: 'icon-pack' };

const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
const listDir = (d) => { try { return readdirSync(d, { withFileTypes: true }); } catch { return []; } };

export function appearanceFile() {
  if (process.env.AXF_APPEARANCE_FILE) return process.env.AXF_APPEARANCE_FILE;
  const projects = process.env.AXHUB_PROJECTS_DIR || '/projects';
  if (existsSync(projects)) return join(projects, '_shared', '_data', 'settings', 'appearance.json');
  return '';
}

function assetsOf(type) {
  const out = [];
  const add = (dir) => { for (const f of listDir(dir)) { if (!f.isFile() || !f.name.endsWith('.json')) continue; const a = readJson(join(dir, f.name)); if (a?.$axf === 'asset@1' && typeof a.id === 'string' && !out.some((x) => x.id === a.id)) out.push({ id: a.id, name: typeof a.name === 'string' ? a.name : a.id, data: a.data && typeof a.data === 'object' ? a.data : {} }); } };
  add(join(ASSETS, type));
  for (const p of listDir(PLUGINS)) if (p.isDirectory() && !p.name.startsWith('_')) add(join(PLUGINS, p.name, 'assets', type));
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/** The whole catalog (reads the files once per call; the plugin caches it per request). */
export function buildCatalog({ appearance = null } = {}) {
  const types = readJson(join(ROOT, 'framework', 'schemas', 'asset-types.json'))?.types ?? {};
  const assets = {};
  for (const t of Object.keys(types)) { const list = assetsOf(t); if (list.length) assets[t] = list; }
  const look = appearance ?? (appearanceFile() ? readJson(appearanceFile()) : null) ?? {};
  const active = {};
  const skinId = look.slots?.skin ?? look.settings?.['axf.skins.active'] ?? '';
  const skin = skinId ? (assets.skin ?? []).find((s) => s.id === skinId) : null;
  if (skin) {
    for (const [k, t] of Object.entries(SKIN_SLOTS)) if (typeof skin.data[k] === 'string') active[t] = skin.data[k];
    for (const [t, id] of Object.entries(skin.data.assets ?? {})) if (typeof id === 'string') active[t] = id;
  }
  for (const [t, id] of Object.entries(look.slots ?? {})) if (typeof id === 'string' && t !== 'skin') active[t] = id;
  for (const t of Object.keys(active)) if (!(assets[t] ?? []).some((a) => a.id === active[t])) delete active[t];
  for (const t of Object.keys(assets)) if (!active[t]) active[t] = assets[t][0].id;
  const paths = {};
  for (const target of Object.values(TOKEN_TARGETS)) paths[target] = controlPaths(target) ?? [];
  return { $axf: CATALOG_FRAME, types, assets, active, paths, skin: skin ? skin.id : '' };
}

/** Elements plugins declare (plugin.json `uiElements`), with the plugin's id (never its folder). */
export function pluginManifests() {
  const out = [];
  for (const p of listDir(PLUGINS)) {
    if (!p.isDirectory() || p.name.startsWith('_')) continue;
    const m = readJson(join(PLUGINS, p.name, 'plugin.json'));
    if (m?.$axf === 'plugin@1') out.push(m);
  }
  return out;
}
