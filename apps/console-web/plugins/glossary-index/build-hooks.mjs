/**
 * build-hook@1 listener (plugin.json `buildHooks`): the orchestrator updates the glossary, index and catalog on every
 * build (Brett, addendum 3: "whenever ANY build is created / lands, the orchestrator updates this glossary + index +
 * catalog … no manual step"). Every build event that can change what the repo registers (a build created, a step done,
 * a status change, a PR opened or merged, an addendum) rebuilds the catalog from the registries with the build's id,
 * so the change log says which build added, changed or removed what. Idempotent: a rebuild with nothing new writes
 * nothing. No model, no tokens.
 */
import { writeCatalog } from './catalog.mjs';

const REBUILD_ON = new Set(['created', 'steps-added', 'step-done', 'status', 'pr-opened', 'pr-merged', 'addendum', 'restored']);

export default async function onBuildEvents(events) {
  const builds = new Map();
  for (const e of Array.isArray(events) ? events : []) {
    const kind = String(e?.event ?? '');
    if (!REBUILD_ON.has(kind)) continue;
    const id = String(e?.build?.id ?? '').trim();
    if (id) builds.set(id, kind);
  }
  if (!builds.size) return { rebuilt: false };
  // one rebuild per delivery, attributed to the builds in it (the newest kind wins the reason)
  const ids = [...builds.keys()];
  const r = writeCatalog({ reason: `build ${[...new Set(builds.values())].join('+')}`, build: ids.join(',') });
  return { rebuilt: r.wrote, builds: ids, total: r.catalog.total, diff: { added: r.diff.added.length, changed: r.diff.changed.length, removed: r.diff.removed.length } };
}
