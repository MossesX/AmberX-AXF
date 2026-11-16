#!/usr/bin/env node
/**
 * fell-back@1 — the IO side (pure part: pipeline-core.mjs foldFellBack / fellBackView).
 *
 * Brett, Nov 16 2026: "Every time something falls back to Pending, I need a fucking alert somewhere."
 * A build-hook@1 listener (plugin.json → buildHooks): every builds store write fires `status` events, and each move from
 * the Queue or Building back to Pending is kept here, one record per build, until the build leaves Pending again or is
 * put on hold. The systems check (server/__init__.py → fell_back_sync) turns each record into a red banner item with
 * Requeue and Open, pushed once to the AmberX app.
 *
 *   node apps/console-web/plugins/build-orchestrator/fell-back.mjs list [--json] [--no-deliver]   the builds that fell back, with why
 *                                     (takes this listener's waiting build-hook events first unless --no-deliver)
 *   node apps/console-web/plugins/build-orchestrator/fell-back.mjs clear <id> [--json]  drop one record (it stays in Pending)
 *
 * Requeue is the pipeline's own move: `pipeline.mjs queue <id>` (REST POST /pipeline/queue, MCP pipeline-queue).
 * Env: AXF_FELL_BACK_FILE (the ledger; default <repo>/.axf-console/plugins/build-orchestrator/fell-back.json).
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { emptyFellBack, fellBackView, foldFellBack } from './pipeline-core.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../../..');
/** The build-hook@1 listener name: the plugin folder. */
const LISTENER = 'build-orchestrator';
export const ledgerFile = () => process.env.AXF_FELL_BACK_FILE || join(REPO_ROOT, '.axf-console', 'plugins', 'build-orchestrator', 'fell-back.json');

/** The ledger; the first read starts it now (events from before then are history, see foldFellBack). */
export function readLedger() {
  try { return foldFellBack(JSON.parse(readFileSync(ledgerFile(), 'utf8')), []); } catch { /* none yet */ }
  const l = emptyFellBack(new Date().toISOString()); writeLedger(l); return l;
}
function writeLedger(l) {
  const f = ledgerFile(); mkdirSync(dirname(f), { recursive: true });
  const tmp = `${f}.tmp-${process.pid}`; writeFileSync(tmp, `${JSON.stringify(l, null, 1)}\n`); renameSync(tmp, f);
}

/** build-hook@1 listener: fold the events in (idempotent, so replays are harmless). */
export function onBuildEvents(events) {
  const before = readLedger();
  const after = foldFellBack(before, events);
  if (JSON.stringify(after) !== JSON.stringify(before)) writeLedger(after);
  return after;
}
export default onBuildEvents;

/** The records against the store as it is now; records that no longer apply are dropped from the ledger. */
export async function listFellBack({ store = null, prune = true, deliver = false } = {}) {
  if (deliver) await deliverOwn();
  const l = readLedger();
  const ids = Object.keys(l.builds);
  if (!ids.length) return [];
  const s = store ?? (await import('../../../../framework/cli/builds-store.mjs')).loadStore();
  const byId = new Map((s?.builds ?? []).map((b) => [b.id, b]));
  const out = []; let dropped = false;
  for (const id of ids) {
    const v = fellBackView(l.builds[id], byId.get(id));
    if (v) out.push(v); else { delete l.builds[id]; dropped = true; }
  }
  if (prune && dropped) writeLedger(l);
  return out.sort((a, b) => (a.since < b.since ? 1 : -1));
}

/**
 * Take this listener's waiting events now. Builds changed in a worktree reach the console's outbox through builds-live
 * without a delivery; the console's sync calls this every minute so the banner never waits for the next local write.
 */
export async function deliverOwn() {
  try { const { deliver } = await import('../../../../framework/cli/build-hooks.mjs'); return await deliver({ only: LISTENER }); } catch { return null; }
}

export function clearFellBack(id) {
  const l = readLedger(); const had = !!l.builds[id];
  if (had) { delete l.builds[id]; writeLedger(l); }
  return had;
}

async function main(argv) {
  const json = argv.includes('--json'); const args = argv.filter((a) => !a.startsWith('--'));
  const [cmd = 'list', id] = args;
  const out = (o, text) => console.log(json ? JSON.stringify(o) : text);
  if (cmd === 'list') {
    const items = await listFellBack({ deliver: !process.argv.includes('--no-deliver') });
    return out({ ok: true, items }, items.map((x) => `${x.id} · from ${x.from} · ${x.since} · ${x.stepsLeft}/${x.stepsTotal} steps left · ${x.why}`).join('\n') || 'no build fell back to Pending');
  }
  if (cmd === 'clear') {
    if (!id) throw Object.assign(new Error('usage: fell-back.mjs clear <id>'), { code: 2 });
    const had = clearFellBack(id);
    return out({ ok: true, id, cleared: had }, had ? `${id}: cleared` : `${id}: nothing to clear`);
  }
  throw Object.assign(new Error(`unknown command ${cmd}`), { code: 2 });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => {
    const json = process.argv.includes('--json');
    if (json) console.log(JSON.stringify({ ok: false, error: e.message })); else console.error(e.message);
    process.exit(e.code === 2 ? 2 : 1);
  });
}
/** Has any build fallen back since the listener started? (no ledger file = never) */
export const hasLedger = () => existsSync(ledgerFile());
