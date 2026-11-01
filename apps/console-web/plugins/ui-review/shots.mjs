#!/usr/bin/env node
/**
 * UI Review → Screenshots CLI (ui-screenshot@1): ad-hoc screenshots that are NOT waiting for Brett's approval (a check
 * session looking at a screen, a live capture, PR before/after). Usually run as `node framework/cli/shot.mjs` / `axf shot`.
 *
 *   shot <file> [<file>…] [--title "…"] [--app A] [--screen S] [--source check|build|pr|manual|watch-live]
 *        [--session S] [--build B] [--agent A] [--viewport phone|desktop] [--pair <id>] [--side before|after]
 *        [--note "…"] [--branch B] [--pr N] [--taken <ISO time>] [--console | --local] [--json]
 *   shot list [--app A] [--source S] [--q text] [--console | --local] [--json]
 *   shot promote <id[,id…]> [--kind screen] [--title "…"] [--console | --local]   send to the approve / reject queue
 *   shot migrate [--local]       move UI Review items titled "Breakroom check: …" into Screenshots
 *   shot paths
 *
 * Where it goes: the running console when AXF_CONSOLE_URL + AXF_TOKEN are set (or --console), so Brett sees it at once;
 * otherwise (or --local) this checkout's UI Review data folder (AXF_UI_REVIEW_DIR overrides). Default --source: check.
 * Device: --viewport, else "phone" when the file name says so (…-phone.png), else desktop.
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from './web/shots-core.mjs';
import { dataDir, parseArgs, submitLocal } from './review.mjs';

const IMG = /\.(png|jpe?g|webp)$/i;
const readJson = (f, d) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return d; } };
const writeJson = (f, v) => { mkdirSync(dirname(f), { recursive: true }); const t = `${f}.tmp`; writeFileSync(t, JSON.stringify(v, null, 1)); renameSync(t, f); };
export const shotsDir = () => join(dataDir(), 'screenshots');
const indexFile = () => join(shotsDir(), 'index.json');
export const loadShots = () => { const d = readJson(indexFile(), null); return d && Array.isArray(d.shots) ? d : { $axf: 'ui-screenshots@1', shots: [] }; };

/** PNG / JPEG / WebP by its first bytes (the server checks the same). */
export function imageType(buf) {
  if (buf.length > 4 && buf[0] === 0x89 && buf[1] === 0x50) return 'png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8) return 'jpg';
  if (buf.length > 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return '';
}

/** Local add: the record in screenshots/index.json, the picture in screenshots/files/<id>.<ext>. */
export function addLocal(fields, file) {
  const buf = readFileSync(file); const type = imageType(buf);
  if (!type) throw new Error(`not a PNG / JPEG / WebP: ${file}`);
  const name = basename(file);
  const doc = loadShots();
  const { shot, problems } = core.normShot({ ...fields, id: undefined, title: fields.title || core.titleOf(name), viewport: fields.viewport || core.viewportOf(name), size: buf.length, promoted: [] });
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
  return { moved: r.moved, shots: added };
}

async function consoleCall(path, body) {
  const url = process.env.AXF_CONSOLE_URL, tok = process.env.AXF_TOKEN;
  if (!url || !tok) throw new Error('--console needs AXF_CONSOLE_URL and AXF_TOKEN');
  const r = await fetch(`${url.replace(/\/$/, '')}/api/plugins/ui-review/${path}`, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`console ${r.status}: ${typeof j.detail === 'string' ? j.detail : r.statusText}`);
  return j;
}

const val = (v) => (v === true || v === undefined ? '' : String(v));
export const fieldsOf = (f) => ({
  title: val(f.title), app: val(f.app), screen: val(f.screen), source: val(f.source) || 'check', session: val(f.session) || process.env.CLAUDE_SESSION_ID || '',
  build: val(f.build), agent: val(f.agent), viewport: val(f.viewport), pair: val(f.pair), side: val(f.side), note: val(f.note), branch: val(f.branch),
  pr: val(f.pr) || null, takenAt: val(f.taken) || new Date().toISOString(), by: val(f.by) || 'cli',
});
const line = (x) => `${x.id.padEnd(22)} ${core.sourceInfo(x.source).label.padEnd(10)} ${x.viewport.padEnd(7)} ${x.title}${x.app ? ` · ${x.app}` : ''}${x.screen ? ` · ${x.screen}` : ''}${x.pair ? ` · pair ${x.pair} (${x.side})` : ''}`;

export async function main(argv = process.argv.slice(2)) {
  const { pos, flags } = parseArgs(argv);
  const json = !!flags.json;
  const remote = flags.local ? false : flags.console ? true : !!(process.env.AXF_CONSOLE_URL && process.env.AXF_TOKEN);
  const out = (v, text) => console.log(json ? JSON.stringify(v) : text);
  const [cmd = 'help'] = pos;
  if (cmd === 'help' || flags.help) { console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(2, 18).map((l) => l.replace(/^ \*\s?/, '')).join('\n')); return; }
  if (cmd === 'list') {
    const shots = remote ? (await consoleCall('shots')).shots : loadShots().shots;
    const rows = core.sortShots(core.filterShots(shots, { app: val(flags.app), source: val(flags.source), q: val(flags.q) }));
    return out({ ok: true, shots: rows }, rows.length ? rows.map(line).join('\n') : 'no screenshots');
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
  const shots = remote
    ? (await consoleCall('shots', { ...fields, files: files.map((f) => ({ name: basename(f), data: readFileSync(f).toString('base64'), ...(many && fields.title ? { title: `${fields.title} · ${core.titleOf(basename(f))}` } : {}) })) })).shots
    : files.map((f) => addLocal({ ...fields, title: many && fields.title ? `${fields.title} · ${core.titleOf(basename(f))}` : fields.title }, f));
  return out({ ok: true, shots, where: remote ? 'console' : 'local' }, shots.map((x) => `saved ${x.id}: ${x.title} (${x.viewport}${x.pair ? `, ${x.side} of ${x.pair}` : ''}) → Screenshots${remote ? '' : ` (local: ${shotsDir()})`}`).join('\n'));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(`shot: ${e.message}`); process.exit(2); });
}
