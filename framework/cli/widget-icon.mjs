#!/usr/bin/env node
/**
 * Widget icons (widget-icons@1, spec/WIDGET-ICONS.md): the icon and display mode of every banner and settings widget,
 * from the command line. The same as REST /api/widget-icons, the MCP tools widget_icons_* and the console actions
 * widget.icon / widget.mode / widget.icons.reset.
 *
 *   axf widget-icon list [--app <app>] [--q <text>] [--json]     every widget: icon, where it came from, mode, pick
 *   axf widget-icon get <widget id> [--app <app>] [--json]
 *   axf widget-icon set <widget id> [<icon>] [--mode auto|icon|icon+text|text] [--app <app>]
 *                                                                  icon = a glyph (rocket), <pack>/<glyph>, or own
 *   axf widget-icon reset [<widget id>] [--app <app>]             one widget, or every widget, back to its default
 *   axf widget-icon glyphs [--q <text>]                           the glyphs that can be picked
 *   axf widget-icon open <widget id>                              open the picker in the open console (console relay)
 *
 * Widget ids are <host>:<kind>:<id> (banner:status:project, settings:tab:appearance). The picks live in the app's look
 * document on the hub (`own.settings`, AXF_LOOKS_DIR or <AXF_APPEARANCE_FILE dir>/looks/<app>.json), so an open console
 * and every device of the app follow. Without /projects mounted, set AXF_CONSOLE_URL (+ AXF_TOKEN) and the command goes
 * through the console's REST API instead. The app defaults to the Dev Console (axf-console).
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const MODES = ['icon', 'icon+text', 'text'];
const HOSTS = ['banner', 'toolbar', 'settings'];
const WIDGET_ID = /^([a-z0-9-]{1,40}):([a-z0-9-]{1,40}):([A-Za-z0-9._-]{1,80})$/;
const PACK_ID = /^[a-z0-9][a-z0-9-]{1,47}$/;
const GLYPH_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const ALIASES = { console: 'axf-console', 'console-web': 'axf-console', axhub: 'axhub-web', amberx: 'amberx-droid' };
const KIND_ICONS = { status: 'info', counter: 'chart', progress: 'chart', 'action-button': 'zap', link: 'external', label: 'type', badge: 'bell', logo: 'star', avatar: 'user', clock: 'clock', 'search-bar': 'search', 'theme-switch': 'sun', tab: 'folder', group: 'list', setting: 'sliders' };

export class WidgetIconError extends Error { constructor(code, message) { super(message); this.code = code; } }
const fail = (code, msg) => { throw new WidgetIconError(code, msg); };

export const parseId = (raw) => { const m = typeof raw === 'string' ? WIDGET_ID.exec(raw) : null; return m && HOSTS.includes(m[1]) ? { host: m[1], kind: m[2], id: m[3] } : null; };
export function parseRef(raw) {
  if (typeof raw !== 'string') return null;
  let s = raw.trim();
  if (s.startsWith('pack:')) s = s.slice(5);
  const i = s.indexOf('/');
  if (i < 0) return GLYPH_ID.test(s) ? { pack: null, glyph: s } : null;
  const pack = s.slice(0, i); const glyph = s.slice(i + 1);
  return PACK_ID.test(pack) && GLYPH_ID.test(glyph) ? { pack, glyph } : null;
}

export const inventory = () => JSON.parse(readFileSync(join(ROOT, 'framework/schemas/widget-icon-defaults.json'), 'utf8'));
export const glyphs = () => [...new Set([...readFileSync(join(ROOT, 'framework/react/components/Icon.tsx'), 'utf8').matchAll(/^ {2}'?([a-z0-9-]+)'?: '/gm)].map((m) => m[1]))].sort();
const looksDir = () => process.env.AXF_LOOKS_DIR || join(dirname(process.env.AXF_APPEARANCE_FILE || '/projects/_shared/_data/settings/appearance.json'), 'looks');
const appOf = (a) => { const id = ALIASES[a] ?? (a || 'axf-console'); if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) fail('bad_app', `"${id}" is not an app id`); return id; };
const lookFile = (app) => join(looksDir(), `${app}.json`);
const readLook = (app) => { try { return JSON.parse(readFileSync(lookFile(app), 'utf8')); } catch { return null; } };
export const picksOf = (app) => Object.fromEntries(Object.entries(readLook(app)?.own?.settings ?? {}).filter(([k]) => k.startsWith('axf.widget.')));

function writeSettings(app, changes, by) {
  const doc = readLook(app);
  if (!doc) fail('no_look', `app "${app}" has no look document on the hub yet (node framework/cli/skins.mjs snapshot ${app})`);
  const settings = { ...(doc.own?.settings ?? {}) };
  for (const [k, v] of Object.entries(changes)) { if (v === null) delete settings[k]; else settings[k] = v; }
  doc.own = { ...(doc.own ?? {}), settings };
  doc.updatedBy = `widget-icons:${by}`.slice(0, 80);
  doc.updatedAt = new Date().toISOString();
  const f = lookFile(app); const tmp = `${f}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(doc)}\n`); renameSync(tmp, f);
}

function defaultIcon(id, inv) {
  const row = inv.widgets.find((w) => w.id === id);
  if (row) return row.icon;
  const rule = (inv.rules ?? []).find((r) => r.match.endsWith('*') && id.startsWith(r.match.slice(0, -1)));
  return rule?.icon ?? KIND_ICONS[parseId(id)?.kind] ?? 'box';
}

function resolveOne(id, picks, inv, known) {
  const pick = picks[`axf.widget.${id}.icon`]; let mode = picks[`axf.widget.${id}.mode`];
  const fell = []; let icon = defaultIcon(id, inv); let via = 'default';
  if (pick != null && pick !== '' && pick !== 'own') {
    const r = parseRef(pick);
    if (!r) fell.push(`icon "${pick}" is not an icon ref`);
    else if (!r.pack && !known.has(r.glyph)) fell.push(`icon "${pick}" is not a glyph of the framework`);
    else { icon = r.pack ? `${r.pack}/${r.glyph}` : r.glyph; via = 'pick'; }
  }
  if (mode != null && mode !== '' && !MODES.includes(mode)) { fell.push(`mode "${mode}" is not one of ${MODES.join(', ')}`); mode = null; }
  const row = inv.widgets.find((w) => w.id === id) ?? {};
  return { id, label: row.label ?? id.split(':').slice(2).join(':'), owner: row.owner ?? '', icon, via, mode: mode || 'auto', pick: pick || null, default: defaultIcon(id, inv), fell };
}

export function list(app = '', q = '') {
  app = appOf(app);
  const inv = inventory(); const picks = picksOf(app); const known = new Set(glyphs());
  const ids = inv.widgets.map((w) => w.id);
  for (const k of Object.keys(picks)) { const id = k.slice('axf.widget.'.length).replace(/\.(icon|mode)$/, ''); if (parseId(id) && !ids.includes(id)) ids.push(id); }
  const out = ids.map((id) => resolveOne(id, picks, inv, known)).filter((w) => !q || w.id.toLowerCase().includes(q.toLowerCase()) || w.label.toLowerCase().includes(q.toLowerCase()));
  return { app, look: !!readLook(app), widgets: out };
}

export function get(id, app = '') {
  if (!parseId(id)) fail('bad_widget', `"${id}" is not a widget id (<host>:<kind>:<id>)`);
  app = appOf(app);
  return { app, widget: resolveOne(id, picksOf(app), inventory(), new Set(glyphs())) };
}

export function set(id, icon, mode, app = '', by = 'cli') {
  if (!parseId(id)) fail('bad_widget', `"${id}" is not a widget id (<host>:<kind>:<id>)`);
  if (icon == null && mode == null) fail('nothing_to_set', 'give an icon, --mode or both');
  const changes = {};
  if (icon != null) {
    if (icon === '' || icon === 'own') changes[`axf.widget.${id}.icon`] = null;
    else {
      const r = parseRef(icon);
      if (!r) fail('bad_icon', `"${icon}" is not an icon ref (<glyph>, <pack>/<glyph> or own)`);
      if (!r.pack && !glyphs().includes(r.glyph)) fail('unknown_icon', `no icon "${icon}" (axf widget-icon glyphs lists them)`);
      changes[`axf.widget.${id}.icon`] = r.pack ? `${r.pack}/${r.glyph}` : r.glyph;
    }
  }
  if (mode != null) {
    if (mode === '' || mode === 'auto') changes[`axf.widget.${id}.mode`] = null;
    else if (MODES.includes(mode)) changes[`axf.widget.${id}.mode`] = mode;
    else fail('bad_mode', `mode must be one of auto, ${MODES.join(', ')}`);
  }
  writeSettings(appOf(app), changes, by);
  return get(id, app);
}

export function reset(id = '', app = '', by = 'cli') {
  const a = appOf(app);
  if (id) {
    if (!parseId(id)) fail('bad_widget', `"${id}" is not a widget id`);
    writeSettings(a, { [`axf.widget.${id}.icon`]: null, [`axf.widget.${id}.mode`]: null }, by);
    return get(id, a);
  }
  writeSettings(a, Object.fromEntries(Object.keys(picksOf(a)).map((k) => [k, null])), by);
  return list(a);
}

/* ---------------- the console's REST API (no /projects here) ---------------- */

async function rest(method, path, body) {
  const base = (process.env.AXF_CONSOLE_URL || '').replace(/\/$/, '');
  const res = await fetch(`${base}/api/widget-icons${path}`, { method, headers: { 'content-type': 'application/json', ...(process.env.AXF_TOKEN ? { authorization: `Bearer ${process.env.AXF_TOKEN}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const out = await res.json().catch(() => ({ ok: false, message: `HTTP ${res.status}` }));
  if (!res.ok || out.ok === false) fail(out.code ?? 'http', out.message ?? `HTTP ${res.status}`);
  return out;
}

const flag = (args, name) => { const i = args.indexOf(`--${name}`); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v ?? ''; };
const line = (w) => `${w.id.padEnd(44)} ${w.icon.padEnd(22)} ${w.via.padEnd(8)} ${w.mode.padEnd(10)} ${w.label}${w.fell?.length ? `  ⚠ ${w.fell.join('; ')}` : ''}`;

export async function main(argv = process.argv.slice(2)) {
  const args = [...argv];
  const json = args.includes('--json'); if (json) args.splice(args.indexOf('--json'), 1);
  const app = flag(args, 'app') ?? ''; const q = flag(args, 'q') ?? ''; const mode = flag(args, 'mode');
  const [cmd = 'list', id = '', icon] = args;
  const remote = !!process.env.AXF_CONSOLE_URL && !existsSync(looksDir());
  const appQ = app ? `?app=${encodeURIComponent(app)}` : '';
  try {
    let out;
    switch (cmd) {
      case 'list': out = remote ? await rest('GET', `${appQ}${q ? `${appQ ? '&' : '?'}q=${encodeURIComponent(q)}` : ''}`) : list(app, q); break;
      case 'get': out = remote ? await rest('GET', `/${id}${appQ}`) : get(id, app); break;
      case 'set': out = remote ? await rest('PUT', `/${id}`, { icon, mode, app: app || undefined, by: 'cli' }) : set(id, icon, mode, app); break;
      case 'reset': out = remote ? await rest(id ? 'DELETE' : 'POST', id ? `/${id}${appQ}` : '/reset', id ? undefined : { app: app || undefined }) : reset(id, app); break;
      case 'glyphs': out = { glyphs: glyphs().filter((g) => g.includes(q)) }; break;
      case 'open': out = await rest('POST', `/${id}/open`, {}); break;
      default: console.error('usage: axf widget-icon list|get|set|reset|glyphs|open … (see framework/cli/widget-icon.mjs)'); return 2;
    }
    if (json) console.log(JSON.stringify(out, null, 2));
    else if (out.widgets) { console.log(`${out.app}${out.look === false ? ' (no look document yet)' : ''}`); out.widgets.forEach((w) => console.log(line(w))); }
    else if (out.widget) console.log(line(out.widget));
    else if (out.glyphs) console.log(out.glyphs.join(' '));
    else console.log(JSON.stringify(out));
    return 0;
  } catch (e) {
    console.error(`✗ ${e.code ? `${e.code}: ` : ''}${e.message}`);
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main();
