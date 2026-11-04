/**
 * pending — the Pending builds list (pending@1) on top of plan/pending-core.mjs. Since the master cleanup (Oct 31 2026)
 * Pending is a status of a build in the one builds store (builds@1, framework/cli/builds-store.mjs): the list is the
 * active profile's projection of the store and every change is absorbed back into it (versioned). The old
 * framework/plan/pending.json files are read-only snapshots. AXF_PENDING_FILE points at a plain pending@1 file (tests).
 *   node framework/cli/pending.mjs                 list (sorted by status)
 *   node framework/cli/pending.mjs --sort added    list sorted by date added (also: built)
 *   node framework/cli/pending.mjs --steps         also list every sub prompt (step) with its build-time estimate and ✓ when done
 *   node framework/cli/pending.mjs --check-steps   small-steps rule (Oct 21 2026): list open builds over 30 min that have no
 *                                                  steps, a step over 30 min or a step without an estimate. Warns, exit 0
 *                                                  (add --strict to fail). Runs in CI.
 *   node framework/cli/pending.mjs --json          the whole state as JSON
 * The console API and MCP server go through engine-rpc ops pending / pending-act.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../plan/pending-core.mjs';
import { activeProfile } from './persist.mjs';
import { loadPricing } from './model-pricing.mjs';
import { loadStore, storeFile, withStore } from './builds-store.mjs';
import { absorbPending, projectPending } from '../plan/builds-store-core.mjs';

const PRICING = loadPricing();
const usd = (model, min) => (min ? core.formatUsd(core.costForMinutes(model, min, PRICING)) : '');

const FRAMEWORK_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LEGACY = process.env.AXF_PENDING_FILE || ''; // tests: a plain pending@1 file
export const PENDING = LEGACY || storeFile();
const profile = () => activeProfile().id;

export function loadPending() {
  if (LEGACY) return core.normalizeState(existsSync(LEGACY) ? JSON.parse(readFileSync(LEGACY, 'utf8')) : core.emptyPending());
  return core.normalizeState(projectPending(loadStore(), profile()));
}
export function savePending(s, change = null, by = 'pending') {
  if (LEGACY) { writeFileSync(LEGACY, JSON.stringify(s, null, 1) + '\n'); return; }
  const p = profile();
  withStore((st) => absorbPending(st, p, s, change), { by, action: `pending:${change?.action ?? 'save'}`, note: change?.id ?? '' });
}

/** Apply one action (see pending-core apply) to the profile's Pending view of the store, under the store lock. */
export function actPending(action, now = new Date().toISOString()) {
  if (LEGACY) { const r = core.apply(loadPending(), action, now); savePending(r.state); return r; }
  const p = profile();
  let r;
  const by = process.env.AXF_ACTOR || 'pending';
  const saved = withStore((st) => { r = core.apply(core.normalizeState(projectPending(st, p)), action, now); return absorbPending(st, p, r.state, action, { now }); }, { by, action: `pending:${action?.action}`, note: action?.id ?? '' });
  const state = core.normalizeState(projectPending(saved.store, p));
  const item = r.item ? state.items.find((x) => x.id === r.item.id) ?? r.item : r.item;
  return { ...r, state, item };
}

const OPEN = (it) => it.status !== 'complete';

/** Open items that break the small-steps rule. */
export function unsplitPending(state = loadPending()) {
  return state.items.filter(OPEN).map((it) => ({ it, check: core.splitCheck(it) })).filter((x) => x.check.needsSplit).map(({ it, check }) => ({ id: it.id, title: it.title, model: it.model, estimate: core.itemEstimate(it), reasons: check.reasons }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--sort');
  const key = i > 0 ? process.argv[i + 1] : 'status';
  const s = loadPending();
  if (process.argv.includes('--json')) { console.log(JSON.stringify(s, null, 1)); process.exit(0); }
  if (process.argv.includes('--check-steps')) {
    const bad = unsplitPending(s);
    const open = s.items.filter(OPEN);
    const left = {};
    for (const it of open) { const p = core.stepsProgress(it); left[it.model] = (left[it.model] ?? 0) + p.minutesLeft; }
    console.log(`pending: ${open.length} open build(s) · time left ${Object.entries(left).map(([m, n]) => `${m} ${core.formatMinutes(n) || '0 min'}${usd(m, n) ? ` (~${usd(m, n)})` : ''}`).join(' · ')}`);
    for (const b of bad) console.log(`  ⚠ ${b.id} (${b.model}, ~${b.estimate || '?'}): ${b.reasons.join('; ')}`);
    if (!bad.length) console.log('  every open build over 30 min is split into steps of 30 min or less');
    else console.log(`  ${bad.length} build(s) break the small-steps rule (builds over 30 min are split into steps of ≤ 30 min, each with an estimate)`);
    process.exit(bad.length && process.argv.includes('--strict') ? 1 : 0);
  }
  for (const it of core.sortItems(s.items, key)) {
    const d = core.shownDate(it);
    const est = core.itemEstimate(it);
    const p = core.stepsProgress(it);
    const prog = p.total ? ` [${p.done}/${p.total} steps${p.minutesLeft ? `, ${core.formatMinutes(p.minutesLeft)} left` : ''}]` : '';
    const cost = usd(it.model, it.status === 'complete' ? core.entryMinutes(it) : p.minutesLeft);
    console.log(`${core.STATUS_LABEL[it.status].padEnd(9)} ${it.model.padEnd(7)} ${d.label} ${d.at.slice(0, 10)}  ${(est ? `~${est}` : '').padEnd(8)} ${(cost ? `~${cost}` : '').padEnd(7)} ${it.title}  (${it.id})${prog}`);
    if (process.argv.includes('--steps')) for (const [k, sp] of it.subPrompts.entries()) { const c = usd(it.model, core.estimateMinutes(sp.estimate)); console.log(`    ${sp.done ? '✓' : ' '}${String(k + 1).padStart(2)}. ${(sp.estimate ? `~${sp.estimate}` : '').padEnd(8)} ${(c ? `~${c}` : '').padEnd(7)} ${sp.text.slice(0, 110)}`); }
  }
  const open = s.items.filter(OPEN);
  const leftBy = {};
  for (const it of open) leftBy[it.model] = (leftBy[it.model] ?? 0) + core.stepsProgress(it).minutesLeft;
  const total = Object.entries(leftBy).reduce((a, [m, n]) => a + (core.costForMinutes(m, n, PRICING) ?? 0), 0);
  console.log(Object.entries(core.counts(s.items)).map(([k, n]) => `${k} ${n}`).join(' · '));
  console.log(`left: ${Object.entries(leftBy).map(([m, n]) => `${m} ${core.formatMinutes(n) || '0 min'} (~${usd(m, n) || '$0.00'})`).join(' · ')} · all ~${core.formatUsd(total) || '$0.00'} (estimate: minutes × the model's price per working minute, framework/schemas/model-pricing.json)`);
}
