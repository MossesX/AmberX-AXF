/**
 * merge-watch@1 host: send one landing's shipped-manifest@1 to Shipped features, exactly once per merge sha.
 *
 * Before sending, a landing is skipped (and recorded sent) when:
 *   - merge-watch state already has it `sent`
 *   - the build's sidecar (_claude/builds/shipped/<id>.json) already covers it (shipped.mjs sentFor: its sha, one of its
 *     commits, its PR, or a later landing of the same build)
 *   - the ledger already has a manifest whose landedCommit is the sha (read-only, python3 sqlite3: the host's Node may
 *     predate node:sqlite)
 *
 * Transports, in order (AXF_MERGE_WATCH_SEND=local,api to change; the first that works wins):
 *   local       a build: shipped.mjs ship(id, { manifest: overlay }) (sidecar + builds store ref → build-hook@1 `shipped` →
 *               ledger); an unlinked landing: the sidecar only (the ledger's sync takes any sidecar), so the builds store
 *               never gets `main-<sha9>` records
 *   api         POST <AXF_CONSOLE_URL>/api/plugins/shipped-features/manifest with AXF_TOKEN (the ledger API; the same
 *               ship() behind it), for a host with no checkout or store
 *   capability  axf.shipped@1: an open slot; used when a host registers a sender (registerTransport), none is registered yet
 *
 * The result is recorded in merge-watch state (MW.markSent / MW.markFailed: attempts, nextRetryAt backoff, error).
 */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import * as MW from '../../core/merge-watch.mjs';
import { readManifest, writeManifest } from '../shipped-files.mjs';
import { ship, sentFor } from '../shipped.mjs';
import { buildManifest } from './build-manifest.mjs';
import { mapCommit } from './map-commit.mjs';
import { gitRoot } from './walk.mjs';

// ------------------------------------------------------------------ transports (open registry)

const TRANSPORTS = new Map();
export function registerTransport(name, fn) { TRANSPORTS.set(name, fn); return () => TRANSPORTS.delete(name); }
export const transportNames = () => [...TRANSPORTS.keys()];

registerTransport('local', async ({ built, env, now }) => {
  if (built.unlinked) { const file = writeManifest(built.manifest, env); return { id: built.manifest.id, rev: built.manifest.rev, file }; }
  const r = ship(built.id, { manifest: built.overlay, source: 'orchestrator', by: 'merge-watch', env, now });
  return { id: r.manifest.id, rev: r.manifest.rev, file: r.file };
});

registerTransport('api', async ({ built, env, fetchFn = globalThis.fetch }) => {
  const base = env.AXF_CONSOLE_URL; const token = env.AXF_TOKEN;
  if (!base || !token) throw new Error('api: AXF_CONSOLE_URL and AXF_TOKEN are not set');
  const res = await fetchFn(`${base.replace(/\/$/, '')}/api/plugins/shipped-features/manifest`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ manifest: built.unlinked ? built.manifest : { ...built.overlay, build: { id: built.id } }, by: 'merge-watch' }), signal: AbortSignal.timeout(60e3) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`api: ${res.status} ${String(body.detail || body.error || '').slice(0, 200)}`);
  return { id: body.manifest?.id || built.manifest.id, rev: body.manifest?.rev || built.manifest.rev };
});

const order = (env) => String(env.AXF_MERGE_WATCH_SEND || 'local,api').split(',').map((s) => s.trim()).filter((s) => TRANSPORTS.has(s));

// ------------------------------------------------------------------ already sent?

const ledgerFile = (env) => join(env.AXF_SHIPPED_FEATURES_DIR || join(gitRoot(env), '.axf-console', 'plugins', 'shipped-features'), 'ledger.sqlite');
const PY = `import sqlite3,sys
try:
  db=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True)
  r=db.execute("select build,rev from manifests where landed_commit=? limit 1",(sys.argv[2],)).fetchone()
  print((r[0]+' '+str(r[1])) if r else '')
except Exception: print('')`;
/** { id, rev } of the ledger's manifest for the sha, or null (no ledger, no python, no row). */
export function ledgerHas(sha, env = process.env) {
  if (env.AXF_MERGE_WATCH_LEDGER === 'off') return null;
  const r = spawnSync('python3', ['-I', '-c', PY, ledgerFile(env), sha], { encoding: 'utf8', timeout: 20e3 });
  const [id, rev] = String(r.stdout || '').trim().split(' ');
  return id ? { id, rev: Number(rev) || 1 } : null;
}

// ------------------------------------------------------------------ one landing

/** Put the entry into the state when it is not there yet (a `send <sha>` of a landing no tick saw). */
export function ensureEntry(state, entry, now) {
  const e = MW.normEntry(entry, { now }); if (!e) return state;
  if (state.entries[e.sha]) return state;
  return MW.normState({ ...state, entries: { ...state.entries, [e.sha]: { ...e, state: 'pending' } } }, { now });
}

/**
 * Send one landing. Returns { state, result: { sha, status: sent | skipped | failed | dry, id, rev, via, why, error } }.
 * ctx = { store, origins, env, now, dry, github, git, cwd, root }.
 */
export async function sendOne(state, entry, ctx = {}) {
  const { env = process.env, now = new Date().toISOString(), dry = false } = ctx;
  let st = ensureEntry(state, entry, now);
  const e = st.entries[MW.sha(entry.sha)];
  if (!e) return { state: st, result: { sha: entry.sha, status: 'failed', error: 'not a landing (no sha)' } };
  if (e.state === 'sent') return { state: st, result: { sha: e.sha, status: 'skipped', why: 'already sent', id: e.manifest?.id, rev: e.manifest?.rev } };
  try {
    const mapped = await mapCommit(e, ctx);
    const built = await buildManifest(mapped, { ...ctx, prev: readManifest(mapped.build.id || `main-${e.sha.slice(0, 9)}`, env), now });
    const side = readManifest(built.id, env);
    if (side && sentFor(side, mapped.entry)) {
      if (!dry) st = MW.markSent(st, e.sha, side, now);
      return { state: st, result: { sha: e.sha, status: 'skipped', why: 'in the sidecar', id: side.id, rev: side.rev } };
    }
    const led = ledgerHas(e.sha, env);
    if (led) {
      if (!dry) st = MW.markSent(st, e.sha, { id: `sm-${led.id}`, rev: led.rev }, now);
      return { state: st, result: { sha: e.sha, status: 'skipped', why: 'in the ledger', id: `sm-${led.id}`, rev: led.rev } };
    }
    if (!built.valid.ok) throw new Error(`shipped-manifest@1 rejected: ${MW.rejection(built.valid.errors)}`);
    if (dry) return { state: st, result: { sha: e.sha, status: 'dry', id: built.manifest.id, rev: built.manifest.rev, build: built.id, unlinked: built.unlinked, pr: mapped.entry.pr, kind: e.kind, at: e.at, subject: e.subject } };
    const errs = [];
    for (const name of order(env)) {
      try {
        const r = await TRANSPORTS.get(name)({ built, env, now, fetchFn: ctx.fetchFn });
        st = MW.markSent(st, e.sha, { id: r.id, rev: r.rev }, now);
        return { state: st, result: { sha: e.sha, status: 'sent', id: r.id, rev: r.rev, via: name, build: built.id, unlinked: built.unlinked, pr: mapped.entry.pr } };
      } catch (err) { errs.push(`${name}: ${err.message}`); }
    }
    throw new Error(errs.join('; ') || 'no transport (AXF_MERGE_WATCH_SEND)');
  } catch (err) {
    if (!dry) st = MW.markFailed(st, e.sha, err.message, now);
    return { state: st, result: { sha: e.sha, status: 'failed', error: String(err.message).slice(0, 500) } };
  }
}

/** Send everything due (MW.due: pending and failed past their nextRetryAt, oldest first), at most `max`. */
export async function sendDue(state, ctx = {}) {
  const { now = new Date().toISOString(), max = 20 } = ctx;
  let st = state; const results = [];
  for (const e of MW.due(st, now).slice(0, max)) { const r = await sendOne(st, e, ctx); st = r.state; results.push(r.result); }
  return { state: st, results };
}
