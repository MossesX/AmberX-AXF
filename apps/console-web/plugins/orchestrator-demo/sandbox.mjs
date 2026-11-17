/**
 * Orchestrator demo — the demo-build fixtures (demo-build@1 sandbox, framework/core/demo-build.mjs).
 *
 * A demo run plays with throwaway builds whose id starts with `demo-` (the store derives the demo tag from the id).
 * This module creates and removes them, and keeps a ledger of what it made in the plugin's data folder through the
 * data-store@1 layer (`pluginData('orchestrator-demo')` → key `plugins/orchestrator-demo/fixtures.json`), so cleanup
 * removes exactly the builds a run created and never anything else:
 *
 *   - every write goes through the builds store with `demo: true`, so the store's guard refuses a write that touches a
 *     build without the tag (DemoGuardError, not-demo-build) and the whole write is dropped;
 *   - removal deletes only ids that pass `isDemoId` AND are in the ledger (or, with `sweep`, any `demo-*` build left
 *     behind by a run that died before it could clean up).
 *
 * The builds store and the data folder are injected (`store`, `data`) so tests run on memory; the defaults are the real
 * builds store (framework/cli/builds-store.mjs) and the plugin data folder.
 */
import { isDemoId, assertDemo, DEMO_PREFIX } from '../../../../framework/core/demo-build.mjs';

export const FOLDER = 'orchestrator-demo';
export const LEDGER = 'fixtures.json';
export const BY = 'orchestrator-demo';

/**
 * The fixtures: one tiny build per part of the tour, 3–4 steps each. `key` names the fixture; the build id is
 * `demo-<key>-<run suffix>` so two runs never collide and every id carries the prefix.
 */
export const FIXTURES = Object.freeze([
  {
    key: 'grid', title: 'Demo: steps crossed off in the grid', category: 'demo',
    detail: 'Throwaway build for the guided live demo: queued, launched on the fake runner, its steps ticked one at a time.',
    steps: [
      { id: 's1', title: 'Write a hello file', estimate: '1 min' },
      { id: 's2', title: 'Add a test for it', estimate: '1 min' },
      { id: 's3', title: 'Run the test', estimate: '1 min' },
      { id: 's4', title: 'Write the report', estimate: '1 min' },
    ],
  },
  {
    key: 'crash', title: 'Demo: a session that crashes', category: 'demo',
    detail: 'Throwaway build for the guided live demo: its fake session is killed on purpose so the watchdog catches it and retries.',
    steps: [
      { id: 's1', title: 'Start work', estimate: '1 min' },
      { id: 's2', title: 'Crash here (the fake session is killed)', estimate: '1 min' },
      { id: 's3', title: 'Finish after the retry', estimate: '1 min' },
    ],
  },
  {
    key: 'ci', title: 'Demo: red CI, auto-fix and landing', category: 'demo',
    detail: 'Throwaway build for the guided live demo: its demo branch gets a simulated red CI, an auto-fix, merge-main and a dry-run landing.',
    steps: [
      { id: 's1', title: 'Change a file', estimate: '1 min' },
      { id: 's2', title: 'Fix the red check', estimate: '1 min' },
      { id: 's3', title: 'Merge main and land', estimate: '1 min' },
    ],
  },
  {
    key: 'die', title: 'Demo: a build that dies for good', category: 'demo',
    detail: 'Throwaway build for the guided live demo: it fails every retry, turns red, raises its break alert and is cleaned up.',
    steps: [
      { id: 's1', title: 'Start work', estimate: '1 min' },
      { id: 's2', title: 'Fail every try', estimate: '1 min' },
      { id: 's3', title: 'Never reached', estimate: '1 min' },
    ],
  },
]);

export const fixture = (key) => FIXTURES.find((f) => f.key === key) ?? null;

/** The demo build id for a fixture in a run: demo-<key>-<suffix> (suffix = the run's short tag, [a-z0-9]). */
export function demoBuildId(key, suffix) {
  const s = String(suffix || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12) || 'x';
  const id = `${DEMO_PREFIX}${key}-${s}`;
  if (!isDemoId(id)) throw new Error(`not a demo build id: ${id}`);
  return id;
}

/** The builds@1 record a fixture becomes (status pending; normBuild fills the rest and adds demo: true). */
export function fixtureBuild(key, suffix, { now = new Date().toISOString(), runId = '' } = {}) {
  const f = fixture(key);
  if (!f) throw new Error(`no demo fixture "${key}"`);
  return {
    id: demoBuildId(key, suffix), title: f.title, category: f.category, detail: f.detail, status: 'pending', source: 'orchestrator-demo',
    branch: '', createdAt: now, updatedAt: now,
    notes: [{ text: `Created by the guided live demo${runId ? ` (run ${runId})` : ''}; removed when the run ends.`, at: now }],
    steps: f.steps.map((s) => ({ ...s, text: s.title, model: 'Opus', createdAt: now, updatedAt: now })),
  };
}

// ── IO adapters ───────────────────────────────────────────────────────────────────────────────────────────────────

/** The real builds store, written as a demo action (the store's demo guard applies). */
export async function realStore() {
  const bs = await import('../../../../framework/cli/builds-store.mjs');
  return {
    read: () => bs.loadStore(),
    write: (fn, action) => bs.withStore((s) => fn(s), { by: BY, action, demo: true }),
  };
}

/** The plugin's data folder through data-store@1. */
export async function realData() {
  const { pluginData } = await import('../../../../framework/core/data-files.mjs');
  const d = pluginData(FOLDER);
  return { read: (rel, fb) => d.readJsonSync(rel, fb), write: (rel, doc) => d.writeJsonSync(rel, doc) };
}

/** An in-memory builds store + data folder for tests: same shape as the real adapters. */
export function memoryAdapters(builds = []) {
  let store = { $axf: 'builds@1', builds: JSON.parse(JSON.stringify(builds)) };
  const files = new Map();
  return {
    store: {
      read: () => JSON.parse(JSON.stringify(store)),
      write: (fn) => {
        const before = JSON.parse(JSON.stringify(store));
        const next = fn(JSON.parse(JSON.stringify(store)));
        const after = next?.$axf ? next : next.store;
        // the same rule the real store enforces for a demo write
        const old = new Map(before.builds.map((b) => [b.id, JSON.stringify(b)]));
        for (const b of after.builds) if (old.get(b.id) !== JSON.stringify(b)) assertDemo(b, 'demo action');
        for (const b of before.builds) if (!after.builds.some((x) => x.id === b.id)) assertDemo(b, 'demo action');
        store = after;
        return { store };
      },
    },
    data: { read: (rel, fb) => (files.has(rel) ? JSON.parse(files.get(rel)) : fb), write: (rel, doc) => files.set(rel, JSON.stringify(doc)) },
    files,
  };
}

const emptyLedger = () => ({ $axf: 'demo-fixtures@1', builds: [] });

export function readLedger(data) {
  const l = data.read(LEDGER, emptyLedger());
  return l && Array.isArray(l.builds) ? l : emptyLedger();
}

/**
 * Create the fixture builds for a run (all, or only `keys`). Idempotent: an id already in the store is kept as it is.
 * Returns the ids. Every id is recorded in the ledger before the store write, so a crash in between still cleans up.
 */
export async function createFixtures({ store, data, suffix, runId = '', keys = FIXTURES.map((f) => f.key), now = new Date().toISOString() }) {
  const recs = keys.map((k) => fixtureBuild(k, suffix, { now, runId }));
  const ids = recs.map((r) => r.id);
  const ledger = readLedger(data);
  for (const id of ids) if (!ledger.builds.some((b) => b.id === id)) ledger.builds.push({ id, runId, at: now });
  data.write(LEDGER, ledger);
  await store.write((s) => {
    for (const r of recs) if (!s.builds.some((b) => b.id === r.id)) s.builds.push(r);
    return s;
  }, 'demo-create');
  return ids;
}

/**
 * Remove demo builds: every ledger entry (optionally only one run's), plus with `sweep` any `demo-*` build still in the
 * store; `only` limits it to those ids. Ids without the demo prefix are never removed, whatever the ledger says. Returns { removed, kept }.
 */
export async function removeFixtures({ store, data, runId = '', sweep = false, only = null }) {
  const ledger = readLedger(data);
  const mine = ledger.builds.filter((b) => (!runId || b.runId === runId) && (!only || only.includes(b.id))).map((b) => b.id).filter(isDemoId);
  const want = new Set(mine);
  if (sweep) for (const b of store.read().builds ?? []) if (isDemoId(b.id)) want.add(b.id);
  let removed = [];
  if (want.size) {
    await store.write((s) => {
      removed = s.builds.filter((b) => want.has(b.id) && isDemoId(b.id)).map((b) => b.id);
      s.builds = s.builds.filter((b) => !(want.has(b.id) && isDemoId(b.id)));
      return s;
    }, 'demo-remove');
  }
  const kept = ledger.builds.filter((b) => !want.has(b.id));
  data.write(LEDGER, { ...ledger, builds: kept });
  return { removed, kept: kept.map((b) => b.id) };
}

/** Change one demo build through a demo write (the store refuses it on anything else). */
export async function updateDemoBuild(store, id, fn, action = 'demo-update') {
  if (!isDemoId(id)) throw Object.assign(new Error(`demo action refused: ${id} is not a demo build`), { code: 'not-demo-build' });
  let out = null;
  await store.write((s) => {
    const b = s.builds.find((x) => x.id === id);
    if (!b) throw new Error(`no demo build ${id}`);
    assertDemo(b, action);
    fn(b);
    b.updatedAt = new Date().toISOString();
    out = b;
    return s;
  }, action);
  return out;
}

export const findBuild = (store, id) => (store.read().builds ?? []).find((b) => b.id === id) ?? null;
