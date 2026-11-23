/**
 * build-hook@1 listener (plugin.json "buildHooks"): the builds store's change event. When a build changes status (the
 * orchestrator filed its steps, a build was cancelled) the tree is brought in line with the store right away
 * (tree.mjs sync): the planning steps of a split build move to the item's history, a cancelled build gives them back.
 * Statuses themselves are never copied: every read takes them from the store. Idempotent; a read does the same sync,
 * so a missed event only waits for the next read.
 */
/** Does this batch of events change which steps a sent plan shows? (pure) */
export function wants(events) {
  return (Array.isArray(events) ? events : []).some((e) => e?.event === 'status' || e?.event === 'created');
}

export async function onBuildEvents(events) {
  if (!wants(events)) return { synced: false };
  const { sync } = await import('./tree.mjs');
  const r = sync({ by: 'build-hook' });
  return { synced: r.changed, replaced: r.replaced, restored: r.restored };
}
export default onBuildEvents;
