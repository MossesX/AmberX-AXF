/**
 * demo-build@1 — the test-build sandbox rule on builds@1. Pure, IO-free.
 *
 * A throwaway build the guided live demo (demo-run@1, framework/spec/LIVE-DEMO.md) plays with carries the tag
 * `demo: true` and an id that starts with `demo-`. The two always agree: the builds store derives the tag from the
 * id on every read (normBuild), so a record written by older code heals itself and no migration is needed; a record
 * whose tag and id disagree fails validateStore.
 *
 * Every surface marks a demo build as demo-only from the id alone (projections, the dispatcher's plan, the auto-lander,
 * alerts, builds-live commit lines, the console rows), and a demo action (a write made with `demo: true`, an act of a
 * demo run) is refused on any build without the tag (DemoGuardError, code not-demo-build): a tour can never touch a
 * real build. The other way round is open: a demo build is an ordinary build to everything else, so the demo shows
 * the real pipeline (queue, dispatch, crash, watchdog, lander, escalation) and not a special path.
 */

export const SCHEMA = 'demo-build@1';
/** The id prefix every demo build carries. */
export const DEMO_PREFIX = 'demo-';
/** Error code the guard raises. */
export const GUARD_CODE = 'not-demo-build';
/** How a demo-only build is marked in a line of text (commit lines, alert titles). */
export const DEMO_MARK = '[demo]';

const DEMO_ID = /^demo-[a-z0-9][a-z0-9-]{0,74}$/;

/** Is this id a demo build id (prefix demo-, a valid build name, at most 80 characters)? */
export const isDemoId = (id) => typeof id === 'string' && id.length <= 80 && DEMO_ID.test(id);
/** Is this build record a demo build (the tag, or an id that says so)? */
export const isDemo = (b) => !!b && (b.demo === true || isDemoId(b.id));
/** The tag a record with this id carries: true for a demo id, else undefined (the field is absent). */
export const demoTag = (id) => (isDemoId(id) ? true : undefined);

export class DemoGuardError extends Error {
  constructor(message, detail = {}) { super(message); this.name = 'DemoGuardError'; this.code = GUARD_CODE; Object.assign(this, detail); }
}

/** The guard's answer for one build and a demo action: { ok, why }. */
export function demoGuard(b, what = 'demo action') {
  if (!b) return { ok: false, why: `${what}: no such build` };
  if (isDemo(b)) return { ok: true, why: '' };
  return { ok: false, why: `${what} refused: ${b.id} is not a demo build (no demo tag, id without the ${DEMO_PREFIX} prefix)` };
}

/** Throw unless the build is a demo build. */
export function assertDemo(b, what = 'demo action') {
  const g = demoGuard(b, what);
  if (!g.ok) throw new DemoGuardError(g.why, { build: b?.id ?? '', what });
  return b;
}

/**
 * Builds a demo write touched that are not demo builds: [{ id, why }]. `before` / `after` are builds@1 stores (or
 * their build lists); a build counts as touched when it was added, removed or changed between them.
 */
export function demoViolations(before, after) {
  const list = (s) => (Array.isArray(s) ? s : s?.builds ?? []);
  const old = new Map(list(before).map((b) => [b.id, JSON.stringify(b)]));
  const out = [];
  for (const b of list(after)) {
    const was = old.get(b.id);
    if (was !== undefined && was === JSON.stringify(b)) continue;
    const g = demoGuard(b);
    if (!g.ok) out.push({ id: b.id, why: g.why });
  }
  const now = new Set(list(after).map((b) => b.id));
  for (const [id] of old) if (!now.has(id) && !isDemoId(id)) out.push({ id, why: `demo action refused: ${id} is not a demo build and would be removed` });
  return out;
}

/** A text line marked demo-only when the id says so (the mark goes first so it is seen on a phone). */
export const markLine = (id, line) => (isDemoId(id) ? `${DEMO_MARK} ${line}` : line);

/** Registry snapshot. */
export const REGISTRY = Object.freeze({ $axf: 'demo-build-registry@1', schema: SCHEMA, prefix: DEMO_PREFIX, guardCode: GUARD_CODE, mark: DEMO_MARK });
