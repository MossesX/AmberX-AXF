#!/usr/bin/env node
/**
 * UI Review → Screenshots CLI (ui-screenshot@1): ad-hoc screenshots that are NOT waiting for Brett's approval (a check
 * session looking at a screen, a live capture, PR before/after). Usually run as `node framework/cli/shot.mjs` / `axf shot`.
 *
 *   shot <file> [<file>…] [--title "…"] [--app A] [--screen S] [--source check|build|pr|manual|watch-live]
 *        [--session S] [--build B] [--agent A] [--viewport phone|desktop] [--pair <id>] [--side before|after]
 *        [--note "…"] [--branch B] [--pr N] [--taken <ISO time>] [--group "<name>" | --group-id <id>] [--console | --local] [--json]
 *   shot list [--app A] [--source S] [--q text] [--group <id>] [--console | --local] [--json]
 *   shot groups [--q "name / date / app / source"] [--json]          the groups, newest first (name, time, count)
 *   shot group new "<name>" | rename <id> "<name>" | merge <from-id> <into-id> | delete <id> [--into <id>]
 *   shot move <shot-id[,id…]> <group-id | "new or today's group name">
 *   shot promote <id[,id…]> [--kind screen] [--title "…"] [--console | --local]   send to the approve / reject queue
 *   shot migrate [--local]       move UI Review items titled "Breakroom check: …" into Screenshots
 *   shot paths
 *
 * Where it goes: the running console when AXF_CONSOLE_URL + AXF_TOKEN are set (or --console), so Brett sees it at once;
 * otherwise (or --local) this checkout's UI Review data folder (AXF_UI_REVIEW_DIR overrides). Default --source: check.
 * Device: --viewport, else "phone" when the file name says so (…-phone.png), else desktop.
 * Groups (shot-group@1): every screenshot is in exactly one group. --group "<name>" files them in the group of that name
 * made today (made if new); no group = '<session/build/source> - <YYYY-MM-DD HH:mm>'. Ask Brett for the name first
 * (offer a default like 'Breakroom check - Oct 31 8:20 PM'); headless sessions name the group after their build.
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from './web/shots-core.mjs';
import * as gc from './web/groups-core.mjs';
import { dataDir, submitLocal } from './review.mjs';

const IMG = /\.(png|jpe?g|webp)$/i;
const readJson = (f, d) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return d; } };
const writeJson = (f, v) => { mkdirSync(dirname(f), { recursive: true }); const t = `${f}.tmp`; writeFileSync(t, JSON.stringify(v, null, 1)); renameSync(t, f); };
export const shotsDir = () => join(dataDir(), 'screenshots');
const indexFile = () => join(shotsDir(), 'index.json');
export const loadShots = () => { const d = readJson(indexFile(), null); const doc = d && Array.isArray(d.shots) ? d : { $axf: 'ui-screenshots@1', shots: [] }; if (!Array.isArray(doc.groups)) doc.groups = []; return doc; };
const saveShots = (doc) => writeJson(indexFile(), doc);
const tz = () => process.env.AXF_SHOT_TZ || gc.DEFAULT_TZ;

/** Local: the group for these fields (an existing --group-id, else today's group of that name, made if new). */
export function ensureGroupLocal(fields, at = new Date().toISOString()) {
  const doc = loadShots();
  if (fields.groupId) { const g = doc.groups.find((x) => x.id === fields.groupId); if (!g) throw new Error(`no such group: ${fields.groupId}`); return g; }
  const { group, created } = gc.resolveGroup(doc.groups, { ...fields, name: fields.group }, at, tz());
  if (created) { doc.groups.push(group); saveShots(doc); }
  return group;
}

/** Local repair: every screenshot gets a group (shots from before groups → '<title prefix> - <date time>'). */
export function repairLocal() {
  const doc = loadShots();
  const ids = new Set(doc.groups.map((g) => g.id));
  if (doc.shots.every((x) => ids.has(x.group))) return [];
  const r = gc.assignGroups(doc.groups, doc.shots, tz());
  doc.groups = r.groups; doc.shots = r.shots; saveShots(doc);
  return r.made;
}

/** Local group edits: rename / merge / move / delete (delete without --into deletes the group's screenshots). */
export function groupLocal(op, a, b) {
  const doc = loadShots();
  if (op === 'new') { const g = ensureGroupLocal({ group: a, source: 'manual' }); return { group: g }; }
  if (op === 'rename') { doc.groups = gc.renameGroup(doc.groups, a, b); saveShots(doc); return { group: doc.groups.find((g) => g.id === a) }; }
  if (op === 'merge') { const r = gc.mergeGroups(doc.groups, doc.shots, a, b); doc.groups = r.groups; doc.shots = r.shots; saveShots(doc); return { moved: r.moved }; }
  if (op === 'move') { const r = gc.moveShots(doc.groups, doc.shots, a, b); doc.shots = r.shots; saveShots(doc); return { moved: r.moved }; }
  if (op === 'delete') {
    if (!doc.groups.some((g) => g.id === a)) throw new Error('no such group');
    if (b) { const r = gc.mergeGroups(doc.groups, doc.shots, a, b); doc.groups = r.groups; doc.shots = r.shots; saveShots(doc); return { deleted: a, moved: r.moved, removed: [] }; }
    const gone = doc.shots.filter((x) => x.group === a);
    for (const x of gone) rmSync(join(shotsDir(), 'files', x.file), { force: true });
    doc.shots = doc.shots.filter((x) => x.group !== a); doc.groups = doc.groups.filter((g) => g.id !== a); saveShots(doc);
    return { deleted: a, moved: 0, removed: gone.map((x) => x.id) };
  }
  throw new Error('usage: group new "<name>" | rename <id> "<name>" | merge <from> <into> | delete <id> [--into <id>]');
}

/** PNG / JPEG / WebP by its first bytes (the server checks the same). */
export function imageType(buf) {
  if (buf.length > 4 && buf[0] === 0x89 && buf[1] === 0x50) return 'png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8) return 'jpg';
  if (buf.length > 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return '';
}

/** Local add: the record in screenshots/index.json, the picture in screenshots/files/<id>.<ext>. */
export function addLocal(fields, file, groupId = '') {
  const buf = readFileSync(file); const type = imageType(buf);
  if (!type) throw new Error(`not a PNG / JPEG / WebP: ${file}`);
  const name = basename(file);
  const { group: _name, groupId: _gid, ...rest } = fields;
  const gid = groupId || ensureGroupLocal(fields).id;
  const doc = loadShots();
  const { shot, problems } = core.normShot({ ...rest, group: gid, id: undefined, title: fields.title || core.titleOf(name), viewport: fields.viewport || core.viewportOf(name), size: buf.length, promoted: [] });
  if (problems.length) throw new Error(problems.join('; '));
  shot.file = `${shot.id}.${type}`;
  shot.side = core.sideFor(doc.shots, shot.pair, shot.side);
  mkdirSync(join(shotsDir(), 'files'), { recursive: true });
  copyFileSync(file, join(shotsDir(), 'files', shot.file));
  doc.shots.push(shot); writeJson(indexFile(), doc);
  return shot;
}

/** Local "Send to review": a review item in items.json with the picture copied (the screenshot stays). */
export function promoteLocal(ids, { kind = 'screen', title = '' } = {}) {
  const doc = loadShots(); const items = [];
  for (const id of ids) {
    const s = doc.shots.find((x) => x.id === id);
    if (!s) throw new Error(`no such screenshot: ${id}`);
    const src = join(shotsDir(), 'files', s.file); const ext = s.file.split('.').pop();
    const tmpDir = mkdtempSync(join(tmpdir(), 'axf-shot-')); const tmp = join(tmpDir, `${String(s.screen || s.title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'screen'}-${s.viewport}.${ext}`);
    copyFileSync(src, tmp);
    try {
      const item = submitLocal({ kind, title: (ids.length === 1 && title) || s.title, app: s.app, build: s.build, branch: s.branch, pr: s.pr, notes: [s.note, `Sent from Screenshots (${s.id}).`].filter(Boolean).join('\n'), source: 'screenshots', by: 'cli', fromShot: s.id }, [tmp]);
      s.promoted = [...(s.promoted ?? []), item.id].slice(-20); items.push(item);
    } finally { rmSync(tmpDir, { recursive: true, force: true }); }
  }
  writeJson(indexFile(), doc);
  return items;
}

/** Local migration (same rule as the server's): "Breakroom check: …" review items → screenshots. */
export function migrateLocal() {
  const itemsFile = join(dataDir(), 'items.json');
  const items = readJson(itemsFile, null);
  if (!items || !Array.isArray(items.items)) return { moved: [], shots: [] };
  const r = core.migrateItems(items.items);
  if (!r.moved.length) return { moved: [], shots: [] };
  const doc = loadShots(); const added = [];
  for (const { shot, from } of r.shots) {
    const m = /^items\/([a-z0-9][a-z0-9:._-]{0,80})\/([a-z0-9][a-z0-9._-]{0,120})$/.exec(from ?? '');
    const f = m ? join(dataDir(), 'shots', m[1], m[2]) : '';
    if (!f || !existsSync(f)) continue;
    const buf = readFileSync(f); const type = imageType(buf);
    if (!type) continue;
    if (!doc.shots.some((x) => x.id === shot.id)) { shot.file = `${shot.id}.${type}`; shot.size = buf.length; mkdirSync(join(shotsDir(), 'files'), { recursive: true }); copyFileSync(f, join(shotsDir(), 'files', shot.file)); doc.shots.push(shot); }
    added.push(shot.id);
  }
  writeJson(indexFile(), doc);
  items.items = r.keep; writeJson(itemsFile, items);
  for (const id of r.moved) rmSync(join(dataDir(), 'shots', id), { recursive: true, force: true });
  const log = readJson(join(shotsDir(), 'migrated.json'), []);
  writeJson(join(shotsDir(), 'migrated.json'), [...(Array.isArray(log) ? log : []), { at: new Date().toISOString(), items: r.moved, shots: added }]);
  return { moved: r.moved, shots: added, groups: repairLocal() };
}

async function consoleCall(path, body) {
  const url = process.env.AXF_CONSOLE_URL, tok = process.env.AXF_TOKEN;
  if (!url || !tok) throw new Error('--console needs AXF_CONSOLE_URL and AXF_TOKEN');
  const r = await fetch(`${url.replace(/\/$/, '')}/api/plugins/ui-review/${path}`, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`console ${r.status}: ${typeof j.detail === 'string' ? j.detail : r.statusText}`);
  return j;
}

/** Flags; --console, --local, --json and --help never take a value (so `--local shot.png` keeps the file). */
const BOOL = new Set(['console', 'local', 'json', 'help']);
export function parseArgs(argv) {
  const pos = [], flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { pos.push(a); continue; }
    const k = a.slice(2); const next = argv[i + 1];
    if (BOOL.has(k) || next === undefined || next.startsWith('--')) flags[k] = true; else { flags[k] = next; i++; }
  }
  return { pos, flags };
}
const val = (v) => (v === true || v === undefined ? '' : String(v));
export const fieldsOf = (f) => ({
  title: val(f.title), app: val(f.app), screen: val(f.screen), source: val(f.source) || 'check', session: val(f.session) || process.env.CLAUDE_SESSION_ID || '',
  build: val(f.build), agent: val(f.agent), viewport: val(f.viewport), pair: val(f.pair), side: val(f.side), note: val(f.note), branch: val(f.branch),
  pr: val(f.pr) || null, takenAt: val(f.taken) || new Date().toISOString(), by: val(f.by) || 'cli',
  group: val(f.group), groupId: val(f['group-id']),
});
const line = (x) => `${x.id.padEnd(22)} ${core.sourceInfo(x.source).label.padEnd(10)} ${x.viewport.padEnd(7)} ${x.title}${x.app ? ` · ${x.app}` : ''}${x.screen ? ` · ${x.screen}` : ''}${x.pair ? ` · pair ${x.pair} (${x.side})` : ''}`;

export async function main(argv = process.argv.slice(2)) {
  const { pos, flags } = parseArgs(argv);
  const json = !!flags.json;
  const remote = flags.local ? false : flags.console ? true : !!(process.env.AXF_CONSOLE_URL && process.env.AXF_TOKEN);
  const out = (v, text) => console.log(json ? JSON.stringify(v) : text);
  const [cmd = 'help'] = pos;
  if (cmd === 'help' || flags.help) { const src = readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n'); console.log(src.slice(2, src.indexOf(' */')).map((l) => l.replace(/^ \*\s?/, '')).join('\n')); return; }
  if (cmd === 'list') {
    if (!remote) repairLocal();
    const shots = remote ? (await consoleCall('shots')).shots : loadShots().shots;
    const rows = core.sortShots(core.filterShots(shots, { app: val(flags.app), source: val(flags.source), q: val(flags.q) })).filter((x) => !val(flags.group) || x.group === val(flags.group));
    return out({ ok: true, shots: rows }, rows.length ? rows.map(line).join('\n') : 'no screenshots');
  }
  if (cmd === 'groups') {
    if (!remote) repairLocal();
    const d = remote ? await consoleCall('shots') : loadShots();
    const rows = gc.groupRows(d.groups ?? [], d.shots).filter((g) => gc.matchGroup(g, val(flags.q), tz()));
    return out({ ok: true, groups: rows.map(({ cover, ...g }) => ({ ...g, cover: cover?.id ?? null })) }, rows.length ? rows.map((g) => `${g.id.padEnd(20)} ${gc.stamp(g.createdAt, tz())}  ${String(g.count).padStart(3)} shot(s)  ${g.name}${g.source ? ` · ${g.source}` : ''}`).join('\n') : 'no groups');
  }
  if (cmd === 'group') {
    const [, op, a, b] = pos;
    const into = val(flags.into);
    const r = remote
      ? op === 'new' ? await consoleCall('shots/groups', { name: a, source: 'manual' })
        : op === 'rename' ? await consoleCall('shots/groups/update', { id: a, name: b })
          : op === 'merge' ? await consoleCall('shots/groups/merge', { from: a, into: b })
            : op === 'delete' ? await consoleCall('shots/groups/delete', { id: a, ...(into ? { into } : {}) })
              : groupLocal('?')
      : groupLocal(op, a, op === 'delete' ? into : b);
    return out({ ok: true, ...r }, r.group ? `group ${r.group.id}: ${r.group.name}` : r.deleted ? `deleted group ${r.deleted}${r.moved ? `, ${r.moved} screenshot(s) moved to ${into}` : `, ${r.removed.length} screenshot(s) deleted`}` : `moved ${r.moved} screenshot(s)`);
  }
  if (cmd === 'move') {
    const ids = String(pos[1] ?? '').split(',').filter(Boolean); const target = String(pos[2] ?? '');
    if (!ids.length || !target) throw new Error('usage: move <shot-id[,id…]> <group-id | "group name">');
    const isId = gc.isGroupId(target);
    const r = remote ? await consoleCall('shots/move', { ids, ...(isId ? { group: target } : { groupName: target }) })
      : groupLocal('move', ids, isId ? target : ensureGroupLocal({ group: target, source: 'manual' }).id);
    return out({ ok: true, ...r }, `moved ${r.moved} screenshot(s)`);
  }
  if (cmd === 'promote') {
    const ids = String(pos[1] ?? '').split(',').filter(Boolean);
    if (!ids.length) throw new Error('usage: promote <id[,id…]> [--kind screen] [--title "…"]');
    const items = remote ? (await consoleCall('shots/promote', { ids, kind: val(flags.kind), title: val(flags.title) })).items : promoteLocal(ids, { kind: val(flags.kind) || 'screen', title: val(flags.title) });
    return out({ ok: true, items }, items.map((it) => `sent to review: ${it.id} ${it.title} (waiting for Brett in UI Review)`).join('\n'));
  }
  if (cmd === 'migrate') {
    const r = remote ? await consoleCall('shots/migrate', {}) : migrateLocal();
    return out({ ok: true, ...r }, r.moved.length ? `moved ${r.moved.length} review item(s) into Screenshots: ${r.shots.length} screenshot(s)` : 'nothing to move');
  }
  if (cmd === 'paths') return out({ ok: true, dataDir: shotsDir() }, `screenshots ${shotsDir()}`);
  // shot <file>… (the default command)
  const files = (cmd === 'add' ? pos.slice(1) : pos).map((f) => resolve(f));
  if (!files.length) throw new Error('give at least one screenshot file (PNG, JPEG or WebP)');
  for (const f of files) { if (!existsSync(f) || !statSync(f).isFile()) throw new Error(`no such file: ${f}`); if (!IMG.test(f)) throw new Error(`not a PNG / JPEG / WebP: ${f}`); }
  const fields = fieldsOf(flags);
  if (fields.source && !core.SOURCE_IDS.includes(fields.source)) throw new Error(`--source must be one of ${core.SOURCE_IDS.join(', ')}`);
  if (fields.viewport && !core.VIEWPORTS.includes(fields.viewport)) throw new Error('--viewport must be phone or desktop');
  if (fields.side && !core.SIDES.includes(fields.side)) throw new Error('--side must be before or after');
  const many = files.length > 1;
  const group = remote ? '' : ensureGroupLocal(fields).id;  // one group for every file of this call
  const shots = remote
    ? (await consoleCall('shots', { ...fields, files: files.map((f) => ({ name: basename(f), data: readFileSync(f).toString('base64'), ...(many && fields.title ? { title: `${fields.title} · ${core.titleOf(basename(f))}` } : {}) })) })).shots
    : files.map((f) => addLocal({ ...fields, title: many && fields.title ? `${fields.title} · ${core.titleOf(basename(f))}` : fields.title }, f, group));
  return out({ ok: true, shots, where: remote ? 'console' : 'local' }, shots.map((x) => `saved ${x.id}: ${x.title} (${x.viewport}${x.pair ? `, ${x.side} of ${x.pair}` : ''}) → Screenshots${remote ? '' : ` (local: ${shotsDir()})`}`).join('\n'));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(`shot: ${e.message}`); process.exit(2); });
}
