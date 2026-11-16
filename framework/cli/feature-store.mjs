#!/usr/bin/env node
/**
 * The one feature store, one record per build from the moment it is asked for until it shipped (Brett, Nov 16 2026 07:14:
 * Shipped features and the Gate & rules plugin's Pending features tab read the same list). A read-only view over the three
 * places a build's life is written, so nothing is copied and nothing can drift:
 *
 *   builds store (builds@1)       the build, Brett's words (origin), its steps, branch, PR, status
 *   shipped manifests (sidecars)  shipped-manifest@1: what landed, when, files, tests, report
 *   merge-watch@1 state           the landing on main and whether its send went out (sent / pending / failed)
 *
 * build-feature record:
 *   { id, title, state, status, unlinked, branch, pr, said, steps: { done, total, open }, updatedAt,
 *     landed: { sha, at, kind } | null, manifest: { id, rev, shippedAt, landedCommit } | null,
 *     send: { state, attempts, error, nextRetryAt } | null }
 *   state = pending (pending / queued / waiting / blocked) | building (running) | in-pr (built, a PR open) | built |
 *           landed (on main, no manifest yet) | shipped (a manifest) | failed (a failed build or a failed send) | archived
 *   unlinked = a merge to main that no build owns (`main-<sha9>`, from its manifest)
 *
 *   node framework/cli/feature-store.mjs list [--state <s>[,<s>]] [--build <text>] [--pr <n>] [--since <date>] [--limit N] [--json]
 *   node framework/cli/feature-store.mjs get <build id | PR number | merge sha> [--json]
 *
 * REST (Shipped features plugin): GET builds (same filters), GET builds/{key};
 * MCP features_list / features_get; CLI `axf shipped-features features-list` or this file.
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as MW from '../core/merge-watch.mjs';
import { loadStore } from './builds-store.mjs';
import { readState } from './merge-watch-files.mjs';
import { listManifests } from './shipped-files.mjs';

export const STATES = ['pending', 'building', 'in-pr', 'built', 'landed', 'shipped', 'failed', 'archived'];
const str = (v, n = 400) => (typeof v === 'string' ? v.slice(0, n) : v == null ? '' : String(v).slice(0, n));
const prNo = (v) => Number(String(v ?? '').replace(/\D/g, '')) || 0;

function stateOf(b, m, send) {
  if (b?.status === 'archived' && !m) return 'archived';
  if (send?.state === 'failed') return 'failed';
  if (m) return 'shipped';
  if (b?.status === 'failed') return 'failed';
  if (b?.mergedAt || b?.status === 'complete' || send) return 'landed';
  if (b?.status === 'running') return 'building';
  if (b?.status === 'built') return prNo(b.pr) ? 'in-pr' : 'built';
  return 'pending';
}

/** Every build-feature record, newest change first. Inputs injectable for tests. */
export function records({ store = loadStore(), manifests = listManifests(), watch = readState() } = {}) {
  const byBuild = new Map(manifests.map((m) => [m.build?.id, m]));
  const sends = new Map(); // build id → its newest landing in merge-watch
  for (const e of Object.values(watch?.entries ?? {})) {
    if (e.state === 'skipped') continue;
    const id = e.manifest?.id?.replace(/^sm-/, '') || MW.buildIdOf(e);
    const cur = sends.get(id); if (!cur || cur.at < e.at) sends.set(id, e);
  }
  const out = [];
  const seen = new Set();
  for (const b of store.builds ?? []) {
    if (!b || b.deleted) continue;
    seen.add(b.id);
    out.push(recordOf(b, byBuild.get(b.id), sends.get(b.id)));
  }
  for (const m of manifests) if (m.build?.id && !seen.has(m.build.id)) out.push(recordOf(null, m, sends.get(m.build.id)));
  return out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
}

function recordOf(b, m, e) {
  const steps = (b?.steps ?? []).filter((s) => s && !s.skip);
  const said = str(b?.origin?.said, 4000) || str(m?.said?.text, 4000);
  const landed = e ? { sha: e.sha, at: e.at, kind: e.kind } : m?.landedCommit ? { sha: m.landedCommit, at: m.landedAt || m.mergedAt || '', kind: '' } : null;
  return {
    id: b?.id || m.build.id, title: str(b?.title || m?.build?.title, 300), state: stateOf(b, m, e), status: b?.status || '',
    unlinked: !b && /^main-[0-9a-f]{9}$/.test(m?.build?.id || ''),
    branch: b?.branch || m?.branch || '', pr: prNo(b?.pr) || m?.pr?.number || e?.pr || 0, said,
    steps: { done: steps.filter((s) => s.done).length, total: steps.length, open: steps.filter((s) => !s.done).map((s) => s.id).slice(0, 40) },
    updatedAt: [b?.updatedAt, m?.shippedAt, e?.sentAt, e?.at].filter(Boolean).sort().pop() || '',
    landed, manifest: m ? { id: m.id, rev: m.rev, shippedAt: m.shippedAt, landedCommit: m.landedCommit } : null,
    send: e ? { state: e.state, sha: e.sha, attempts: e.attempts, error: e.error, nextRetryAt: e.nextRetryAt } : null,
  };
}

/** Filters: state (one or a comma list), build (text in id / title), pr, since (updatedAt / landed at). */
export function list({ state = '', build = '', pr = 0, since = '', limit = 500, ...src } = {}) {
  const states = String(state || '').split(',').map((s) => s.trim()).filter(Boolean);
  for (const s of states) if (!STATES.includes(s)) throw Object.assign(new Error(`state is one of ${STATES.join(', ')}`), { code: 2 });
  const q = String(build || '').toLowerCase(); const n = prNo(pr);
  const rs = records(src).filter((r) => (!states.length || states.includes(r.state)) && (!q || r.id.includes(q) || r.title.toLowerCase().includes(q)) && (!n || r.pr === n) && (!since || r.updatedAt >= since || (r.landed?.at || '') >= since));
  return { ok: true, count: rs.length, records: rs.slice(0, Math.max(1, Math.min(Number(limit) || 500, 5000))) };
}

/** One record by build id, PR number (#N or N) or merge sha (7+ hex). */
export function get(key, src = {}) {
  const k = String(key || '').trim(); const rs = records(src);
  const r = rs.find((x) => x.id === k) || (/^#?\d+$/.test(k) && rs.find((x) => x.pr === prNo(k))) || (/^[0-9a-f]{7,40}$/i.test(k) && rs.find((x) => x.landed?.sha?.startsWith(k.toLowerCase()) || x.manifest?.landedCommit?.startsWith(k.toLowerCase())));
  if (!r) throw Object.assign(new Error(`no build, PR or merge "${k}"`), { code: 2 });
  return { ok: true, record: r };
}

async function main(argv) {
  const json = argv.includes('--json'); const args = argv.filter((a) => a !== '--json');
  const flag = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 && typeof args[i + 1] === 'string' ? args[i + 1] : ''; };
  const [cmd = 'list', key] = args;
  if (cmd === 'list') {
    const r = list({ state: flag('state'), build: flag('build'), pr: flag('pr'), since: flag('since'), limit: flag('limit') });
    return console.log(json ? JSON.stringify(r) : r.records.map((x) => `${x.state.padEnd(9)} ${x.id.slice(0, 60).padEnd(60)} ${x.pr ? `#${x.pr}` : ''}`).join('\n') || 'nothing');
  }
  if (cmd === 'get') { const r = get(key); return console.log(json ? JSON.stringify(r) : JSON.stringify(r.record, null, 1)); }
  throw Object.assign(new Error('usage: feature-store.mjs list [--state s] [--build text] [--pr n] [--since date] | get <id|pr|sha>'), { code: 2 });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => { if (process.argv.includes('--json')) console.log(JSON.stringify({ ok: false, error: e.message })); else console.error(e.message); process.exitCode = e.code === 2 ? 2 : 1; });
}
