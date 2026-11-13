/**
 * build-hook@1 listener (plugin.json `buildHooks`): every builds store change reaches the prompt engine as an event
 * (`build.<event>`: created, steps-added, step-done, status, pr-opened, pr-merged, addendum, cancelled, restored,
 * shipped) plus the derived ones rules ask for most (`build.failed`, `build.blocked`). Idempotent on event id: the
 * engine's dedupe and the audit line carry the build event's id, so a replay fires nothing twice within a rule's
 * dedupe window. No model, no tokens.
 */
import { fire } from './engine.mjs';

const str = (v) => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v));

/** A build-event@1 as the prompt engine's event(s): payload = the build's fields rules read, flat and stable. */
export function promptEventsOf(e) {
  if (!e || typeof e !== 'object') return [];
  const kind = str(e.event);
  const b = e.build && typeof e.build === 'object' ? e.build : {};
  const steps = Array.isArray(b.steps) ? b.steps : [];
  const build = {
    id: str(b.id), title: str(b.title), status: str(b.status), priority: str(b.priority), repo: str(b.repo), branch: str(b.branch), pr: b.pr ?? '', profile: str(b.profile || (Array.isArray(b.profiles) ? b.profiles[0] : '')),
    steps: { total: steps.length, done: steps.filter((s) => s && s.done).length },
  };
  const base = { source: 'builds', at: str(e.at), by: str(e.by), payload: { build, from: str(e.from), origin: e.origin && typeof e.origin === 'object' ? { said: str(e.origin.said) } : undefined, step: e.step && typeof e.step === 'object' ? { id: str(e.step.id), title: str(e.step.title), model: str(e.step.model) } : undefined, steps: e.steps && typeof e.steps === 'object' ? { added: Number(e.steps.added ?? (Array.isArray(e.steps) ? e.steps.length : 0)) || 0 } : undefined, addendum: str(e.addendum?.said ?? e.addendum), shipped: e.shipped && typeof e.shipped === 'object' ? { id: str(e.shipped.id) } : undefined } };
  for (const k of Object.keys(base.payload)) if (base.payload[k] === undefined) delete base.payload[k];
  const out = [];
  if (kind) out.push({ ...base, event: `build.${kind}`, id: `${str(e.id) || `${build.id}:${kind}:${base.at}`}` });
  if (kind === 'status' && build.status === 'failed') out.push({ ...base, event: 'build.failed', id: `${str(e.id) || `${build.id}:${kind}:${base.at}`}:failed`, payload: { ...base.payload, reason: str(e.reason || e.note) } });
  if (kind === 'status' && (build.status === 'blocked' || build.status === 'waiting')) out.push({ ...base, event: 'build.blocked', id: `${str(e.id) || `${build.id}:${kind}:${base.at}`}:blocked` });
  return out;
}

export default function onBuildEvents(events) {
  let fired = 0; let asked = 0; let seen = 0;
  for (const e of Array.isArray(events) ? events : []) {
    for (const pe of promptEventsOf(e)) {
      seen += 1;
      try { const r = fire(pe, { by: 'build-hook' }); fired += r.fired?.length || 0; asked += r.instances?.length || 0; } catch { /* one bad event never stops the delivery */ }
    }
  }
  return { seen, fired, asked };
}
