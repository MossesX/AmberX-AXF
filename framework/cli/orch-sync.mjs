#!/usr/bin/env node
/**
 * orch-sync — the IO side of framework/plan/orch-sync.mjs: keeps the active build profile's orchestrator tracker
 * (_claude/builds[/profiles/<id>]/orchestrator.json) and its Pending builds list (framework/plan/pending.json via
 * persist.mjs dataPath) in step. Brett, Oct 27 2026 20:46: everything goes through the orchestrator and every list
 * stays in sync.
 *
 * Wired into both writers, so nothing has to remember to call it:
 *   - the orchestrator's save() (CLI, console server, other sessions) → pushToPending()
 *   - pending.mjs actPending() (console API, engine-rpc, MCP pending_change, plugins) → pullIntoOrchestrator()
 * Neither path calls the other writer, so there is no loop.
 *
 *   node framework/cli/orch-sync.mjs           two-way sync now (Pending → orchestrator, then orchestrator → Pending)
 *   node framework/cli/orch-sync.mjs --dry     show what would change
 *
 * Profiles: see syncEnabled() (Refactor and every newer profile sync; main-framework only with orchSync: true).
 * AXF_ORCH_FILE / AXF_PENDING_FILE point at other files (tests). With AXF_ORCH_FILE set and no AXF_PENDING_FILE the
 * orchestrator's push is skipped, so a test tracker never touches the real Pending list. AXF_ORCH_SYNC=0 turns it off.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as sync from '../plan/orch-sync.mjs';
import * as pc from '../plan/pending-core.mjs';
import { BASE_PROFILE, activeProfile, dataPath, orchestratorPath } from './persist.mjs';

/**
 * Which profiles sync: every profile except the base "main-framework" unless its registry entry says
 * `orchSync: true` (its 100+ older pending items were never orchestrator builds; builds-one-page merges those).
 * Test files (AXF_ORCH_FILE + AXF_PENDING_FILE) always sync. AXF_ORCH_SYNC=0 turns it off, =1 forces it on.
 */
export function syncEnabled() {
  if (process.env.AXF_ORCH_SYNC === '0') return false;
  if (process.env.AXF_ORCH_SYNC === '1' || (process.env.AXF_ORCH_FILE && process.env.AXF_PENDING_FILE)) return true;
  const p = activeProfile();
  return p?.id !== BASE_PROFILE || p?.orchSync === true;
}
const off = () => !syncEnabled();
export const orchFile = () => process.env.AXF_ORCH_FILE || orchestratorPath();
export const pendingFile = () => process.env.AXF_PENDING_FILE || dataPath('framework/plan/pending.json');

function writeAtomic(f, text) {
  mkdirSync(dirname(f), { recursive: true });
  const tmp = `${f}.tmp-${process.pid}`; writeFileSync(tmp, text); renameSync(tmp, f);
}
function readOrch(f = orchFile()) {
  const o = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {};
  return { $axf: 'orchestrator@1', updatedAt: o.updatedAt || '', rules: o.rules ?? {}, builds: (Array.isArray(o.builds) ? o.builds : []).map((b) => ({ ...b, steps: Array.isArray(b.steps) ? b.steps : [], notes: Array.isArray(b.notes) ? b.notes : [] })) };
}
const readPending = (f = pendingFile()) => pc.normalizeState(existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : pc.emptyPending());
const savePendingFile = (s, f = pendingFile()) => writeAtomic(f, `${JSON.stringify(s, null, 1)}\n`);
const saveOrchFile = (s, f = orchFile()) => writeAtomic(f, `${JSON.stringify(s, null, 1)}\n`);

/** After an orchestrator save: publish it to the Pending list. Returns the log. */
export function pushToPending(orchState) {
  if (off() || (process.env.AXF_ORCH_FILE && !process.env.AXF_PENDING_FILE)) return [];
  const pending = readPending();
  const r = sync.orchestratorToPending(orchState, pending);
  if (r.log.length) savePendingFile(r.pending);
  return r.log;
}

/**
 * After a Pending change (already applied, not yet saved): pull it into the orchestrator, save the tracker, and return
 * the Pending state re-published from it (so new items get their [Model] steps). The caller saves that state.
 */
export function pullIntoOrchestrator(pendingState, change = null) {
  if (off()) return { pending: pendingState, log: [] };
  const f = orchFile();
  const r = sync.pendingToOrchestrator(pendingState, readOrch(f), change);
  if (r.log.length) saveOrchFile(r.orch, f);
  const back = sync.orchestratorToPending(r.orch, pendingState);
  return { pending: back.pending, log: [...r.log, ...back.log] };
}

/** Both ways, now. */
export function syncNow({ dry = false } = {}) {
  if (off()) return [];
  const pending = readPending();
  const a = sync.pendingToOrchestrator(pending, readOrch());
  const b = sync.orchestratorToPending(a.orch, pending);
  if (!dry) { if (a.log.length) saveOrchFile(a.orch); if (b.log.length) savePendingFile(b.pending); }
  return [...a.log, ...b.log];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const log = syncNow({ dry: process.argv.includes('--dry') });
  console.log(log.length ? log.join('\n') : 'orchestrator and Pending builds already in sync');
  console.log(`  orchestrator: ${orchFile()}\n  pending:      ${pendingFile()}`);
}
