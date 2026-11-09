/**
 * build-hook@1 listener (plugin.json "buildHooks"): when the orchestrator ships a build (the `shipped` event, fired by
 * the builds store write that carries the manifest ref), Plan Studio reads the same shipped-manifest@1 sidecar the
 * Shipped features ledger reads and receives it (plans.mjs receiveManifest): the build's plan is created or updated
 * with every field, or flagged when the manifest is not valid. Idempotent on manifest id + rev (events replay).
 */
export async function onBuildEvents(events) {
  const shipped = (Array.isArray(events) ? events : []).filter((e) => e?.event === 'shipped' && e.build?.id);
  if (!shipped.length) return { applied: [] };
  const { receiveManifest, sidecarOf } = await import('./plans.mjs');
  const applied = [];
  for (const ev of shipped) {
    const m = sidecarOf(ev.build.id);
    if (!m) { applied.push({ build: ev.build.id, missing: true }); continue; }
    try {
      const r = receiveManifest(m, { by: ev.by || 'orchestrator', source: m.source, why: ev.id });
      applied.push({ build: ev.build.id, plan: r.plan?.id ?? '', ok: r.ok, refused: !!r.refused, reason: r.reason ?? '', created: !!r.created, unchanged: !!r.unchanged });
      if (!r.ok) console.error(`plan-studio: shipped manifest for ${ev.build.id} refused (plan ${r.plan?.id} flagged): ${r.reason}`);
    } catch (e) { applied.push({ build: ev.build.id, ok: false, error: e.message }); console.error(`plan-studio: ${ev.build.id}: ${e.message}`); }
  }
  return { applied };
}
export default onBuildEvents;
