/**
 * build-hook@1 listener (plugin.json "buildHooks"): the builds store's change event. When a build that was sent from a
 * plan changes (the orchestrator filed its steps, a step finished, the build was cancelled) the sent builds are read
 * from the store again and the tree is brought in line right away (tree.mjs sync): the planning steps of a split build
 * move to the plan's history, a cancelled build gives them back, and a build that shipped (the `shipped` event, its
 * shipped-manifest@1 ref on the record) hands its manifest to the plan it was sent from (shipped.mjs: validated, stored
 * on the plan or refused and flagged). Builds that were not sent from a plan cost nothing
 * here. Idempotent; a read does the same sync, so a missed event only waits for the next read.
 */
/**
 * The events that concern Plan Studio: any change of a build that was sent from a plan (`known`, the ids as last read).
 * Before anything was read (`known` null) every build event counts once: the read that follows fills the list. (pure)
 */
export function wants(events, known = null) {
  return (Array.isArray(events) ? events : []).some((e) => !!e?.build?.id && (!known || known.has(e.build.id)));
}

export async function onBuildEvents(events) {
  const { sentBuildIds, sync } = await import('./tree.mjs');
  if (!wants(events, sentBuildIds())) return { synced: false };
  const r = sync({ by: 'build-hook', fresh: true }); // reads the builds store now and keeps what it read for the page
  for (const e of r.shipped ?? []) if (e.refused) console.error(`plan-studio-2: the shipped manifest for ${e.build} was refused (plan ${e.item} flagged): ${e.reason}`);
  return { synced: r.changed, replaced: r.replaced, restored: r.restored, shipped: r.shipped ?? [] };
}
export default onBuildEvents;
