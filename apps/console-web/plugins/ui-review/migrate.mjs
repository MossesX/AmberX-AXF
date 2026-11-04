/**
 * Migration to ui-review-item@1 / ui-review-group@1 (Brett, Nov 1 2026: everything in UI Review has a name, a timestamp
 * and one schema). Rewrites both stores of a UI Review data folder:
 *   items.json             review-item@1 queue items → ui-review-item@1 (kind review); design-pack decisions → packDecisions
 *   screenshots/index.json ui-screenshot@1 shots → ui-review-item@1 (kind screenshot); shot-group@1 groups → ui-review-group@1
 * Names come from titles (else the screen, else the picture's file name), timestamps from submittedAt / takenAt (else
 * the picture's file time), groups stay where they are (screenshots) or are made by build / branch and day (queue).
 * Dry run by default: returns the report and writes nothing. apply: backs both files up (<file>.pre-schema-<time>)
 * and writes them. Idempotent: a folder already on the schema reports "nothing to change".
 * Used by `review.mjs migrate [--apply]` and by the server on start (server/conform.py runs it through node).
 */
import { copyFileSync, existsSync, readFileSync, renameSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as S from '../../../../framework/core/ui-review-schema.mjs';
import * as gc from './web/groups-core.mjs';

const readJson = (f, d) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return d; } };
const writeJson = (f, v) => { mkdirSync(dirname(f), { recursive: true }); const t = `${f}.tmp`; writeFileSync(t, JSON.stringify(v, null, 1)); renameSync(t, f); };
const mtime = (f) => { try { return statSync(f).mtime.toISOString(); } catch { return ''; } };
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/** An older group record (shot-group@1, or none) → ui-review-group@1. */
function groupOf(g, fallbackAt) {
  const out = { ...g, $axf: S.GROUP_TAG, createdAt: S.isTimestamp(g.createdAt) ? g.createdAt : fallbackAt, source: S.sourceFrom(g.source || 'console') };
  if (S.nameProblem(out.name, out.id)) out.name = `${out.session || out.build || 'Screenshots'} - ${S.stamp(out.createdAt)}`;
  for (const k of Object.keys(out)) if (out[k] === '') delete out[k];
  return out;
}

export function planFolder(dir, { now = new Date().toISOString() } = {}) {
  const itemsFile = join(dir, 'items.json');
  const shotsFile = join(dir, 'screenshots', 'index.json');
  const out = { items: null, shots: null, rows: [], errors: [] };

  // the review queue
  const idoc = readJson(itemsFile, null);
  if (idoc && Array.isArray(idoc.items)) {
    const groups = (Array.isArray(idoc.groups) ? idoc.groups : []).filter(isObj).map((g) => groupOf(g, now));
    const byId = new Map(groups.map((g) => [g.id, g]));
    const packDecisions = { ...(idoc.packDecisions ?? {}) };
    const items = [];
    for (const it of idoc.items) {
      if (!isObj(it)) continue;
      if (String(it.id).startsWith('pack:')) { packDecisions[it.id] = it; out.rows.push({ store: 'queue', id: it.id, name: it.id, changes: ['design-pack decision → packDecisions'] }); continue; }
      const fileTime = (src) => { const m = /^items\/([^/]+)\/(.+)$/.exec(String(src)); return m ? mtime(join(dir, 'shots', m[1], m[2])) : ''; };
      const groupFor = (o, at) => {
        if (typeof o.group === 'string' && byId.has(o.group)) return { id: o.group, name: byId.get(o.group).name };
        const label = String(o.build || o.branch || 'UI Review').trim();
        const name = `${label} - ${String(at).slice(0, 10)}`;
        const id = S.groupId(name, at);
        if (!byId.has(id)) { const g = { $axf: S.GROUP_TAG, id, name, createdAt: at, source: S.sourceFrom(o.source), note: 'Made by the ui-review-item@1 migration (by build / day).' }; byId.set(id, g); groups.push(g); }
        return { id, name };
      };
      const { item, changes } = S.migrateLegacy(it, { kind: 'review', fileTime, groupFor, now });
      items.push(item);
      if (changes.length) out.rows.push({ store: 'queue', id: item.id, name: item.name, changes });
      for (const e of S.validateItem(item).errors) out.errors.push(`${item.id}: ${e.message}`);
    }
    for (const g of groups) for (const e of S.validateGroup(g).errors) out.errors.push(`group ${g.id}: ${e.message}`);
    out.items = { file: itemsFile, before: idoc, after: { $axf: 'ui-review-items@1', items, groups, packDecisions } };
  }

  // screenshots
  const sdoc = readJson(shotsFile, null);
  if (sdoc && Array.isArray(sdoc.shots)) {
    // shots from before groups: Screenshots' own rule ('<title prefix or session> - <date time of the first one>')
    const raw = Array.isArray(sdoc.groups) ? sdoc.groups.filter(isObj) : [];
    const assigned = gc.assignGroups(raw, sdoc.shots.filter(isObj).map((x) => (isObj(x.group) ? { ...x, group: x.group.id } : x)).map((x) => ({ ...x, takenAt: x.takenAt ?? x.createdAt })), process.env.AXF_SHOT_TZ || gc.DEFAULT_TZ);
    const groups = assigned.groups.map((g) => groupOf(g, now));
    for (const g of groups) { const was = raw.find((x) => x.id === g.id); if (!was) out.rows.push({ store: 'groups', id: g.id, name: g.name, changes: ['group made for screenshots that had none'] }); else if (was.$axf !== g.$axf) out.rows.push({ store: 'groups', id: g.id, name: g.name, changes: [`${was.$axf ?? 'group'} → ui-review-group@1`] }); }
    const byId = new Map(groups.map((g) => [g.id, g]));
    const shots = [];
    for (const x0 of assigned.shots) {
      const x = { ...x0 };
      if (x.$axf === S.ITEM_TAG) { x.group = { id: x0.group, name: byId.get(x0.group)?.name ?? '' }; delete x.takenAt; }
      const groupFor = (o, at) => {
        if (typeof o.group === 'string' && byId.has(o.group)) return { id: o.group, name: byId.get(o.group).name };
        const label = String(o.session || o.build || o.source || 'Screenshots').trim();
        const name = `${label} - ${String(at).slice(0, 10)}`;
        const id = S.groupId(name, at);
        if (!byId.has(id)) { const g = { $axf: S.GROUP_TAG, id, name, createdAt: at, source: S.sourceFrom(o.source), note: 'Made by the ui-review-item@1 migration (by source / day).' }; byId.set(id, g); groups.push(g); }
        return { id, name };
      };
      const fileTime = (src) => mtime(join(dir, 'screenshots', 'files', String(src)));
      const { item, changes } = S.migrateLegacy(x, { kind: 'screenshot', fileTime, groupFor, now });
      shots.push(item);
      if (changes.length) out.rows.push({ store: 'screenshots', id: item.id, name: item.name, changes });
      for (const e of S.validateItem(item).errors) out.errors.push(`${item.id}: ${e.message}`);
    }
    for (const g of groups) for (const e of S.validateGroup(g).errors) out.errors.push(`group ${g.id}: ${e.message}`);
    out.shots = { file: shotsFile, before: sdoc, after: { ...sdoc, $axf: 'ui-screenshots@1', shots, groups } };
  }
  return out;
}

const changed = (p) => p && JSON.stringify(p.before) !== JSON.stringify(p.after);

export function report(plan, { dir, apply }) {
  const L = [`# UI Review → ui-review-item@1 migration (${apply ? 'applied' : 'dry run'})`, '', `Data folder: \`${dir}\``, ''];
  const n = (p, k) => (p ? p.after[k].length : 0);
  L.push(`- Queue items: ${n(plan.items, 'items')} (design-pack decisions: ${plan.items ? Object.keys(plan.items.after.packDecisions).length : 0}), queue groups: ${n(plan.items, 'groups')}`);
  L.push(`- Screenshots: ${n(plan.shots, 'shots')}, screenshot groups: ${n(plan.shots, 'groups')}`);
  L.push(`- Records changed: ${plan.rows.length}`, `- Still not conforming after the migration: ${plan.errors.length}`, '');
  if (plan.rows.length) { L.push('| Store | Id | Name | What was filled / changed |', '|---|---|---|---|'); for (const r of plan.rows) L.push(`| ${r.store} | \`${r.id}\` | ${String(r.name).replace(/\|/g, '/')} | ${r.changes.join('; ').replace(/\|/g, '/')} |`); L.push(''); }
  if (plan.errors.length) { L.push('## Not conforming', ''); for (const e of plan.errors) L.push(`- ${e}`); L.push(''); }
  if (!plan.rows.length && !plan.errors.length) L.push('Nothing to change: every item, screenshot and group already conforms.', '');
  return L.join('\n');
}

/** Dry run (default) or apply. Returns { ok, applied, changed, rows, errors, report, backups }. */
export function migrateAll(dir, { apply = false, now = new Date().toISOString() } = {}) {
  const plan = planFolder(dir, { now });
  const backups = [];
  const ok = !plan.errors.length;
  if (apply && ok) {
    const tag = now.replace(/[:.]/g, '-');
    for (const p of [plan.items, plan.shots]) {
      if (!changed(p)) continue;
      if (existsSync(p.file)) { const b = `${p.file}.pre-schema-${tag}`; copyFileSync(p.file, b); backups.push(b); }
      writeJson(p.file, p.after);
    }
  }
  return { ok, applied: apply && ok, changed: plan.rows.length, rows: plan.rows, errors: plan.errors, backups, report: report(plan, { dir, apply: apply && ok }) };
}

/** Every stored record conforms (what `review.mjs check` and the tests run). */
export function checkAll(dir) {
  const idoc = readJson(join(dir, 'items.json'), { items: [], groups: [] });
  const sdoc = readJson(join(dir, 'screenshots', 'index.json'), { shots: [], groups: [] });
  const errors = [];
  const run = (items, groups) => {
    const ids = new Set(groups.map((g) => g?.id));
    for (const g of groups) for (const e of S.validateGroup(g).errors) errors.push({ ...e, message: `group ${g?.id}: ${e.message}` });
    for (const it of items) {
      for (const e of S.validateItem(it).errors) errors.push({ ...e, message: `${it?.id}: ${e.message}` });
      if (it?.group?.id && !ids.has(it.group.id)) errors.push({ field: 'group.id', code: 'invalid', message: `${it.id}: group ${it.group.id} is not in the store's groups` });
    }
  };
  run((idoc.items ?? []).filter((it) => !String(it?.id).startsWith('pack:')), idoc.groups ?? []);
  run(sdoc.shots ?? [], sdoc.groups ?? []);
  return { errors, items: (idoc.items ?? []).length, shots: (sdoc.shots ?? []).length, groups: (idoc.groups ?? []).length + (sdoc.groups ?? []).length };
}
