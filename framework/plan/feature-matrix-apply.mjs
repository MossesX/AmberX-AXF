/**
 * Feature matrix Apply engine (feature-matrix@1). Pure: no fs, no DOM. Projects one matrix onto every table the
 * build lives in, idempotently and without deleting anything:
 *
 *   build    orchestrator@1 build        steps get `skip`, estimate and model from their item; a kept item with no
 *                                        step becomes a new step `fm-<item id>` (never for a skipped item)
 *   pending  pending@1 item              sub prompts get `skip` + `fm` (item id); item estimate = kept minutes
 *   queue    build-queue@1 step record   small steps the same way; record estimate = kept minutes
 *   change   change-log@1 entry          queued steps of skipped items → `skipped` (done/failed/running stay);
 *                                        estimate.minutes = kept minutes (cost cleared: it is recomputed by the owner)
 *   feature  plan@1 feature              acceptance lines get `skip` + `fm`; feature.matrix = { id, version, kept… }
 *
 * Matching: an item finds its row by the `fm` tag (pending / queue / change / plan) or by step id (`source.id`, else
 * `fm-<item id>`), then by exact text. Rows the matrix does not know are left alone. Running Apply twice with the same
 * matrix yields no changes, and nothing already done is undone: a skipped step keeps its `done`.
 *
 * Every projection returns { target, changes: [{ target, id, path, from, to }] }; applyAll() runs all of them and adds
 * a what-changed report. Writers (the plugin server, the CLI) persist the returned targets and then record the matrix
 * as applied: fm.apply(state, { action: 'applied', matrix: id, version }).
 */
import { APPLIED_PREFIX, formatMinutes, isKept, totals } from './feature-matrix-core.mjs';

const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
const stepIdFor = (it) => (it.source?.kind === 'step' && it.source.id ? it.source.id : `${APPLIED_PREFIX}${it.id}`);
const sameText = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
const change = (target, id, path, from, to) => ({ target, id, path, from: from === undefined ? null : from, to: to === undefined ? null : to });

/** Set `obj[key] = to` when it differs, recording the change. */
function set(changes, target, id, obj, key, to, path = key) {
  const from = obj[key];
  if (JSON.stringify(from) === JSON.stringify(to)) return false;
  if (to === undefined) delete obj[key]; else obj[key] = to;
  changes.push(change(target, id, path, from, to)); return true;
}

/** Find an item's row in a list of tagged rows (`fm`), else by text. */
function rowFor(rows, item) {
  return rows.find((r) => r?.fm === item.id) ?? rows.find((r) => !r?.fm && sameText(r?.text, item.name)) ?? null;
}

// ---- orchestrator@1

export function projectBuild(build, matrix, now = new Date().toISOString()) {
  const b = clone(build); const changes = []; const id = b?.id ?? '';
  if (!b || !Array.isArray(b.steps)) return { target: b, changes };
  for (const it of matrix.items) {
    const sid = stepIdFor(it);
    let step = b.steps.find((s) => s.id === sid) ?? b.steps.find((s) => s.id === `${APPLIED_PREFIX}${it.id}`) ?? b.steps.find((s) => !matrix.items.some((o) => stepIdFor(o) === s.id) && sameText(s.text, it.name));
    if (!step) {
      if (!isKept(it)) continue; // a skipped item that never had a step gets none
      step = { id: `${APPLIED_PREFIX}${it.id}`, text: it.name, model: it.model, why: it.why, phase: '', group: it.group, estimate: it.minutes ? `${it.minutes} min` : '', files: [], checks: [], session: 'same', agent: false, done: false, doneAt: '', note: 'from the feature matrix', skip: false };
      b.steps.push(step); changes.push(change('build', id, `steps.${step.id}`, null, 'added')); continue;
    }
    const p = `steps.${step.id}.`;
    set(changes, 'build', id, step, 'skip', !isKept(it), `${p}skip`);
    if (it.minutes) set(changes, 'build', id, step, 'estimate', `${it.minutes} min`, `${p}estimate`);
    set(changes, 'build', id, step, 'model', it.model, `${p}model`);
    if (it.why && !step.why) set(changes, 'build', id, step, 'why', it.why, `${p}why`);
    if (it.group && !step.group) set(changes, 'build', id, step, 'group', it.group, `${p}group`);
  }
  if (changes.length) b.updatedAt = now;
  return { target: b, changes };
}

// ---- pending@1 item and build-queue@1 record: both carry small steps [{ text, estimate?, done?, doneAt?, skip?, fm? }]

function projectSteps(rows, matrix, target, id, now, withAt) {
  const changes = [];
  for (const it of matrix.items) {
    let row = rowFor(rows, it);
    if (!row) {
      if (!isKept(it)) continue;
      row = { text: it.name, ...(withAt ? { at: now } : {}), ...(it.minutes ? { estimate: `${it.minutes} min` } : {}), fm: it.id };
      rows.push(row); changes.push(change(target, id, `steps.${it.id}`, null, 'added')); continue;
    }
    const p = `steps.${it.id}.`;
    set(changes, target, id, row, 'fm', it.id, `${p}fm`);
    set(changes, target, id, row, 'skip', isKept(it) ? undefined : true, `${p}skip`);
    if (it.minutes) set(changes, target, id, row, 'estimate', `${it.minutes} min`, `${p}estimate`);
  }
  return changes;
}

export function projectPending(item, matrix, now = new Date().toISOString()) {
  const p = clone(item); if (!p || typeof p !== 'object') return { target: p, changes: [] };
  if (!Array.isArray(p.subPrompts)) p.subPrompts = [];
  const changes = projectSteps(p.subPrompts, matrix, 'pending', p.id ?? '', now, true);
  const kept = totals(matrix).keptMinutes;
  if (kept) set(changes, 'pending', p.id ?? '', p, 'estimate', formatMinutes(kept));
  if (changes.length) p.updatedAt = now;
  return { target: p, changes };
}

export function projectQueueRecord(record, matrix, now = new Date().toISOString(), id = '') {
  const r = clone(record ?? {}); if (!Array.isArray(r.steps)) r.steps = [];
  const changes = projectSteps(r.steps, matrix, 'queue', id || matrix.ref.id, now, false);
  const kept = totals(matrix).keptMinutes;
  if (kept) set(changes, 'queue', id || matrix.ref.id, r, 'estimate', formatMinutes(kept));
  return { target: r, changes };
}

// ---- change-log@1 (build manager entry)

export function projectChange(entry, matrix, now = new Date().toISOString()) {
  const e = clone(entry); if (!e || typeof e !== 'object') return { target: e, changes: [] };
  if (!Array.isArray(e.steps)) e.steps = []; const changes = []; const id = e.id ?? '';
  for (const it of matrix.items) {
    let row = rowFor(e.steps, it);
    if (!row) {
      if (!isKept(it)) continue;
      row = { text: it.name, state: 'queued', fm: it.id }; e.steps.push(row); changes.push(change('change', id, `steps.${it.id}`, null, 'added')); continue;
    }
    const p = `steps.${it.id}.`;
    set(changes, 'change', id, row, 'fm', it.id, `${p}fm`);
    if (!isKept(it) && row.state === 'queued') set(changes, 'change', id, row, 'state', 'skipped', `${p}state`);
    if (isKept(it) && row.state === 'skipped') set(changes, 'change', id, row, 'state', 'queued', `${p}state`);
  }
  const kept = totals(matrix).keptMinutes;
  if (kept) {
    const est = e.estimate && typeof e.estimate === 'object' ? e.estimate : {};
    if (est.minutes !== kept) { const from = clone(e.estimate ?? null); e.estimate = { minutes: kept }; changes.push(change('change', id, 'estimate', from, e.estimate)); }
  }
  if (changes.length) e.updatedAt = now;
  return { target: e, changes };
}

// ---- plan@1 feature

export function projectFeature(feature, matrix) {
  const f = clone(feature); if (!f || typeof f !== 'object') return { target: f, changes: [] };
  if (!Array.isArray(f.acceptance)) f.acceptance = []; const changes = []; const id = f.id ?? '';
  for (const it of matrix.items) {
    let row = rowFor(f.acceptance, it);
    if (!row) {
      if (!isKept(it)) continue;
      row = { text: it.name, done: false, fm: it.id }; f.acceptance.push(row); changes.push(change('feature', id, `acceptance.${it.id}`, null, 'added')); continue;
    }
    const p = `acceptance.${it.id}.`;
    set(changes, 'feature', id, row, 'fm', it.id, `${p}fm`);
    set(changes, 'feature', id, row, 'skip', isKept(it) ? undefined : true, `${p}skip`);
  }
  const t = totals(matrix);
  set(changes, 'feature', id, f, 'matrix', { id: matrix.id, version: matrix.version, keptMinutes: t.keptMinutes, kept: t.kept, skipped: t.skipped });
  return { target: f, changes };
}

/**
 * Project onto every target given ({ build?, pending?, queue?, change?, feature? }; missing ones are skipped).
 * Returns { targets, report: { matrix, version, keptMinutes, skippedMinutes, targets: [...], changes, summary } }.
 */
export function applyAll(matrix, targets, now = new Date().toISOString()) {
  const out = {}; const changes = []; const done = [];
  const run = (key, fn) => { if (targets?.[key] === undefined) return; const r = fn(targets[key]); out[key] = r.target; changes.push(...r.changes); done.push(key); };
  run('build', (x) => projectBuild(x, matrix, now));
  run('pending', (x) => projectPending(x, matrix, now));
  run('queue', (x) => projectQueueRecord(x, matrix, now));
  run('change', (x) => projectChange(x, matrix, now));
  run('feature', (x) => projectFeature(x, matrix));
  const t = totals(matrix);
  const per = Object.fromEntries(done.map((k) => [k, changes.filter((c) => c.target === k).length]));
  const summary = `${matrix.id} v${matrix.version}: ${t.kept} kept (${formatMinutes(t.keptMinutes) || '0 min'}), ${t.skipped} skipped (${formatMinutes(t.skippedMinutes) || '0 min'}); ${changes.length} change${changes.length === 1 ? '' : 's'} across ${done.length} target${done.length === 1 ? '' : 's'}${done.length ? ` (${done.map((k) => `${k} ${per[k]}`).join(', ')})` : ''}`;
  return { targets: out, report: { matrix: matrix.id, version: matrix.version, keptMinutes: t.keptMinutes, skippedMinutes: t.skippedMinutes, targets: done, perTarget: per, changes, summary, at: now } };
}
