#!/usr/bin/env node
/**
 * The icon map from the files (icon-map@1, framework/core/engines/icon-map-rules.mjs): every icon, badge and logo slot
 * in every app, plugin and the framework chrome, built from plugin.json manifests, web code and assets. The IO side;
 * the rules are pure and shared with the spec check and the console's Icon map plugin.
 *
 *   node framework/cli/icon-map.mjs build [--write] [--json]        the whole map (--write: refresh the contract snapshot framework/schemas/icon-map.json)
 *   node framework/cli/icon-map.mjs list [--app a] [--owner o] [--surface s] [--kind k] [--role r] [--glyph g] [--q words] [--json]
 *   node framework/cli/icon-map.mjs show <slot id> [--json]          one slot
 *   node framework/cli/icon-map.mjs tree [--json]                    app → owner → surface → slots
 *   node framework/cli/icon-map.mjs roles [--json]                   every role with its default glyph and group
 *   node framework/cli/icon-map.mjs glyphs [--json]                  the framework glyph set and its aliases
 *   node framework/cli/icon-map.mjs packs [--json]                   every icon-pack@1 asset: style, themable, covers, roles, glyphs
 *   node framework/cli/icon-map.mjs resolve <name> [--slot id] [--role r] [--pack id] [--json]   what a place draws, and why
 *   node framework/cli/icon-map.mjs check [--update-baseline] [--json]   CI: fails on a hard-coded icon not in the map (framework/cli/check-icons.mjs runs this)
 *   node framework/cli/icon-map.mjs template [--from pack] [--id id] [--name n] [--style s] [--fixed] [--out file] [--json]
 *                                                                   an icon-pack@1 file mapping EVERY role to a glyph (the
 *                                                                   from-pack's mapping, else the role default): edit, import, apply
 *   node framework/cli/icon-map.mjs validate-pack <file> [--json]    is this an importable icon-pack@1 asset (and its id / name)
 *   node framework/cli/icon-map.mjs skins [--json]                   every skin with the icon pack it names (its per-skin default)
 *   node framework/cli/icon-map.mjs schemas                          the contract's JSON Schemas
 *
 * AXF_ROOT points at another checkout (tests). Exit codes: 0 ok · 1 failed · 2 usage.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ICON_MAP_FRAME, ICON_OWNER_KINDS, ICON_ROLE_GROUPS, ICON_SLOT_KINDS, ICON_SOURCES, ICON_SURFACES, ICON_ROLES,
  allRoles, buildIconMap, iconMapCheck, iconMapSchemas, iconMapSearch, iconMapTree, resolveIcon, scanRawIcons,
} from '../core/engines/icon-map-rules.mjs';
import { GLYPHS, GLYPH_ALIASES, GLYPH_FALLBACK, GLYPH_NAMES } from '../core/engines/glyphs.mjs';
import { iconPackErrors, normalizeIconPack } from '../core/engines/brand-rules.mjs';

export const ROOT = resolve(process.env.AXF_ROOT || join(dirname(fileURLToPath(import.meta.url)), '../..'));
export const SNAPSHOT_REL = 'framework/schemas/icon-map.json';
export const BASELINE_REL = 'framework/spec/icon-map-baseline.json';

const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
const read = (f) => { try { return readFileSync(f, 'utf8'); } catch { return ''; } };
const rel = (f) => relative(ROOT, f).split('\\').join('/');

/** Asset types whose data carries icons (menus, toolbars, badges, marks, banner attachables). */
const ICON_ASSET_TYPES = new Set(['badge', 'logo', 'logo-mark', 'animated-logo', 'branding', 'nav-menu', 'app-menu', 'context-menu', 'toolbar', 'settings', 'action-button', 'link', 'status', 'counter', 'label', 'theme-switch', 'search-bar', 'avatar', 'progress', 'clock']);
const CODE = /\.(tsx|ts|mjs|js)$/;
const SKIP_FILE = /(\.d\.m?ts|\.test\.[cm]?[jt]sx?|^test\.mjs|\.gen\.mjs)$/;

function* walk(dir, depth = 0) {
  if (depth > 8 || !existsSync(dir)) return;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'dist' || e.name === 'vendor' || e.name === '__pycache__') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (/[\\/]src$/.test(dir) && e.name === 'axf') continue; yield* walk(p, depth + 1); } // src/axf = the baked framework copy
    else yield p;
  }
}

const screenOf = (file) => { const m = /[\\/]views?[\\/]([a-z0-9-]+)\.tsx?$/i.exec(file); return m ? m[1].toLowerCase() : ''; };

function sourcesIn(dir, { code = true } = {}) {
  const out = [];
  for (const f of walk(dir)) {
    if (!CODE.test(f) || SKIP_FILE.test(f.split(/[\\/]/).pop())) continue;
    if (!code && !f.endsWith('.tsx')) continue;
    out.push({ file: rel(f), text: read(f), screen: screenOf(f) });
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

function assetsIn(dir) {
  const out = [];
  for (const f of walk(dir)) {
    if (!f.endsWith('.json')) continue;
    const j = readJson(f);
    if (!j || j.$axf !== 'asset@1' || !ICON_ASSET_TYPES.has(j.type)) continue;
    out.push({ type: j.type, id: String(j.id ?? f.split(/[\\/]/).pop().slice(0, -5)), name: j.name ?? '', data: j.data, file: rel(f) });
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

/** Where each app keeps its plugins (the same homes plugin-commands.mjs reads). */
export const PLUGIN_HOMES = [
  { app: 'console-web', dir: 'apps/console-web/plugins' },
  { app: 'amberx-droid', dir: 'apps/amberx-droid/src/plugins' },
  { app: 'axhub-web', dir: 'apps/axhub-web/src/plugins' },
  { app: 'molly', dir: 'apps/molly/plugins' },
  { app: 'expenses', dir: 'apps/expenses/src/plugins' },
];

/** Every owner's facts: the framework chrome, each web app's own UI and assets, each plugin. */
export function readOwners() {
  const owners = [];
  owners.push({ app: 'framework', owner: 'framework', ownerKind: 'framework', sources: [...sourcesIn(join(ROOT, 'framework/react')), ...sourcesIn(join(ROOT, 'framework/libs'))], assets: assetsIn(join(ROOT, 'framework/assets')) });
  const apps = existsSync(join(ROOT, 'apps')) ? readdirSync(join(ROOT, 'apps')).sort() : [];
  for (const a of apps) {
    const src = join(ROOT, 'apps', a, 'src');
    if (!existsSync(src) || !statSync(src).isDirectory()) continue;
    const pluginsDir = PLUGIN_HOMES.find((h) => h.app === a)?.dir;
    const sources = sourcesIn(src).filter((s) => !pluginsDir || !s.file.startsWith(`${pluginsDir}/`));
    owners.push({ app: a, owner: 'app', ownerKind: 'app', sources, assets: assetsIn(join(src, 'assets')) });
  }
  for (const h of PLUGIN_HOMES) {
    const d = join(ROOT, h.dir);
    if (!existsSync(d)) continue;
    for (const folder of readdirSync(d).sort()) {
      if (folder.startsWith('_') || folder.startsWith('.')) continue;
      const base = join(d, folder);
      const manifest = readJson(join(base, 'plugin.json'));
      if (!manifest || !statSync(base).isDirectory()) continue;
      owners.push({ app: h.app, owner: folder, ownerKind: 'plugin', manifest, manifestFile: rel(join(base, 'plugin.json')), sources: sourcesIn(base), assets: assetsIn(base) });
    }
  }
  return owners;
}

/** Raw icons (inline <svg>, emoji as glyphs) in UI code: every owner's .tsx files, except the framework's own Icon. */
export function readRaws(owners) {
  const out = [];
  for (const o of owners) for (const s of o.sources) {
    if (!s.file.endsWith('.tsx') || s.file === 'framework/react/components/Icon.tsx') continue;
    out.push(...scanRawIcons(s.text, s.file));
  }
  return out;
}

export function buildMap(owners = readOwners()) {
  return buildIconMap(owners);
}

/** The contract snapshot (stable: no slots, no counts; those come from the live build). */
export function snapshot(map = buildMap()) {
  return {
    $axf: ICON_MAP_FRAME,
    _doc: 'icon-map@1 contract (framework/core/engines/icon-map-rules.mjs): kinds, surfaces, sources, owner kinds, role groups, the role vocabulary, the framework glyph set and the JSON Schemas. Generated by `node framework/cli/icon-map.mjs build --write`; the live map (every slot) is `node framework/cli/icon-map.mjs build --json` or the console plugin. Checked current by spec/check-icon-map.mjs.',
    kinds: [...ICON_SLOT_KINDS], surfaces: [...ICON_SURFACES], sources: [...ICON_SOURCES], ownerKinds: [...ICON_OWNER_KINDS], groups: [...ICON_ROLE_GROUPS],
    roles: ICON_ROLES,
    glyphs: { names: [...GLYPH_NAMES], aliases: GLYPH_ALIASES, fallback: GLYPH_FALLBACK },
    settings: { pack: 'axf.icons.pack.app', slot: 'axf.icons.slot.<slot id>' },
    resolution: ['override', 'pack-role', 'pack-glyph', 'framework', 'fallback'],
    schemas: iconMapSchemas(),
    counts: { apps: Object.keys(map.counts.byApp).length, owners: Object.keys(map.counts.byOwner).length },
  };
}

/** Every icon-pack@1 asset in the framework and the apps' own assets. */
export function readPacks() {
  const out = [];
  // AXF_ICON_PACKS_EXTRA: more folders of icon-pack files (the Icon map plugin's imported packs), ':'-separated
  const extra = (process.env.AXF_ICON_PACKS_EXTRA || '').split(':').filter(Boolean);
  const dirs = [join(ROOT, 'framework/assets/icon-pack'), ...(existsSync(join(ROOT, 'apps')) ? readdirSync(join(ROOT, 'apps')).map((a) => join(ROOT, 'apps', a, 'src/assets/icon-pack')) : []), ...extra];
  const seen = new Set();
  for (const d of dirs) {
    if (!existsSync(d)) continue;
    for (const f of readdirSync(d).filter((n) => n.endsWith('.json')).sort()) {
      const j = readJson(join(d, f));
      if (!j || j.type !== 'icon-pack' || seen.has(j.id)) continue;
      seen.add(j.id);
      const p = normalizeIconPack(j.data);
      out.push({ id: j.id, name: j.name ?? j.id, style: p.style, themable: p.themable, covers: p.covers, license: p.license, roles: Object.keys(p.roles).length, glyphs: Object.keys(p.glyphs).length, tags: p.tags, file: extra.includes(d) ? join(d, f) : rel(join(d, f)), source: extra.includes(d) ? 'imported' : 'shipped' });
    }
  }
  return out;
}

/** Frozen code: its unknown icon names are held to the baseline instead of failing (the same list as check-theme). */
export const FROZEN = [/^apps\/expenses\//];

export function runCheck({ updateBaseline = false } = {}) {
  const owners = readOwners();
  const map = buildMap(owners);
  const raws = readRaws(owners);
  const baseline = readJson(join(ROOT, BASELINE_REL)) ?? { files: {}, unknown: {} };
  const r = iconMapCheck(map, raws, baseline, { frozen: FROZEN });
  if (updateBaseline) writeFileSync(join(ROOT, BASELINE_REL), `${JSON.stringify(r.baseline, null, 2)}\n`);
  return { ...r, slots: map.slots.length, unknown: map.unknown.length, raws: raws.length, files: Object.keys(r.baseline.files).length };
}

/* ------------------------------------------------------------------ template */

const PACK_STYLES = ['outline', 'filled', 'duotone', 'sharp', 'rounded'];

/**
 * The icon pack template: one icon-pack@1 file whose `roles` names every role in the map (framework vocabulary, every
 * glyph as a role of its own name, and every plugin's declared roles) with the glyph it draws: the base pack's role
 * mapping when one is given, else the role's default. Applying the file changes every icon in the app at once; editing
 * one line changes every place of that role. `glyphs` is the base pack's art, else every framework glyph's path, so the
 * file is also the place to redraw any glyph.
 */
export function packTemplate({ from = '', id = '', name = '', style = '', themable = true, roles = null } = {}) {
  const all = roles ?? buildMap().roles;
  const baseRow = from ? readPacks().find((x) => x.id === from) : null;
  if (from && !baseRow) return { ok: false, message: `no icon pack "${from}"` };
  const base = baseRow ? readJson(join(ROOT, baseRow.file)) : null;
  const bd = base?.data ?? {};
  const map = {};
  for (const r of Object.keys(all).sort()) map[r] = (bd.roles && typeof bd.roles[r] === 'string' && bd.roles[r]) || all[r].glyph;
  const st = PACK_STYLES.includes(style) ? style : (PACK_STYLES.includes(bd.style) ? bd.style : 'outline');
  const pid = (id || (base ? `${base.id}-custom` : 'my-icon-pack')).toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 64);
  return {
    ok: true,
    pack: {
      $axf: 'asset@1', type: 'icon-pack', id: pid,
      name: name || (base ? `${base.name ?? base.id} (custom)` : 'My icon pack'),
      version: '1.0.0',
      description: `Icon pack template: every role in the icon map (${Object.keys(map).length}) mapped to a glyph${base ? `, starting from ${base.id}` : ''}. Change a role's glyph to change every place of that role; apply the pack to change every icon at once.`,
      author: 'icon-map template',
      tags: ['icon-pack', st, themable ? 'themable' : 'fixed-colour', 'template'],
      data: {
        style: st, grid: bd.grid ?? 24, stroke: bd.stroke ?? 1.8, linecap: bd.linecap ?? 'round', fallback: 'framework',
        themable: base ? bd.themable !== false : !!themable,
        covers: Array.isArray(bd.covers) && bd.covers.length ? bd.covers : ['icons', 'badges', 'logos'],
        license: bd.license ?? { name: 'MIT', url: 'https://opensource.org/licenses/MIT' },
        roles: map,
        glyphs: bd.glyphs && typeof bd.glyphs === 'object' && Object.keys(bd.glyphs).length ? bd.glyphs : { ...GLYPHS },
      },
    },
  };
}

/** An icon-pack@1 asset someone wants to import: shape, id, the type's data rules. */
export function validatePack(j) {
  const errors = [];
  if (!j || typeof j !== 'object' || Array.isArray(j)) return { ok: false, errors: ['not a JSON object'] };
  if (j.$axf !== 'asset@1') errors.push('$axf must be "asset@1"');
  if (j.type !== 'icon-pack') errors.push('type must be "icon-pack"');
  if (typeof j.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(j.id)) errors.push('id must be lowercase words with dashes (max 64)');
  if (typeof j.name !== 'string' || !j.name.trim()) errors.push('name is required');
  errors.push(...iconPackErrors(j.data).map((e) => `data: ${e}`));
  if (errors.length) return { ok: false, errors };
  const p = normalizeIconPack(j.data);
  return { ok: true, errors: [], id: j.id, name: j.name, style: p.style, themable: p.themable, covers: p.covers, glyphs: Object.keys(p.glyphs).length, roles: Object.keys(p.roles).length, shipped: readPacks().some((x) => x.id === j.id && x.source === 'shipped') };
}

/* ------------------------------------------------------------------ CLI */

function flagsOf(argv) {
  const flags = {}; const args = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { const k = argv[i].slice(2); const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; flags[k] = v; }
    else args.push(argv[i]);
  }
  return { flags, args };
}

const pad = (s, n) => String(s ?? '').padEnd(n);
const line = (s) => `${pad(s.id, 70)} ${pad(s.kind, 6)} ${pad(s.role, 16)} ${pad(s.glyph, 16)} ${s.file}${s.line ? `:${s.line}` : ''}`;

export async function main(argv = process.argv.slice(2)) {
  const { flags, args } = flagsOf(argv);
  const [cmd, ...rest] = args;
  const json = !!flags.json;
  const out = (v) => { console.log(JSON.stringify(v, null, 2)); return 0; };
  switch (cmd) {
    case 'build': {
      const map = buildMap();
      if (flags.write) { writeFileSync(join(ROOT, SNAPSHOT_REL), `${JSON.stringify(snapshot(map), null, 2)}\n`); if (!json) console.log(`wrote ${SNAPSHOT_REL}`); }
      if (json) return out(map);
      console.log(`${map.slots.length} slots · ${Object.keys(map.roles).length} roles · ${map.glyphs.names.length} glyphs · ${map.unknown.length} unknown names · ${map.problems.length} problems`);
      for (const [k, v] of Object.entries(map.counts.byApp)) console.log(`  ${pad(k, 20)} ${v}`);
      console.log('by surface:', Object.entries(map.counts.bySurface).map(([k, v]) => `${k} ${v}`).join(' · '));
      console.log('by kind:', Object.entries(map.counts.byKind).map(([k, v]) => `${k} ${v}`).join(' · '));
      return 0;
    }
    case 'counts': return out(buildMap().counts);
    case 'list': {
      const map = buildMap();
      const filters = {}; for (const k of ['app', 'owner', 'surface', 'kind', 'role', 'glyph', 'screen']) if (typeof flags[k] === 'string') filters[k] = flags[k];
      const hits = iconMapSearch(map, typeof flags.q === 'string' ? flags.q : rest.join(' '), filters);
      if (json) return out(hits);
      for (const s of hits) console.log(line(s));
      console.log(`${hits.length} slot${hits.length === 1 ? '' : 's'}`);
      return 0;
    }
    case 'show': {
      if (!rest[0]) { console.error('usage: icon-map.mjs show <slot id>'); return 2; }
      const s = buildMap().slots.find((x) => x.id === rest[0]);
      if (!s) { console.error(`no slot "${rest[0]}"`); return 1; }
      return json ? out(s) : (console.log(JSON.stringify(s, null, 2)), 0);
    }
    case 'tree': {
      const tree = iconMapTree(buildMap());
      if (json) return out(tree);
      for (const a of tree) { console.log(`${a.app} (${a.count})`); for (const o of a.owners) { console.log(`  ${o.owner} (${o.count})`); for (const su of o.surfaces) console.log(`    ${pad(su.surface, 14)} ${su.slots.length}`); } }
      return 0;
    }
    case 'roles': {
      const roles = buildMap().roles;
      if (json) return out(roles);
      for (const [id, r] of Object.entries(roles).sort(([a], [b]) => a.localeCompare(b))) console.log(`${pad(id, 20)} ${pad(r.group, 8)} ${pad(r.glyph, 16)} ${r.label}`);
      return 0;
    }
    case 'glyphs': {
      if (json) return out({ names: GLYPH_NAMES, aliases: GLYPH_ALIASES, fallback: GLYPH_FALLBACK });
      console.log(GLYPH_NAMES.join(' '));
      console.log('aliases:', Object.entries(GLYPH_ALIASES).map(([a, b]) => `${a}→${b}`).join(' '));
      return 0;
    }
    case 'packs': {
      const packs = readPacks();
      if (json) return out(packs);
      for (const p of packs) console.log(`${pad(p.id, 24)} ${pad(p.style, 8)} ${pad(p.themable ? 'themable' : 'fixed', 9)} ${pad(p.covers.join(','), 20)} roles ${pad(p.roles, 4)} glyphs ${pad(p.glyphs, 4)} ${p.license.name || ''}`);
      return 0;
    }
    case 'resolve': {
      if (!rest[0] && !flags.role) { console.error('usage: icon-map.mjs resolve <name> [--slot id] [--role r] [--pack id]'); return 2; }
      let pack = null;
      if (typeof flags.pack === 'string') {
        const p = readPacks().find((x) => x.id === flags.pack);
        if (!p) { console.error(`no icon pack "${flags.pack}"`); return 1; }
        pack = normalizeIconPack(readJson(join(ROOT, p.file))?.data);
      }
      const r = resolveIcon({ name: rest[0] ?? '', slot: typeof flags.slot === 'string' ? flags.slot : '', role: typeof flags.role === 'string' ? flags.role : '', pack, roles: allRoles() });
      return json ? out(r) : (console.log(`${r.glyph}  (${r.via})`), 0);
    }
    case 'check': {
      const r = runCheck({ updateBaseline: !!flags['update-baseline'] });
      if (json) return out(r);
      for (const f of r.failures) console.log(`\x1b[31m✗ ${f}\x1b[0m`);
      for (const w of r.warnings) console.log(`\x1b[33m! ${w}\x1b[0m`);
      console.log(r.ok ? `\x1b[32m✓ icon map: ${r.slots} slots, every icon in the map; ${r.raws} raw icons in ${r.files} files held by the baseline\x1b[0m` : `\x1b[31m✗ icon map: ${r.failures.length} problem(s)\x1b[0m`);
      return r.ok ? 0 : 1;
    }
    case 'template': {
      const r = packTemplate({ from: typeof flags.from === 'string' ? flags.from : '', id: typeof flags.id === 'string' ? flags.id : '', name: typeof flags.name === 'string' ? flags.name : '', style: typeof flags.style === 'string' ? flags.style : '', themable: !flags.fixed });
      if (!r.ok) { console.error(r.message); return 1; }
      const text = `${JSON.stringify(r.pack, null, 2)}\n`;
      if (typeof flags.out === 'string') { writeFileSync(resolve(flags.out), text); if (!json) { console.log(`wrote ${flags.out}: ${Object.keys(r.pack.data.roles).length} roles`); return 0; } }
      return json ? out(r.pack) : (process.stdout.write(text), 0);
    }
    case 'validate-pack': {
      if (!rest[0]) { console.error('usage: icon-map.mjs validate-pack <file>'); return 2; }
      const r = validatePack(readJson(resolve(rest[0])));
      if (json) return out(r);
      console.log(r.ok ? `✓ ${r.id}: ${r.glyphs} glyphs, ${r.roles} roles, ${r.themable ? 'themable' : 'fixed colour'}` : `✗ ${r.errors.join('; ')}`);
      return r.ok ? 0 : 1;
    }
    case 'skins': {
      const d = join(ROOT, 'framework/assets/skin');
      const skins = existsSync(d) ? readdirSync(d).filter((f) => f.endsWith('.json')).sort().map((f) => readJson(join(d, f))).filter((j) => j?.type === 'skin').map((j) => ({ id: j.id, name: j.name ?? j.id, iconPack: typeof j.data?.iconPack === 'string' ? j.data.iconPack : '' })) : [];
      if (json) return out(skins);
      for (const k of skins) console.log(`${pad(k.id, 20)} ${k.iconPack || '(branding pack)'}`);
      return 0;
    }
    case 'schemas': return out(iconMapSchemas());
    default:
      console.error(read(fileURLToPath(import.meta.url)).split('\n').slice(1, 17).map((l) => l.replace(/^ \*\s?/, '')).join('\n'));
      return 2;
  }
}

// exitCode, not process.exit: a large JSON answer to a pipe must finish writing first
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main();
