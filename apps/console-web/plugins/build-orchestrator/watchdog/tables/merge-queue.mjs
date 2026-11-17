/**
 * Watchdog table: the merge queue (stale-row@1 kind merge-queue), from the plugin that provides
 * service:axf.merge-queue@1 (its merge-queue.mjs state: `land.mjs queue list`). Every entry in the line (`items`) and
 * every open PR waiting to join it (`waiting`) is one row { kind: 'merge-queue', id: <pr>, build, pr, branch, status }.
 * A PR that is both in the line and waiting is one row.
 *
 * read() → { table, rows, wantPrs, provider } ; `available: false` when no plugin provides the merge queue here.
 */
import { pathToFileURL } from 'node:url';
import { entryOf, providerOf } from '../providers.mjs';

export const TABLE = Object.freeze({ id: 'merge-queue', label: 'Merge queue', kinds: ['merge-queue'], capability: 'axf.merge-queue@1' });
export const ENTRY = ['land/merge-queue.mjs', 'merge-queue.mjs'];

/** One queue entry (merge-queue@1 item or waiting line) → a classifier row, or null. */
export function rowOf(x, where = 'items') {
  const pr = Number(String(x?.pr ?? '').replace(/^#/, '')) || 0;
  if (!pr) return null;
  return { kind: 'merge-queue', id: String(pr), build: String(x.build ?? ''), pr, branch: String(x.branch ?? ''), status: String(x.state ?? (where === 'items' ? 'queued' : 'waiting')), title: String(x.title ?? ''), where, head: String(x.head ?? '') };
}

/**
 * Rows from a merge-queue@1 state (pure). A PR already taken out by queue control at this head (`removed`, until the
 * next round drops it) is no row: a second run is a no-op.
 */
export function rowsFrom(state, control = null) {
  const removed = control?.removed && typeof control.removed === 'object' ? control.removed : {};
  const seen = new Set(); const rows = [];
  for (const where of ['items', 'waiting']) {
    for (const x of Array.isArray(state?.[where]) ? state[where] : []) {
      const r = rowOf(x, where); if (!r || seen.has(r.id)) continue;
      const gone = removed[r.id]; if (gone && (!gone.head || !r.head || gone.head === r.head)) continue;
      seen.add(r.id); rows.push(r);
    }
  }
  return rows;
}

/** The provider's queue module (readQueue, queueControl, settings), or null. */
export async function queueModule() {
  const p = providerOf(TABLE.capability);
  const f = entryOf(p, ENTRY);
  if (!f) return null;
  if (p.dataDir && !process.env.AXF_PUSH_BANNER_DIR) process.env.AXF_PUSH_BANNER_DIR = p.dataDir;
  return { provider: p, mod: await import(pathToFileURL(f).href) };
}

/** Read the queue state. `state` overrides the read (tests). */
export async function read({ state, control = null } = {}) {
  let st = state; let provider = ''; let ctl = control;
  if (!st) {
    const q = await queueModule();
    if (!q) return { table: TABLE.id, rows: [], wantPrs: [], available: false, why: 'no plugin provides service:axf.merge-queue@1' };
    provider = q.provider.id;
    const s = q.mod.settings ? q.mod.settings() : (await import(pathToFileURL(entryOf(q.provider, ['land/land.mjs'])).href)).settings();
    st = q.mod.readQueue(s);
    ctl = q.mod.readQueueControl ? q.mod.readQueueControl(s) : null;
  }
  const rows = rowsFrom(st, ctl);
  return { table: TABLE.id, rows, wantPrs: rows.map((r) => r.pr), available: true, provider };
}

/**
 * Apply verdicts: take each entry out of the queue through the provider's queue control (`land.mjs queue remove <pr>`,
 * effective at the next round; `queue add` puts it back). A `complete` whose PR is still open is skipped (the queue is
 * how it lands). Returns each verdict with { applied, why }.
 */
export async function apply(verdicts, { by = 'watchdog', control } = {}) {
  let ctl = control;
  if (!ctl) {
    const q = await queueModule();
    if (!q?.mod?.queueControl) return verdicts.map((v) => ({ ...v, applied: false, why: 'no merge-queue provider with queue control' }));
    const s = q.mod.settings ? q.mod.settings() : (await import(pathToFileURL(entryOf(q.provider, ['land/land.mjs'])).href)).settings();
    ctl = (pr, why) => q.mod.queueControl(s, 'remove', pr, { why });
  }
  const out = [];
  for (const v of verdicts) {
    if (v.action === 'complete' && v.prState === 'open') { out.push({ ...v, applied: false, why: 'its PR is still open' }); continue; }
    try { ctl(v.row.pr, `watchdog (${by}): ${v.line}`.slice(0, 300)); out.push({ ...v, applied: true, why: '' }); }
    catch (e) { out.push({ ...v, applied: false, why: String(e.message).slice(0, 200) }); }
  }
  return out;
}
