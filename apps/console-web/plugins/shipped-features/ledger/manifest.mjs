/**
 * Shipped features: shipped-manifest@1 → the ledger. When the orchestrator sends a build's manifest (build-hook@1
 * `shipped` event, or the sync finding a sidecar the ledger hasn't taken), the build's features and edits move to
 * Merged with the landed commit, PR, files, model and report; Brett's words are recorded (a verbatim prompt is never
 * replaced by a paraphrase); a build that planned no feature gets one, named after the build. The manifest itself is
 * kept (manifests table) and shown on every feature of the build.
 */
import * as L from '../../../../../framework/core/feature-ledger.mjs';
import { toLedger } from '../../../../../framework/core/shipped-manifest.mjs';
import { listManifests as sidecarManifests, readManifest } from '../../../../../framework/cli/shipped-files.mjs';
import * as D from './db.mjs';

/** Apply one manifest. Returns { manifest, features, edits, created } (ids). */
export function applyManifest(db, manifest, { why = '' } = {}) {
  const t = toLedger(manifest); if (!t) return null;
  const m = D.putManifest(db, t.manifest);
  if (m && m.rev > t.manifest.rev) return { manifest: m.id, stale: true, features: [], edits: [], created: [] };
  const reason = why || `shipped ${t.manifest.id} rev ${t.manifest.rev}`;
  D.putBuild(db, t.build);
  if (t.pr) D.putPr(db, t.pr);
  for (const p of t.prompts) D.putPrompt(db, p);
  const key = L.buildKey(t.build.profile, t.build.id);
  const mine = D.featuresOfBuild(db, key).filter((f) => f.builds.some((b) => b.id === L.slug(t.build.id)));
  const out = { manifest: t.manifest.id, features: [], edits: [], created: [] };
  const edits = D.editsOfBuild(db, t.build.id);
  if (!mine.length && !edits.length) {
    const f = D.putFeature(db, t.feature, { why: reason });
    if (f) { D.linkStep(db, f.id, key, 'manifest'); out.created.push(f.id); }
  }
  const promptRef = t.prompts.length ? { id: L.promptId(t.build.id, 0), passage: '' } : null;
  for (const f of mine) {
    const next = { ...f, ...t.featureFields, status: t.featureFields.mergedAt ? 'merged' : f.status, prs: [...f.prs, ...(t.featureFields.prs ?? [])], prompts: promptRef && !f.prompts.some((p) => p.id === promptRef.id) ? [...f.prompts, promptRef] : f.prompts, links: { ...f.links, ...t.featureFields.links } };
    const stored = D.putFeature(db, next, { why: reason });
    if (stored) out.features.push(stored.id);
  }
  for (const e of edits) { const stored = D.putEdit(db, { ...e, ...t.edit, id: e.id, feature: e.feature, summary: e.summary, kind: e.kind }); if (stored) out.edits.push(stored.id); }
  D.setMeta(db, 'updated_at', new Date().toISOString());
  return out;
}

/** build-hook@1 `shipped` event: read the build's sidecar and apply it (missing = the sync takes it when it arrives). */
export function applyShippedEvent(db, ev) {
  const m = readManifest(ev.build.id);
  if (!m) return { missing: true };
  return applyManifest(db, m, { why: `${ev.event} (${ev.build.id})` });
}

/** The sync's pass: every sidecar manifest the ledger has not taken (or has an older rev of). */
export function syncManifests(db) {
  const have = D.manifestRevs(db); const applied = [];
  for (const m of sidecarManifests()) if ((have[m.id] ?? 0) < m.rev) { D.tx(db, () => applyManifest(db, m)); applied.push(m.id); }
  return { applied };
}
