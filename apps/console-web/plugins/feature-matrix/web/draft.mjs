/**
 * Feature matrix plugin helpers (pure: no fs, no DOM). The contract and the Apply engine are the framework's
 * (framework/plan/feature-matrix-core.mjs, feature-matrix-apply.mjs); this file only adds what the plugin needs around
 * them, so the CLI, the server and the page share one set of rules:
 *
 *  - fromDraft(raw, builds)      the pre-contract draft (feature-matrix@0, `keep` flags, `build` ids) → feature-matrix@1
 *  - seedItems(ref, tables)      items for a build from the table it lives in (orchestrator steps, pending sub prompts,
 *                                build-queue small steps, plan acceptance lines, change-log steps)
 *  - targetsFor(ref, tables)     every table row a matrix projects onto when Apply runs
 *  - titleFor(ref, tables)       the build's title
 *
 * `tables` = { builds?: orchestrator builds[], pending?: pending items[], queue?: build-queue@1 state,
 *              features?: plan features[], change?: one change-log@1 entry }.
 */
import * as fm from './fm-core.mjs';

const str = (v, max = 4000) => (typeof v === 'string' ? v.slice(0, max) : '');

/** `[arch-foundation s1] …` → 'arch-foundation s1' (refactor-all steps carry their source build and step). */
export const stepTag = (text) => { const m = /^\[([^\]]{1,120})\]/.exec(str(text)); return m ? m[1].trim() : ''; };

/**
 * The draft (feature-matrix@0) → feature-matrix@1. Items keep their keep/skip, minutes, model, group and why; an item
 * marked done gets a `done` history line (the contract has no done field: done lives in the tables). Each item is
 * tied to the build's step that carries its `[source step]` tag, so Apply finds the step. A matrix whose last edit is
 * newer than its last apply comes in dirty (Apply lights up).
 */
export function fromDraft(raw, builds = [], now = new Date().toISOString()) {
  if (raw?.$axf === fm.SCHEMA) return fm.normalizeState(raw, now);
  const out = fm.emptyState(now);
  for (const d of Array.isArray(raw?.matrices) ? raw.matrices : []) {
    const id = str(d?.build ?? d?.ref?.id, 120).trim(); if (!id) continue;
    const kind = fm.REF_KINDS.includes(d?.ref?.kind) ? d.ref.kind : 'orchestrator';
    const build = kind === 'orchestrator' ? builds.find((b) => b?.id === id) : null;
    const byTag = new Map((build?.steps ?? []).map((s) => [stepTag(s.text), s]).filter(([t]) => t));
    const createdAt = fm.iso(d.createdAt) || now;
    const updatedAt = fm.iso(d.updatedAt) || createdAt;
    const appliedAt = fm.iso(d.appliedAt);
    const items = (Array.isArray(d.items) ? d.items : []).map((it) => {
      const tag = `${str(it?.source)} ${str(it?.sourceStep)}`.trim();
      const step = byTag.get(tag) ?? (it?.sourceStep && !it?.source ? build?.steps?.find((s) => s.id === it.sourceStep) : null);
      const addedAt = fm.iso(it?.addedAt) || createdAt;
      const history = [{ at: addedAt, action: 'added' }];
      if (it?.keep === false) history.push({ at: updatedAt, action: 'state', from: 'keep', to: 'skip' });
      if (it?.done === true) history.push({ at: fm.iso(it.doneAt) || updatedAt, action: 'done', to: str(it.doneNote, 300) || 'done' });
      return {
        id: it?.id, name: it?.name, why: it?.why, group: it?.group, minutes: it?.minutes, model: it?.model,
        state: it?.keep === false ? 'skip' : 'keep', addedAt, updatedAt: fm.iso(it?.doneAt) || updatedAt,
        source: step ? { kind: 'step', id: step.id } : { kind: 'manual', id: '' }, history,
      };
    });
    const dirty = !appliedAt || updatedAt > appliedAt;
    out.matrices.push({
      ref: { kind, id }, profile: d.profile, title: str(d.title) || build?.title || id, createdAt, updatedAt,
      version: 1, appliedVersion: dirty ? 0 : 1, appliedAt, items,
      history: [{ at: createdAt, action: 'created' }, { at: now, action: 'imported', from: str(raw?.$axf, 40) || 'draft', to: fm.SCHEMA }],
    });
  }
  return fm.normalizeState(out, now);
}

const findBuild = (ref, t) => (ref.kind === 'orchestrator' ? t.builds?.find((b) => b.id === ref.id) : ref.kind === 'pending' ? t.builds?.find((b) => b.pendingId === ref.id) : null) ?? null;
const findPending = (ref, t) => (ref.kind === 'pending' ? t.pending?.find((p) => p.id === ref.id) : ref.kind === 'orchestrator' ? (() => { const b = findBuild(ref, t); return b?.pendingId ? t.pending?.find((p) => p.id === b.pendingId) : null; })() : null) ?? null;

/** The build's title in the table it lives in ('' when the table doesn't have it). */
export function titleFor(ref, t) {
  if (ref.kind === 'orchestrator' || ref.kind === 'pending') return str(findBuild(ref, t)?.title || findPending(ref, t)?.title);
  if (ref.kind === 'queue' || ref.kind === 'plan') return str(t.features?.find((f) => f.id === ref.id)?.title);
  if (ref.kind === 'change') return str(t.change?.title || t.change?.asked, 300);
  return '';
}

/** Items for a new matrix from what the build already has (nothing invented). */
export function seedItems(ref, t, now = new Date().toISOString()) {
  if (ref.kind === 'orchestrator') return fm.itemsFromSteps(findBuild(ref, t)?.steps ?? [], now);
  if (ref.kind === 'pending') { const b = findBuild(ref, t); if (b?.steps?.length) return fm.itemsFromSteps(b.steps, now); const p = findPending(ref, t); return fm.itemsFromSubPrompts(p?.subPrompts ?? [], p?.model, now); }
  if (ref.kind === 'queue') { const f = t.features?.find((x) => x.id === ref.id); return fm.itemsFromSubPrompts(t.queue?.steps?.[ref.id]?.steps ?? [], f?.model, now); }
  if (ref.kind === 'plan') { const f = t.features?.find((x) => x.id === ref.id); return fm.itemsFromAcceptance(f?.acceptance ?? [], f?.model, now); }
  if (ref.kind === 'change') return fm.itemsFromSubPrompts((t.change?.steps ?? []).map((s) => ({ ...s, skip: s?.state === 'skipped' })), t.change?.model, now);
  return [];
}

/** What Apply projects onto: { build?, pending?, queue?, feature?, change? } (only the rows that exist). */
export function targetsFor(ref, t) {
  const out = {};
  const b = findBuild(ref, t); if (b) out.build = b;
  const p = findPending(ref, t); if (p) out.pending = p;
  if (ref.kind === 'queue' && t.queue?.steps && t.features?.some((f) => f.id === ref.id)) out.queue = t.queue.steps[ref.id] ?? {};
  if (ref.kind === 'plan') { const f = t.features?.find((x) => x.id === ref.id); if (f) out.feature = f; }
  if (ref.kind === 'change' && t.change) out.change = t.change;
  return out;
}

/** Open builds of an orchestrator tracker (not complete, not archived): the ones that get a matrix by default. */
export const openBuilds = (builds) => (Array.isArray(builds) ? builds : []).filter((b) => b?.id && !['complete', 'archived'].includes(b.status));
