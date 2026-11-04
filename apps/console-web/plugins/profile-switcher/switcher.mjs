#!/usr/bin/env node
/**
 * Profile switcher CLI (ai.amberx.axf.console.profile-switcher). The console server part calls it with --json; any
 * session can too.
 *
 * Two separate things (Brett, Nov 3 2026):
 *   - the ACTIVE profile: where new builds go. Saved by framework/cli/profiles.mjs (build-profiles@1), unchanged here;
 *   - the VIEW FILTER (profile-filter@1, framework/core/engines/profile-filter.mjs): which profiles' builds every builds
 *     table draws. 'all' = no filter. Every bulk action acts on what the filter shows; CLI / MCP bulk commands take it
 *     by default (`resolveFilter`), with an explicit `profiles` argument to override.
 *
 *   node apps/console-web/plugins/profile-switcher/switcher.mjs list              every profile + counts, the active one, the filter
 *   … current                                                                 the active profile and the filter
 *   … select <id|all>                                                         <id>: make it the active profile AND show only it;
 *                                                                             all: show every profile (active profile unchanged)
 *   … filter [<all|id,id…>] [--toggle <id>]                                    read or set the view filter
 *   … settings ['<json>']                                                     read or save the widget settings
 *   … visible [--profiles <all|id,id…>]                                        the builds the filter shows (what a bulk command acts on)
 *
 * Data: the filter and widget settings live in this plugin's data folder (.axf-console/plugins/profile-switcher,
 * AXF_PROFILE_SWITCHER_DIR overrides); uninstalling it leaves no filter behind (= every profile shown).
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as pf from '../../../../framework/core/engines/profile-filter.mjs';
import { FINISHED, buildsOf } from '../../../../framework/plan/builds-store-core.mjs';
import { loadStore } from '../../../../framework/cli/builds-store.mjs';
import { act as profilesAct } from '../../../../framework/cli/profiles.mjs';
import { activeProfile, readProfiles } from '../../../../framework/cli/persist.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../../..');
export const FOLDER = 'profile-switcher';
export const DATA_DIR = process.env.AXF_PROFILE_SWITCHER_DIR || join(ROOT, '.axf-console/plugins', FOLDER);
const FILTER_FILE = () => join(DATA_DIR, 'filter.json');
const SETTINGS_FILE = () => join(DATA_DIR, 'settings.json');

export const DEFAULT_SETTINGS = Object.freeze({
  $axf: 'profile-switcher-settings@1',
  counts: true, // show pending/running counts on the chip and in the list
  mode: 'full', // 'full' = "Current · 12" | 'compact' = dot + short name
  hidden: [], // profiles left out of the list (still filterable from the CLI)
  order: [], // profiles listed first, in this order
  tones: {}, // per-profile chip tone (theme tones only: profile-filter PROFILE_TONES)
  placements: ['toolbar'], // where the widget is attached: toolbar | banner
});

const readJson = (f, fallback) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return fallback; } };
function writeJson(f, v) {
  mkdirSync(dirname(f), { recursive: true });
  const tmp = `${f}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(v, null, 1)}\n`);
  renameSync(tmp, f);
}
const known = () => readProfiles().profiles.map((p) => p.id);

export function normalizeSettings(raw, ids = known()) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const list = (v) => (Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === 'string' && ids.includes(x)))] : []);
  const tones = {};
  for (const [k, v] of Object.entries(r.tones && typeof r.tones === 'object' ? r.tones : {})) if (ids.includes(k) && pf.PROFILE_TONES.includes(v)) tones[k] = v;
  const placements = Array.isArray(r.placements) ? [...new Set(r.placements.filter((x) => x === 'toolbar' || x === 'banner'))] : [...DEFAULT_SETTINGS.placements];
  return { ...DEFAULT_SETTINGS, counts: r.counts !== false, mode: r.mode === 'compact' ? 'compact' : 'full', hidden: list(r.hidden), order: list(r.order), tones, placements };
}

export const savedFilter = () => pf.normalizeFilter(readJson(FILTER_FILE(), null), known());
export function saveFilter(raw) {
  const f = pf.normalizeFilter(raw, known());
  writeJson(FILTER_FILE(), { ...f, updatedAt: new Date().toISOString() });
  return f;
}
export const readSettings = () => normalizeSettings(readJson(SETTINGS_FILE(), {}));
export function saveSettings(raw) { const s = normalizeSettings({ ...readSettings(), ...(raw ?? {}) }); writeJson(SETTINGS_FILE(), { ...s, updatedAt: new Date().toISOString() }); return s; }

/** Every profile with its build counts (open = not built/complete/archived; running), plus the active one and the filter. */
export function list() {
  const reg = readProfiles();
  const store = loadStore();
  const settings = readSettings();
  const profiles = reg.profiles.map((p) => {
    const bs = buildsOf(store, p.id);
    return {
      id: p.id, name: p.name, description: p.description ?? '', base: !!p.base,
      tone: pf.profileTone(p.id, reg.profiles, settings.tones),
      counts: { builds: bs.length, open: bs.filter((b) => !FINISHED.includes(b.status) && b.status !== 'archived').length, running: bs.filter((b) => b.status === 'running').length },
    };
  });
  const all = store.builds.filter((b) => !b.deleted);
  const filter = savedFilter();
  const { hidden } = pf.applyFilter(all, filter);
  return {
    ok: true, active: reg.active, effective: activeProfile().id, filter, label: pf.filterLabel(filter, profiles), hidden,
    total: { builds: all.length, open: all.filter((b) => !FINISHED.includes(b.status) && b.status !== 'archived').length, running: all.filter((b) => b.status === 'running').length },
    listed: pf.orderProfiles(profiles, settings).map((p) => p.id), profiles, settings,
  };
}

export function current() {
  const l = list();
  const p = l.profiles.find((x) => x.id === l.effective);
  return { ok: true, active: l.active, effective: l.effective, profile: p, filter: l.filter, label: l.label, hidden: l.hidden };
}

/** <id>: the active profile (new builds go there) and the view shows only it. 'all': every profile shown, active unchanged. */
export function select(id) {
  const target = String(id ?? '').trim();
  if (!target) throw new Error('select needs a profile id or "all"');
  if (pf.isAll(pf.normalizeFilter(target))) { saveFilter('all'); return { ...list(), log: ['showing every profile'] }; }
  if (!known().includes(target)) throw new Error(`no build profile "${target}"`);
  const log = [];
  if (readProfiles().active !== target) { const r = profilesAct({ action: 'select', id: target }); log.push(...(r?.log ?? [`active profile → ${target}`])); }
  saveFilter([target]);
  log.push(`showing ${target}`);
  return { ...list(), log };
}

export function filter(arg, toggle) {
  if (toggle) return { ...list(), filter: saveFilter(pf.toggleProfile(savedFilter(), toggle, known())), log: [`toggled ${toggle}`] };
  if (arg !== undefined) saveFilter(arg);
  return list();
}

/** The builds the filter shows: what a CLI / MCP bulk command acts on. `profiles` overrides the saved filter. */
export function visible(profilesArg) {
  const store = loadStore();
  const f = pf.resolveFilter(profilesArg, readJson(FILTER_FILE(), null), known());
  const { shown, hidden } = pf.applyFilter(store.builds.filter((b) => !b.deleted), f);
  return { ok: true, filter: f, label: pf.filterLabel(f, readProfiles().profiles), hidden, builds: shown.map((b) => ({ id: b.id, title: b.title, status: b.status, profiles: b.profiles })) };
}

function main(argv) {
  const json = argv.includes('--json');
  const args = argv.filter((a) => a !== '--json');
  const flag = (k) => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
  const toggle = flag('--toggle');
  const profiles = flag('--profiles');
  const [cmd = 'list', arg] = args;
  const out = (r, text) => { console.log(json ? JSON.stringify(r) : text(r)); };
  const line = (r) => r.profiles.map((p) => `${p.id === r.effective ? '★' : ' '} ${pf.isAll(r.filter) || r.filter.ids.includes(p.id) ? '◉' : '○'} ${p.name} (${p.id}) · ${p.counts.open} open · ${p.counts.running} running`).join('\n') + `\nshowing: ${r.label}${r.hidden ? ` · ${r.hidden} hidden` : ''}`;
  try {
    if (cmd === 'list') return out(list(), line);
    if (cmd === 'current') return out(current(), (r) => `active: ${r.profile?.name ?? r.effective} (${r.effective}) · showing: ${r.label}${r.hidden ? ` · ${r.hidden} hidden` : ''}`);
    if (cmd === 'select') return out(select(arg), (r) => `${r.log.join('; ')}\n${line(r)}`);
    if (cmd === 'filter') return out(filter(arg, toggle), line);
    if (cmd === 'settings') return out(arg ? { ok: true, settings: saveSettings(JSON.parse(arg)) } : { ok: true, settings: readSettings() }, (r) => JSON.stringify(r.settings, null, 1));
    if (cmd === 'visible') return out(visible(profiles), (r) => `${r.builds.length} visible (${r.label})${r.hidden ? `, ${r.hidden} hidden and untouched` : ''}\n${r.builds.map((b) => `  ${b.id} · ${b.status} · ${b.profiles.join(',')}`).join('\n')}`);
    console.error(`unknown command ${cmd}`); process.exitCode = 2;
  } catch (e) {
    if (json) console.log(JSON.stringify({ ok: false, error: e.message })); else console.error(e.message);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
