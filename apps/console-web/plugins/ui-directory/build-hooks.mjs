/**
 * build-hook@1 listener (plugin.json `buildHooks`): the orchestrator rebuilds the UI directory on every build event
 * that can add or remove a UI (a build created, a step done, a status change, a PR opened or merged, an addendum, a
 * restore), so a new screen, dialog, settings tab or plugin appears by itself and a removed one drops out, with the
 * build's id in the change log. Idempotent: a rebuild with nothing new writes nothing. No model, no tokens.
 */
import { writeDirectory } from './directory.mjs';

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
  const ids = [...builds.keys()];
  const r = writeDirectory({ reason: `build ${[...new Set(builds.values())].join('+')}`, build: ids.join(',') });
  return { rebuilt: r.wrote, builds: ids, total: r.directory.total, diff: { added: r.diff.added.length, changed: r.diff.changed.length, removed: r.diff.removed.length } };
}
