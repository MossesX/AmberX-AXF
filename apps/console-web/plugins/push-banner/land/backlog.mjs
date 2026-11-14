#!/usr/bin/env node
/**
 * The landing backlog (build land-finish-auto-land-live-clear-backlog, Brett Nov 14 2026: "I keep getting too many
 * commits behind"): every finished build that is not on main yet, with how far behind main it is, its priority and its
 * age, in the order the lander should take them. Plain Node, no model calls.
 *
 * Order: the builds Brett named first, in his order (PINNED); then by priority (P0 first: the most wanted); then the
 * newest finished first (the least drift to settle, and what he is waiting on now).
 *
 * Every build the builds store says is `built` and not merged, and that is not archived or already landed by the lander
 * (build-pipeline@1 needsLanding plus flagged ones, which still need a person).
 *
 *   node apps/console-web/plugins/push-banner/land/backlog.mjs [--count] [--json] [--limit n]
 *     --count   count commits behind main from git now (else the land record's last count)
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as pipe from '../../../../../framework/core/build-pipeline.mjs';
import { makeGit, settings } from './land.mjs';
import { buildPriority } from './merge-queue-core.mjs';

export const FRAME = 'land-backlog@1';
/** Brett's named builds (Nov 14 2026), pinned to the top in this order: the AmberX web app into the console, console
 *  app parts 1-4, the wake listener, the voice listener on Claude. */
export const PINNED = Object.freeze([
  'move-amberx-web-app-console-amberx-andr',
  'change-to-move-amberx-web-app-console',
  /^console-app-part-1(-|$)/,
  /^console-app-part-2(-|$)/,
  /^console-app-part-3(-|$)/,
  /^console-app-part-4(-|$)/,
  'console-app-wake-word-voice-listener',
  'voice-listener-use-claude-when-connected',
]);
const PRIO = ['P0', 'P1', 'P2', 'P3'];

/** The pin rank of a build id (-1 = not pinned). */
export function pinRank(id) {
  return PINNED.findIndex((p) => (typeof p === 'string' ? p === id : p.test(String(id || ''))));
}

/** Still to land: built, not merged, not archived / landed (red and flagged stay: they still need landing). */
export const inBacklog = (b) => !!b && !b.deleted && !b.hidden && b.status === 'built' && !b.mergedAt && !['landed', 'archived'].includes(pipe.landStateOf(b)) && !!b.branch;

/**
 * The backlog rows, ordered. `behind(b)` may give a live count (git); else the land record's. `now` for the age.
 * Row: { id, title, branch, pr, priority, pinned, finishedAt, ageH, behindMain, landState }.
 */
export function backlog(builds, { now = Date.now(), behind = null } = {}) {
  const rows = (builds || []).filter(inBacklog).map((b) => {
    const finishedAt = pipe.finishedAtOf(b);
    const l = pipe.normLand(b.land);
    const live = behind ? behind(b) : null;
    return {
      id: b.id, title: String(b.title || '').slice(0, 200), branch: b.branch, pr: b.pr || '', priority: buildPriority(b),
      pinned: pinRank(b.id), finishedAt, ageH: finishedAt ? Math.max(0, Math.round((now - Date.parse(finishedAt)) / 36e5 * 10) / 10) : null,
      behindMain: Number.isInteger(live) ? live : l?.behindMain ?? null, landState: pipe.landStateOf(b) || 'waiting',
    };
  });
  const pin = (r) => (r.pinned < 0 ? Infinity : r.pinned);
  return rows.sort((a, b) => pin(a) - pin(b) || PRIO.indexOf(a.priority) - PRIO.indexOf(b.priority) || String(b.finishedAt).localeCompare(String(a.finishedAt)) || a.id.localeCompare(b.id));
}

export function storeBuilds(s, git) {
  const t = git(['show', `${s.remote}/${s.base}:_claude/builds/store.json`]);
  try { return t.code ? [] : JSON.parse(t.out).builds || []; } catch { return []; }
}

/** Commits on main a branch lacks, from git (null when the branch isn't on the remote). */
export const gitBehind = (s, git) => (b) => { const r = git(['rev-list', '--count', `${s.remote}/${b.branch}..${s.remote}/${s.base}`]); return r.code ? null : Number(r.out) || 0; };

export async function main(argv) {
  const s = settings(); const git = makeGit(s.repo); const json = argv.includes('--json');
  const i = argv.indexOf('--limit'); const limit = i >= 0 ? Number(argv[i + 1]) || 0 : 0;
  if (argv.includes('--count')) git(['fetch', '-q', '--prune', s.remote], { timeout: 180000 });
  else git(['fetch', '-q', s.remote, s.base], { timeout: 120000 });
  const rows = backlog(storeBuilds(s, git), { behind: argv.includes('--count') ? gitBehind(s, git) : null });
  const shown = limit ? rows.slice(0, limit) : rows;
  if (json) { console.log(JSON.stringify({ $axf: FRAME, at: new Date().toISOString(), total: rows.length, rows: shown }, null, 1)); return 0; }
  console.log(`${rows.length} finished build(s) not on main${limit && rows.length > limit ? ` (first ${limit})` : ''}`);
  for (const r of shown) console.log(`${r.pinned >= 0 ? '★' : ' '} ${r.priority} ${String(r.behindMain ?? '?').padStart(4)} behind  ${String(r.ageH ?? '?').padStart(6)}h  ${r.landState.padEnd(8)} ${r.id}${r.pr ? ` (${r.pr})` : ''}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { console.error(e.message); process.exit(1); });
}
