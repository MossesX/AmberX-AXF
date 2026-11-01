#!/usr/bin/env node
/**
 * UI Review CLI (review-item@1): builds submit the UI they made for Brett's approval; anything can read the state.
 *
 *   node apps/console-web/plugins/ui-review/review.mjs submit --name "…" --app A --screen S --shots a.png,b.png
 *        [--group "<name>"] [--kind <section>] [--shots-dir <dir>] [--build B] [--step S] [--branch B] [--pr N]
 *        [--notes "…"] [--source <source>] [--by <type:id>] [--console] [--json]
 *   node apps/console-web/plugins/ui-review/review.mjs list [--kind K] [--status waiting|changes|rejected|approved|open]
 *        [--branch B] [--pr N] [--q text] [--console] [--json]
 *   node apps/console-web/plugins/ui-review/review.mjs state [--branch B] [--pr N] [--exit-code] [--console] [--json]
 *   node apps/console-web/plugins/ui-review/review.mjs decide <id[,id…]> approve|changes|reject|reopen [--comment "…"] [--console]
 *   node apps/console-web/plugins/ui-review/review.mjs migrate [--apply] [--report <file.md>]   older items → ui-review-item@1
 *   node apps/console-web/plugins/ui-review/review.mjs check        every stored item + screenshot conforms (exit 1 if not)
 *   node apps/console-web/plugins/ui-review/review.mjs kinds | paths
 *
 * Every item is ui-review-item@1 (framework/core/ui-review-schema.mjs): a human name (--name; --title is the same),
 * a group (--group "<name>": ask Brett for it; none = '<session/build/source> - <YYYY-MM-DD HH:mm>'), app, screen,
 * source and sender. Source and sender come from --source / --by, else from the Claude Code session running this
 * (headless when unattended); anything still missing is refused with the field named. --kind is the section.
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
import * as cf from './web/conform.mjs';
import * as gc from './web/groups-core.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, '../../../..');
const manifest = JSON.parse(readFileSync(join(HERE, 'plugin.json'), 'utf8'));
export const dataDir = () => resolve(process.env.AXF_UI_REVIEW_DIR || join(ROOT, manifest.lifecycle.dataDir));
const IMG = /\.(png|jpe?g|webp)$/i;

const readJson = (f, d) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return d; } };
const writeJson = (f, v) => { mkdirSync(dirname(f), { recursive: true }); const t = `${f}.tmp`; writeFileSync(t, JSON.stringify(v, null, 1)); renameSync(t, f); };
const itemsFile = () => join(dataDir(), 'items.json');
/** items.json → working records (+ design-pack decisions as pack:<id> records, + the groups). */
export function loadDoc() {
  const d = readJson(itemsFile(), null);
  const doc = d && Array.isArray(d.items) ? d : { $axf: 'ui-review-items@1', items: [] };
  const packs = Object.values(doc.packDecisions ?? {});
  return { ...doc, groups: Array.isArray(doc.groups) ? doc.groups : [], items: [...doc.items.map(cf.storedToReview), ...packs] };
}
/** Working records → items.json, refusing to write anything that isn't ui-review-item@1 / ui-review-group@1. */
export function saveDoc(doc) {
  const packDecisions = {}; const items = []; const errors = [];
  for (const it of doc.items) {
    if (String(it.id).startsWith('pack:')) { packDecisions[it.id] = it; continue; }
    const r = cf.reviewToStored(it, doc.groups); items.push(r.item);
    errors.push(...r.errors.map((e) => ({ ...e, message: `${it.id}: ${e.message}` })));
  }
  const groups = doc.groups.map((g) => cf.groupToStored(g).group);
  errors.push(...cf.storeErrors([], groups));
  if (errors.length) { const legacy = doc.items.some((it) => it.$axf && it.$axf !== 'review-item@1' && it.$axf !== cf.ITEM_TAG); throw new cf.schema.UiReviewSchemaError(errors.concat(legacy ? [{ field: '$axf', code: 'invalid', message: 'run review.mjs migrate --apply first' }] : [])); }
  writeJson(itemsFile(), { $axf: 'ui-review-items@1', items, groups, packDecisions });
}
const tz = () => process.env.AXF_SHOT_TZ || gc.DEFAULT_TZ;

/**
 * Where a CLI call comes from, when the caller didn't say: the Claude Code session running it (CLAUDECODE), headless
 * when nobody is attending it (CLAUDE_CODE_SESSION_ATTENDED=0 or an AXF_SESSION run). Detected, never guessed: with no
 * session around, source and sender stay missing and the item is refused.
 */
export function caller(env = process.env, branch = '') {
  if (!env.CLAUDECODE && !env.CLAUDE_CODE_SESSION_ID) return { source: '', submittedBy: undefined, session: '' };
  const headless = env.CLAUDE_CODE_SESSION_ATTENDED === '0' || !!env.AXF_SESSION;
  const sid = env.CLAUDE_CODE_SESSION_ID || env.AXF_SESSION || '';
  const submittedBy = headless && branch ? { type: 'build', id: branch } : sid ? { type: 'session', id: sid } : undefined;
  return { source: headless ? 'headless' : 'claude-code', submittedBy, session: headless && branch ? branch : sid ? `session ${sid.slice(0, 8)}` : '' };
}

/** The group a new item goes in (today's group of that name, made if new; no name = the automatic one). */
export function ensureReviewGroup(doc, fields, at) {
  const { group, created } = gc.resolveGroup(doc.groups, { name: fields.group, source: fields.source, session: fields.groupSession || '', build: fields.build, app: fields.app }, at, tz());
  if (created) doc.groups.push(group);
  return group;
}
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
  const now = new Date().toISOString();
  const { item, problems } = core.normItem({ ...fields, status: 'waiting' }, { now });
  if (problems.length) throw new Error(problems.join('; '));
  const doc = loadDoc();
  const g = ensureReviewGroup(doc, item, now);
  item.group = g.id; delete item.groupSession;
  const used = new Set();
  const names = files.map((f, i) => { let n = safeName(f, i); while (used.has(n)) n = `${i + 1}-${n}`; used.add(n); return n; });
  const out = { ...item, shots: names.map((n) => ({ src: `items/${item.id}/${n}`, device: core.deviceOf(n), name: core.shotName(n) })) };
  doc.items.push(out);
  const check = cf.reviewToStored(out, doc.groups); cf.refuse(check.errors); // nothing is copied for a refused item
  const dir = join(dataDir(), 'shots', item.id);
  files.forEach((f, i) => { mkdirSync(dir, { recursive: true }); copyFileSync(f, join(dir, names[i])); });
  saveDoc(doc);
  return check.item;
}

export function decideLocal(ids, decision, { comment = '', by = 'brett' } = {}) {
  if (!(decision in core.DECISIONS)) throw new Error(`decision must be one of ${Object.keys(core.DECISIONS).join(', ')}`);
  const doc = loadDoc(); const at = new Date().toISOString();
  const r = core.bulkDecide(doc.items, ids, decision, { comment, by, at });
  for (const x of r.missing.filter((x) => /^pack:[a-z0-9][a-z0-9-]{0,60}$/.test(x))) { r.items.push(core.decide({ id: x, kind: core.DESIGN_KIND, status: 'waiting', comment: '', history: [] }, decision, { comment, by, at })); r.changed.push(x); }
  doc.items = r.items; saveDoc(doc);
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
export function fieldsOf(f, env = process.env) {
  const branch = val(f.branch);
  const who = caller(env, branch || val(f.build));
  return { kind: val(f.kind) || 'other', title: val(f.name) || val(f.title), app: val(f.app), screen: val(f.screen), build: val(f.build), step: val(f.step) || undefined, branch, pr: val(f.pr) || null,
    notes: val(f.notes) || val(f.note), source: val(f.source) || who.source, submittedBy: val(f.by) || who.submittedBy, group: val(f.group), groupSession: who.session };
}
const line = (it) => `${core.statusInfo(it.status).label.padEnd(13)} ${it.id.padEnd(22)} ${it.kind.padEnd(11)} ${it.title}${it.app ? ` · ${it.app}` : ''}${it.pr ? ` · #${it.pr}` : ''}${it.branch ? ` · ${it.branch}` : ''} (${it.shots.length} shots)`;

export async function main(argv = process.argv.slice(2)) {
  const { pos, flags } = parseArgs(argv);
  const [cmd = 'help'] = pos;
  const json = !!flags.json; const remote = !!flags.console;
  const out = (v, text) => console.log(json ? JSON.stringify(v) : text);
  if (cmd === 'submit') {
    const files = shotFiles(flags); const fields = fieldsOf(flags);
    if (!core.isKind(fields.kind)) throw new Error(`--kind must be lowercase letters, digits and dashes (sections: ${kinds().map((k) => k.id).join(', ')})`);
    const item = remote
      ? (await consoleCall('submit', { ...fields, files: files.map((f) => ({ name: basename(f), device: core.deviceOf(basename(f)), data: readFileSync(f).toString('base64') })) })).item
      : submitLocal(fields, files);
    const n = (item.files?.after?.length ?? 0) + (item.files?.before?.length ?? 0);
    return out({ ok: true, item }, `submitted ${item.id}: ${item.name} (${item.section}, ${n} screenshots, group "${item.group?.name}") — waiting for Brett in UI Review`);
  }
  if (cmd === 'list') {
    const items = remote ? (await consoleCall('items')).items.map(cf.storedToReview) : submitted(loadDoc());
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
  if (cmd === 'migrate') {
    const { migrateAll } = await import('./migrate.mjs');
    const r = migrateAll(dataDir(), { apply: !!flags.apply });
    if (flags.report && flags.report !== true) { mkdirSync(dirname(resolve(flags.report)), { recursive: true }); writeFileSync(resolve(flags.report), r.report); }
    if (!r.ok) process.exitCode = 1;
    return out(r, r.report);
  }
  if (cmd === 'check') {
    const { checkAll } = await import('./migrate.mjs');
    const r = checkAll(dataDir());
    if (r.errors.length) process.exitCode = 1;
    return out(r, r.errors.length ? r.errors.map((e) => `✗ ${e.message}`).join('\n') : `✓ ${r.items} item(s), ${r.shots} screenshot(s), ${r.groups} group(s): all ui-review-item@1 / ui-review-group@1`);
  }
  if (cmd === 'kinds') { const k = kinds(); return out({ ok: true, kinds: k }, k.map((x) => `${x.id.padEnd(12)} ${x.label}`).join('\n')); }
  if (cmd === 'paths') return out({ ok: true, dataDir: dataDir(), items: itemsFile() }, `data folder ${dataDir()}\nitems ${itemsFile()}`);
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(2, 30).map((l) => l.replace(/^ \*\s?/, '')).join('\n'));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(`ui-review: ${e.message}`); process.exit(2); });
}
