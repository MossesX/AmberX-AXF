#!/usr/bin/env node
/**
 * UI Review CLI (review-item@1): builds submit the UI they made for Brett's approval; anything can read the state.
 *
 *   node apps/console-web/plugins/ui-review/review.mjs submit --kind settings --title "…" --shots a.png,b.png
 *        [--shots-dir <dir>] [--app A] [--build B] [--branch B] [--pr N] [--notes "…"] [--by <who>] [--console] [--json]
 *   node apps/console-web/plugins/ui-review/review.mjs list [--kind K] [--status waiting|changes|rejected|approved|open]
 *        [--branch B] [--pr N] [--q text] [--console] [--json]
 *   node apps/console-web/plugins/ui-review/review.mjs state [--branch B] [--pr N] [--exit-code] [--console] [--json]
 *   node apps/console-web/plugins/ui-review/review.mjs decide <id[,id…]> approve|changes|reject|reopen [--comment "…"] [--console]
 *   node apps/console-web/plugins/ui-review/review.mjs kinds | paths
 *
 * Kinds are an open registry (kinds.json + the data folder's kinds.json); a new kind id needs no code change.
 * Screenshots named …-phone.png / …-desktop.png get their device from the name. Default: writes the plugin's data
 * folder in this checkout (AXF_UI_REVIEW_DIR overrides). --console posts to the running console instead
 * (AXF_CONSOLE_URL + AXF_TOKEN), which is what a build on the VPS uses so Brett sees it at once.
 * state --exit-code exits 3 when the branch / PR is held (waiting, changes asked or rejected).
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from './web/review-core.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, '../../../..');
const manifest = JSON.parse(readFileSync(join(HERE, 'plugin.json'), 'utf8'));
export const dataDir = () => resolve(process.env.AXF_UI_REVIEW_DIR || join(ROOT, manifest.lifecycle.dataDir));
const IMG = /\.(png|jpe?g|webp)$/i;

const readJson = (f, d) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return d; } };
const writeJson = (f, v) => { mkdirSync(dirname(f), { recursive: true }); const t = `${f}.tmp`; writeFileSync(t, JSON.stringify(v, null, 1)); renameSync(t, f); };
const itemsFile = () => join(dataDir(), 'items.json');
const loadDoc = () => { const d = readJson(itemsFile(), null); return d && Array.isArray(d.items) ? d : { $axf: 'ui-review-items@1', items: [] }; };
const submitted = (doc) => doc.items.filter((it) => !String(it.id).startsWith('pack:'));
export function kinds() { return core.mergeKinds(readJson(join(HERE, 'kinds.json'), {}).kinds, readJson(join(dataDir(), 'kinds.json'), {}).kinds, submitted(loadDoc())); }

/** Screenshot files from --shots a,b and/or --shots-dir (every image in it). */
export function shotFiles(flags) {
  const list = String(flags.shots === true ? '' : flags.shots ?? '').split(',').map((s) => s.trim()).filter(Boolean).map((s) => resolve(s));
  if (flags['shots-dir'] && flags['shots-dir'] !== true) { const d = resolve(flags['shots-dir']); for (const n of readdirSync(d).sort()) if (IMG.test(n)) list.push(join(d, n)); }
  for (const f of list) { if (!existsSync(f) || !statSync(f).isFile()) throw new Error(`no such screenshot: ${f}`); if (!IMG.test(f)) throw new Error(`not a PNG / JPEG / WebP: ${f}`); }
  return list;
}

const safeName = (n, i) => { let s = basename(n).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '') || `shot-${i + 1}.png`; if (!IMG.test(s)) s += '.png'; return /^[a-z0-9]/.test(s) ? s.slice(0, 120) : `s${s}`.slice(0, 120); };

/** Local submit: the item in items.json, its screenshots copied to shots/<id>/. */
export function submitLocal(fields, files) {
  const { item, problems } = core.normItem({ ...fields, status: 'waiting', source: fields.source || 'cli' });
  if (problems.length) throw new Error(problems.join('; '));
  const dir = join(dataDir(), 'shots', item.id); const used = new Set();
  const shots = files.map((f, i) => { let n = safeName(f, i); while (used.has(n)) n = `${i + 1}-${n}`; used.add(n); mkdirSync(dir, { recursive: true }); copyFileSync(f, join(dir, n)); return { src: `items/${item.id}/${n}`, device: core.deviceOf(n), name: core.shotName(n) }; });
  const out = { ...item, shots };
  const doc = loadDoc(); doc.items.push(out); writeJson(itemsFile(), doc);
  return out;
}

export function decideLocal(ids, decision, { comment = '', by = 'brett' } = {}) {
  if (!(decision in core.DECISIONS)) throw new Error(`decision must be one of ${Object.keys(core.DECISIONS).join(', ')}`);
  const doc = loadDoc(); const at = new Date().toISOString();
  const r = core.bulkDecide(doc.items, ids, decision, { comment, by, at });
  for (const x of r.missing.filter((x) => /^pack:[a-z0-9][a-z0-9-]{0,60}$/.test(x))) { r.items.push(core.decide({ id: x, kind: core.DESIGN_KIND, status: 'waiting', comment: '', history: [] }, decision, { comment, by, at })); r.changed.push(x); }
  doc.items = r.items; writeJson(itemsFile(), doc);
  return { changed: r.changed, missing: r.missing.filter((x) => !r.changed.includes(x)) };
}

/* -------------------------------------------------------------- console API (--console) */
async function consoleCall(path, body) {
  const url = process.env.AXF_CONSOLE_URL, tok = process.env.AXF_TOKEN;
  if (!url || !tok) throw new Error('--console needs AXF_CONSOLE_URL and AXF_TOKEN');
  const r = await fetch(`${url.replace(/\/$/, '')}/api/plugins/ui-review/${path}`, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`console ${r.status}: ${typeof j.detail === 'string' ? j.detail : r.statusText}`);
  return j;
}

/* -------------------------------------------------------------- CLI */
export function parseArgs(argv) {
  const pos = [], flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { pos.push(a); continue; }
    const k = a.slice(2); const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) flags[k] = true; else { flags[k] = next; i++; }
  }
  return { pos, flags };
}
const val = (v) => (v === true || v === undefined ? '' : String(v));
const fieldsOf = (f) => ({ kind: val(f.kind) || 'other', title: val(f.title), app: val(f.app), build: val(f.build), branch: val(f.branch), pr: val(f.pr) || null, notes: val(f.notes), by: val(f.by) || 'build', source: val(f.source) || 'cli' });
const line = (it) => `${core.statusInfo(it.status).label.padEnd(13)} ${it.id.padEnd(22)} ${it.kind.padEnd(11)} ${it.title}${it.app ? ` · ${it.app}` : ''}${it.pr ? ` · #${it.pr}` : ''}${it.branch ? ` · ${it.branch}` : ''} (${it.shots.length} shots)`;

export async function main(argv = process.argv.slice(2)) {
  const { pos, flags } = parseArgs(argv);
  const [cmd = 'help'] = pos;
  const json = !!flags.json; const remote = !!flags.console;
  const out = (v, text) => console.log(json ? JSON.stringify(v) : text);
  if (cmd === 'submit') {
    const files = shotFiles(flags); const fields = fieldsOf(flags);
    if (!fields.title) throw new Error('submit needs --title');
    if (!core.isKind(fields.kind)) throw new Error(`--kind must be lowercase letters, digits and dashes (sections: ${kinds().map((k) => k.id).join(', ')})`);
    const item = remote
      ? (await consoleCall('submit', { ...fields, files: files.map((f) => ({ name: basename(f), device: core.deviceOf(basename(f)), data: readFileSync(f).toString('base64') })) })).item
      : submitLocal(fields, files);
    return out({ ok: true, item }, `submitted ${item.id}: ${item.title} (${item.kind}, ${item.shots.length} screenshots) — waiting for Brett in UI Review`);
  }
  if (cmd === 'list') {
    const items = remote ? (await consoleCall('items')).items : submitted(loadDoc());
    const rows = core.sortItems(core.filterItems(items, { kind: val(flags.kind), status: val(flags.status), branch: val(flags.branch), pr: val(flags.pr) || null, q: val(flags.q) }));
    return out({ ok: true, items: rows }, rows.length ? rows.map(line).join('\n') : 'nothing to review');
  }
  if (cmd === 'state') {
    const branch = val(flags.branch), pr = val(flags.pr).replace(/^#/, '') || null;
    if (!branch && !pr) throw new Error('state needs --branch and/or --pr');
    const s = remote ? await consoleCall(`state?branch=${encodeURIComponent(branch)}&pr=${encodeURIComponent(pr ?? '')}`) : core.reviewState(submitted(loadDoc()), { branch, pr });
    out(s, `${s.state}${s.holds ? ' (holds the merge)' : ''} · waiting ${s.counts.waiting} · changes ${s.counts.changes} · rejected ${s.counts.rejected} · approved ${s.counts.approved}`);
    if (flags['exit-code'] && s.holds) process.exitCode = 3;
    return;
  }
  if (cmd === 'decide') {
    const ids = String(pos[1] ?? '').split(',').filter(Boolean); const decision = String(pos[2] ?? '');
    if (!ids.length || !decision) throw new Error('usage: decide <id[,id…]> approve|changes|reject|reopen [--comment "…"]');
    const r = remote ? await consoleCall('decide', { ids, decision, comment: val(flags.comment), by: val(flags.by) || 'brett' }) : decideLocal(ids, decision, { comment: val(flags.comment), by: val(flags.by) || 'brett' });
    if (r.missing?.length) process.exitCode = 1;
    return out({ ok: true, ...r }, `${decision}: ${r.changed.length} item(s)${r.missing?.length ? ` · not found: ${r.missing.join(', ')}` : ''}`);
  }
  if (cmd === 'kinds') { const k = kinds(); return out({ ok: true, kinds: k }, k.map((x) => `${x.id.padEnd(12)} ${x.label}`).join('\n')); }
  if (cmd === 'paths') return out({ ok: true, dataDir: dataDir(), items: itemsFile() }, `data folder ${dataDir()}\nitems ${itemsFile()}`);
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(2, 19).map((l) => l.replace(/^ \*\s?/, '')).join('\n'));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(`ui-review: ${e.message}`); process.exit(2); });
}
