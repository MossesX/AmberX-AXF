/**
 * Plan Studio 2.0 receives the shipped-manifest@1 of a build it sent (framework/core/shipped-manifest.mjs, the same
 * manifest the orchestrator writes for Shipped features at _claude/builds/shipped/<build>.json when a build lands).
 *
 * Only a plan that was sent from Plan Studio receives one: the build's `planRef` names the item. Builds that no plan
 * sent are never synced into the tree (Plan Studio 2.0 starts empty and stays that way).
 *
 * The manifest is validated as given with the shared validator (no copy of the format here):
 *   valid    → stored on the item as `shipped` (normalised, every field), `shippedProblem` cleared, the item gets a
 *              `shipped` link to the build (and a `url` link to the PR), and a plan whose build landed with every
 *              step done is marked done. The same manifest id + rev again changes nothing; an older rev is ignored.
 *   invalid  → refused: nothing of it is stored as the plan's manifest (a valid one already there stays), the item is
 *              flagged with `shippedProblem` (the field errors, when, from where). A later valid manifest clears it.
 *
 * Pure over the tree state (the caller loads and saves): receive() → { state, changed, … }.
 */
import * as SM from '../../../../framework/core/shipped-manifest.mjs';
import * as tc from './web/tree-core.mjs';

export const PROBLEM = 'plan-shipped-problem@1';
const nowIso = () => new Date().toISOString();
const clone = (v) => JSON.parse(JSON.stringify(v));

/** Has the manifest landed every one of its steps? (a manifest with no steps counts as complete once it landed) */
export const complete = (m) => !!m && (!!m.landedCommit || m.pr?.number > 0 || !!m.mergedAt) && (m.steps ?? []).every((x) => x.done);

/** The plan item a build was sent from (its builds store record's `planRef`), when that item is in the tree. */
export function itemForBuild(state, builds, buildId) {
  const b = (builds ?? []).find((x) => x.id === buildId);
  return b?.planRef ? tc.byId(state, b.planRef) : null;
}

/**
 * One manifest → the item `itemId`. `raw` is the manifest as received (validated before normalising).
 * → { state, changed, ok, refused?, unchanged?, stale?, reason?, errors?, item, manifest? (summaryOf) }
 */
export function receive(state, itemId, raw, { now = nowIso(), source = '', by = 'orchestrator' } = {}) {
  const s = clone(state);
  const it = tc.byId(s, itemId);
  if (!it) throw new tc.TreeError('not_found', `no item "${itemId}"`);
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const v = SM.validateManifest(r);
  if (!v.ok) {
    const reason = SM.rejection(v.errors);
    const problem = { $axf: PROBLEM, at: now, build: String(r.build?.id ?? ''), id: String(r.id ?? ''), rev: Number(r.rev) || 0, source: String(source || r.source || ''), by, reason, errors: v.errors };
    const same = it.shippedProblem && it.shippedProblem.reason === reason && it.shippedProblem.id === problem.id && it.shippedProblem.rev === problem.rev;
    if (same) return { state, changed: false, ok: false, refused: true, unchanged: true, reason, errors: v.errors, item: tc.byId(state, itemId) };
    it.shippedProblem = problem; it.updatedAt = now;
    return { state: { ...s, rev: (s.rev || 0) + 1 }, changed: true, ok: false, refused: true, reason, errors: v.errors, item: it };
  }
  const m = SM.normManifest(r, { now });
  const have = it.shipped;
  if (have && have.id === m.id && Number(have.rev) === m.rev && !it.shippedProblem) return { state, changed: false, ok: true, unchanged: true, item: tc.byId(state, itemId), manifest: SM.summaryOf(m) };
  if (have && have.id === m.id && Number(have.rev) > m.rev) return { state, changed: false, ok: true, unchanged: true, stale: true, item: tc.byId(state, itemId), manifest: SM.summaryOf(have) };
  it.shipped = m;
  delete it.shippedProblem;
  const links = [{ type: 'shipped', ref: m.build.id, label: `Shipped: ${m.build.title || m.build.id}` }];
  if (m.pr.url) links.push({ type: 'url', ref: m.pr.url, label: `PR #${m.pr.number}` });
  for (const l of links) { const n = tc.normLink(l); if (n && !it.links.some((x) => x.type === n.type && x.ref === n.ref)) it.links.push(n); }
  if (complete(m) && it.status !== 'done') it.status = 'done';
  it.updatedAt = now; it.by = by || it.by;
  return { state: { ...s, rev: (s.rev || 0) + 1 }, changed: true, ok: true, created: !have, item: it, manifest: SM.summaryOf(m) };
}

/**
 * What the page and the API show for an item: the manifest summary (null when none arrived), the flag, and whether it
 * is complete. Never the builds store: the manifest is what the orchestrator sent.
 */
export function shippedView(it) {
  if (!it) return null;
  return { item: it.id, title: it.title, status: it.status, shipped: it.shipped ?? null, problem: it.shippedProblem ?? null, summary: it.shipped ? SM.summaryOf(it.shipped) : null, complete: complete(it.shipped) };
}

/**
 * check-shipped: every sent build that has shipped (its record carries the shipped ref, or a sidecar exists) has its
 * manifest on its plan, at the shipped rev, still a valid shipped-manifest@1 for that build. `sidecar(buildId)` reads
 * the manifest file. Flagged plans are problems too: a refused manifest means the plan did not get what shipped.
 * → { ok, checked, problems: [{ build, item, problem }] }
 */
export function checkShipped(state, builds, sidecar) {
  const problems = []; let checked = 0;
  for (const b of builds ?? []) {
    if (!b.planRef || b.deleted) continue;
    const ref = SM.normRef(b.shipped);
    const m = ref || b.status === 'complete' || b.status === 'landed' ? sidecar(b.id) : null;
    if (!ref && !m) continue;
    checked += 1;
    const it = tc.byId(state, b.planRef);
    const p = (problem) => problems.push({ build: b.id, item: b.planRef, problem });
    if (!it) { p(`build ${b.id} shipped but its plan item ${b.planRef} is not in the tree`); continue; }
    if (it.shippedProblem) p(`the shipped manifest was refused ${it.shippedProblem.at}: ${it.shippedProblem.reason}`);
    if (!it.shipped) { if (!it.shippedProblem) p(m ? 'the plan has not received the shipped manifest yet (tree.mjs shipped ' + b.id + ')' : 'shipped, but no manifest file was found'); continue; }
    const v = SM.validateManifest(it.shipped);
    if (!v.ok) p(`the manifest on the plan is not a valid shipped-manifest@1: ${SM.rejection(v.errors)}`);
    if (it.shipped.build?.id !== b.id) p(`the plan carries the manifest of build ${it.shipped.build?.id}`);
    const want = ref?.rev ?? (m ? SM.normManifest(m)?.rev : 0) ?? 0;
    if (want && Number(it.shipped.rev) < want) p(`the plan has rev ${it.shipped.rev}, rev ${want} shipped`);
  }
  return { ok: !problems.length, checked, problems };
}
