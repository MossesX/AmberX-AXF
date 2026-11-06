/**
 * Shipped features: build-hook@1 events → the ledger. The moment a build is created its steps become Planned
 * features (or Planned edits of features that already exist), with Brett's verbatim prompt attached; every later
 * event moves their status along the one lifecycle (Planned → Queued → Building → In PR → Merged → Live, or
 * Cancelled). Idempotent on event id (events_seen), so replays and backfills are safe.
 */
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as L from '../../../../../framework/core/feature-ledger.mjs';
import * as D from './db.mjs';
import { editFrom, matchFeature, splitStep } from './plan.mjs';

const PLUGIN_DIR = join(dirname(fileURLToPath(import.meta.url)), '../..');
let pluginNames = null;
export const plugins = () => (pluginNames ||= (() => { try { return readdirSync(PLUGIN_DIR, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('_')).map((d) => d.name); } catch { return []; } })());

/** builds@1 status → the status of the features and edits that build plans (the contract's reading, feature-ledger@1 statusFromBuild). */
export function statusForBuild(b) { return L.statusFromBuild(b).status; }
const editIdFor = (featureId, buildId, stepUid) => `e-${featureId.replace(/^f-/, '')}--${L.slug(buildId)}-${L.slug(stepUid) || 'pr'}`;

/** Move one feature or edit to `to` when the lifecycle allows it and it is a step forward (cancel: any pending state). */
function moveFeature(db, f, to, why, extra = {}) {
  if (!f) return;
  const ok = to === 'cancelled' ? L.canTransition(f.status, 'cancelled') : (L.canTransition(f.status, to) && L.laterStatus(f.status, to) === to && f.status !== to);
  const restore = extra.restore && (f.status === 'cancelled');
  if (!ok && !restore && !extra.mergedAt) return;
  D.putFeature(db, { ...f, ...(ok || restore ? { status: to } : {}), ...(extra.mergedAt && !f.mergedAt ? { mergedAt: extra.mergedAt } : {}), ...(extra.pr ? { prs: [...f.prs, extra.pr] } : {}), lastChangedAt: extra.at || f.lastChangedAt }, { replace: true, why });
}
function moveEdit(db, e, to, extra = {}) {
  if (!e) return;
  const ok = to === 'cancelled' ? L.canTransition(e.status, 'cancelled') : (L.canTransition(e.status, to) && L.laterStatus(e.status, to) === to);
  if (!ok && !extra.mergedAt && !extra.pr) return;
  D.putEdit(db, { ...e, ...(ok ? { status: to } : {}), ...(extra.mergedAt ? { mergedAt: extra.mergedAt } : {}), ...(extra.pr ? { pr: extra.pr.number } : {}) });
}

/** Plan one build's steps: new features, or edits of the features they change. Returns { features, edits }. */
export function planSteps(db, ev, steps, { split, match, status = 'planned' } = {}) {
  const b = ev.build; const key = L.buildKey(b.profile, b.id);
  const prompt = ev.prompt ? D.putPrompt(db, { build: b.id, profile: b.profile, index: ev.prompt.index || 0, said: ev.prompt.said, at: ev.prompt.at, source: ev.prompt.source, session: ev.prompt.session, link: ev.prompt.link, verbatim: ev.prompt.verbatim }) : D.listPrompts(db, b.id)[0] || null;
  const text = `${b.title}`;
  const out = { features: [], edits: [] };
  const existing = D.listFeatures(db);
  for (const s of steps) {
    if (D.featuresOfStep(db, key, s.uid).length || D.editsOfBuild(db, b.id).some((e) => e.id.endsWith(`--${L.slug(b.id)}-${L.slug(s.uid)}`))) continue; // planned already
    const cands = splitStep(s, { build: b, prompt, at: ev.at, model: s.model, split, source: ev.source || 'live', plugins: plugins() });
    for (const c of cands) {
      const hit = matchFeature(c, existing, { buildId: b.id, text: `${text} ${s.text}`, match });
      if (hit) {
        const e = D.putEdit(db, { ...editFrom(c, hit, { build: b, prompt, at: ev.at, status: s.done ? 'building' : status }), id: editIdFor(hit.id, b.id, s.uid) });
        if (e) out.edits.push(e);
      } else {
        const f = D.putFeature(db, { ...c, status: s.done && status === 'planned' ? 'building' : status, createdAt: ev.at }, { why: `planned by ${b.id}` });
        if (f) { D.linkStep(db, f.id, key, s.uid); out.features.push(f); existing.push(f); }
      }
    }
  }
  return out;
}

/** The features this build created and the edits it makes. */
export function recordsOf(db, b) { return { features: D.featuresOfBuild(db, L.buildKey(b.profile, b.id)).filter((f) => f.builds.some((x) => x.id === L.slug(b.id) && x.role === 'added')), edits: D.editsOfBuild(db, b.id) }; }

export function applyEvent(db, ev, opts = {}) {
  const b = ev.build; const why = `${ev.event} (${b.id})`;
  D.putBuild(db, { id: b.id, profile: b.profile, title: b.title, category: b.category, status: b.status, branch: b.branch, pr: b.pr, repo: b.repo, mergedAt: b.mergedAt, createdAt: b.createdAt, prompt: L.promptId(b.id, 0) });
  const pr = b.pr ? { repo: b.repo, number: b.pr, role: 'added' } : null;
  if (pr) D.putPr(db, { repo: b.repo, number: b.pr, branch: b.branch, build: b.id, profile: b.profile, mergedAt: b.mergedAt });
  switch (ev.event) {
    case 'created': { const r = planSteps(db, ev, ev.steps, { ...opts, status: statusForBuild(b) === 'cancelled' ? 'planned' : statusForBuild(b) }); return { ...r, moved: 0 }; }
    case 'steps-added': return planSteps(db, ev, ev.steps, { ...opts, status: statusForBuild(b) });
    case 'addendum': {
      if (!ev.prompt) return {};
      const p = D.putPrompt(db, { build: b.id, profile: b.profile, index: ev.prompt.index, said: ev.prompt.said, at: ev.prompt.at, source: ev.prompt.source, session: ev.prompt.session, link: ev.prompt.link, verbatim: ev.prompt.verbatim });
      const { features } = recordsOf(db, b);
      for (const f of features) if (p && !f.prompts.some((x) => x.id === p.id)) D.putFeature(db, { ...f, prompts: [...f.prompts, { id: p.id, passage: '' }] }, { replace: true, why });
      return { prompt: p };
    }
    case 'step-done': {
      const key = L.buildKey(b.profile, b.id);
      for (const s of ev.steps) {
        for (const f of D.featuresOfStep(db, key, s.uid)) moveFeature(db, f, 'building', why, { at: ev.at });
        for (const e of D.editsOfBuild(db, b.id).filter((x) => x.id.endsWith(`--${L.slug(b.id)}-${L.slug(s.uid)}`))) moveEdit(db, e, 'building');
      }
      return {};
    }
    case 'status': case 'pr-opened': case 'pr-merged': case 'cancelled': case 'restored': {
      const to = ev.event === 'cancelled' ? 'cancelled' : ev.event === 'pr-merged' ? 'merged' : ev.event === 'pr-opened' && !b.mergedAt ? 'in-pr' : statusForBuild(b);
      const { features, edits } = recordsOf(db, b);
      for (const f of features) moveFeature(db, f, to, why, { at: ev.at, mergedAt: b.mergedAt, pr, restore: ev.event === 'restored' });
      for (const e of edits) moveEdit(db, e, to, { mergedAt: b.mergedAt, pr });
      return { moved: features.length + edits.length };
    }
    default: return {};
  }
}

/** Apply a batch of events in order, once each. Returns how many were new. */
export function applyEvents(db, events, opts = {}) {
  let applied = 0;
  for (const ev of events) {
    if (!ev?.id || D.seen(db, ev.id)) continue;
    D.tx(db, () => { applyEvent(db, ev, opts); D.markSeen(db, ev.id, ev.at); });
    applied += 1;
  }
  if (applied) D.setMeta(db, 'updated_at', new Date().toISOString());
  return applied;
}
