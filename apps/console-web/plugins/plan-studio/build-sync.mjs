/**
 * build-hook@1 listener (plugin.json `buildHooks`): build-mirror@1. Every builds store write (a build created, split,
 * re-split, a step ticked, a status or phase change, a PR opened or merged, an addendum, a failure) reaches Plan Studio
 * here: the build's stepped plan is made or brought up to date from the store, so Plan Studio and the Build manager
 * are two views of one record. Idempotent: a mirror with nothing new writes nothing. No model, no tokens.
 */
import { mirrorBuilds } from './plans.mjs';

export default async function onBuildEvents(events) {
  const ids = [...new Set((Array.isArray(events) ? events : []).map((e) => String(e?.build?.id ?? '').trim()).filter(Boolean))];
  if (!ids.length) return { mirrored: 0 };
  const r = mirrorBuilds(ids, { by: 'orchestrator' });
  return { mirrored: ids.length, created: r.created, updated: r.updated };
}
