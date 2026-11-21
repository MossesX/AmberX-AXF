#!/usr/bin/env node
/**
 * data-mode — move a namespace of console data onto axf-data, staged and reversible (data-store-mode@1).
 *
 * Brett, Nov 15 2026: "the console goes down, all the data is still available, all the notes are available, and the
 * builds keep running. That's what I need."
 *
 *   node framework/cli/data-mode.mjs [status] [<ns>…]          mode, drift, next step per namespace (+ axf-data reachable)
 *   node framework/cli/data-mode.mjs shadow <ns>… | --all      local → shadow: needs axf-data up and M0 = M1 (data-migrate first)
 *   node framework/cli/data-mode.mjs cutover <ns>…             shadow → cutover: manifests equal now, zero drift (or
 *                                                              --accept-drift after reading it) and no drift for the window
 *                                                              (--window <minutes>, default 30) since the later of the
 *                                                              shadow start and the last drift
 *   node framework/cli/data-mode.mjs rollback <ns>…            cutover → rollback, replay axf-data's change feed since the
 *                                                              cut onto the local files, check the manifests, then → local
 *   node framework/cli/data-mode.mjs local <ns>…               shadow → local (stop mirroring; the target stays, unread)
 *   node framework/cli/data-mode.mjs drift <ns> [--tail n]     the drift log (data-drift@1) of a namespace
 *   --json · --by <who> · --url / --token (default AXF_DATA_URL / AXF_DATA_TOKEN)
 *
 * The mode document lives at <data>/data-store/mode.json (what every client reads before a write) and is written to
 * axf-data as `_meta/mode` on every change, with one line per change in the `_meta/mode-log` journal. The drift log
 * clients append locally (<data>/data-store/drift/<ns>.jsonl) is uploaded to axf-data's `_meta/drift/<ns>` journal by
 * status and every transition, so the diff log is on axf-data too. Guards: framework/core/data-store-mode.mjs.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DataStoreError, NAMESPACES, canonical, createDataStore, httpBackend, sameManifest } from '../core/data-store.mjs';
import * as MODE from '../core/data-store-mode.mjs';
import { keyFor, pathForKey, remoteStore, roots } from '../core/data-files.mjs';
import { manifestRemote, plan, scan } from './data-migrate.mjs';

export const storeDir = (env = process.env) => resolve(env.AXF_DATA_STORE_DIR || join(roots(env).data, 'data-store'));
const modeFile = (env) => join(storeDir(env), 'mode.json');
const driftFile = (ns, env) => join(storeDir(env), 'drift', `${ns.replace('/', '__')}.jsonl`);
const nowIso = () => new Date().toISOString();

export function readState(env = process.env) {
  try { return MODE.normState(JSON.parse(readFileSync(modeFile(env), 'utf8')), nowIso()); } catch { return MODE.initialState(nowIso()); }
}
export function writeState(state, env = process.env) {
  const f = modeFile(env); mkdirSync(dirname(f), { recursive: true });
  const tmp = `${f}.${process.pid}.tmp`; writeFileSync(tmp, `${JSON.stringify(state, null, 1)}\n`); renameSync(tmp, f);
}
/** The drift entries logged for `ns` since `since` (ISO), oldest first. */
export function driftSince(ns, since = '', env = process.env) {
  let text = ''; try { text = readFileSync(driftFile(ns, env), 'utf8'); } catch { return []; }
  return text.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((e) => e && (!since || e.at >= since));
}
/** Upload drift lines not yet on axf-data (`_meta/drift/<ns>`), tracked by a line count next to the log. */
async function uploadDrift(store, ns, env) {
  const all = driftSince(ns, '', env);
  const mark = `${driftFile(ns, env)}.uploaded`;
  const done = existsSync(mark) ? Number(readFileSync(mark, 'utf8')) || 0 : 0;
  const rest = all.slice(done);
  if (!rest.length) return 0;
  for (let i = 0; i < rest.length; i += 500) await store.append(`_meta/drift/${ns.replace('/', '__')}`, rest.slice(i, i + 500), { idempotencyKey: `drift-${done + i}` });
  writeFileSync(mark, String(all.length));
  return rest.length;
}
/** The mode document and its change log on axf-data (`_meta/mode`, `_meta/mode-log`): the record of every move. */
export async function publish(store, state, changes, by) {
  const cur = await store.get('_meta/mode');
  await store.put('_meta/mode', state, cur ? { ifMatch: cur.etag } : { create: true });
  if (changes.length) await store.append('_meta/mode-log', changes.map((c) => ({ ...c, by })));
}
/** Every namespace id the local data and the mode document know (plugins/<folder> one by one). */
function knownNamespaces(state, env) {
  const s = new Set(Object.keys(NAMESPACES).filter((n) => !NAMESPACES[n].internal && !NAMESPACES[n].open));
  for (const n of Object.keys(state.namespaces)) s.add(n);
  for (const m of scan(env).mapped) s.add(m.ns);
  return [...s].sort();
}
/** Both manifests of one namespace: M0 over the local files, M1 over axf-data. */
async function manifests(store, ns, env) {
  const p = plan(scan(env), [ns]).find((x) => x.ns === ns);
  const local = p ? p.m0 : { count: 0, bytes: 0, hash: '' };
  const remote = await manifestRemote(store, ns);
  return { local, remote, errors: p?.errors || [] };
}

// ── rollback replay: axf-data's changes since the cut → the local files ──────────────────────────────────────────────
async function replay(store, ns, cursor, env) {
  const [head, folder] = ns.split('/');
  const existing = new Map(scan(env).mapped.filter((m) => m.ns === ns).map((m) => [m.key, m.file]));
  const out = { written: 0, appended: 0, removed: 0, gaps: [] };
  let since = cursor; const touched = new Map();
  for (;;) {
    let r;
    try { r = await store.changes({ ns: [ns], since }); }
    catch (e) { if (e.code === 'cursor_expired') { out.gaps.push(`the change feed no longer reaches cursor ${cursor}: restore the cutover snapshot, then list every key changed since`); return out; } throw e; }
    for (const c of r.changes) touched.set(`${c.ns}/${c.path}`, c);
    if (!r.changes.length || r.changes.at(-1).cursor >= r.cursor) break;
    since = r.changes.at(-1).cursor;
  }
  for (const [key, c] of touched) {
    if (folder && !key.startsWith(`${head}/${folder}/`)) continue;
    const file = existing.get(key) || pathForKey(key, env);
    if (!file) { out.gaps.push(`${key}: no local path maps to it`); continue; }
    mkdirSync(dirname(file), { recursive: true });
    if (c.kind === 'journal') {
      const have = existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter((l) => l.trim()).length : 0;
      const r = await store.read(key, { since: have });
      const lines = []; let next = r;
      for (;;) { lines.push(...next.entries.map((e) => `${JSON.stringify(e.entry)}\n`)); if (!next.next) break; next = await store.read(key, { since: next.next }); }
      if (lines.length) { appendFileSync(file, lines.join('')); out.appended += lines.length; }
      continue;
    }
    const rec = await store.get(key);
    if (!rec) { rmSync(file, { force: true }); out.removed += 1; continue; }
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, rec.data instanceof Uint8Array ? rec.data : `${JSON.stringify(rec.data, null, 1)}\n`);
    renameSync(tmp, file); out.written += 1;
  }
  return out;
}

export async function run({ cmd = 'status', only = [], all = false, store = null, env = process.env, by = 'svc:cli', windowMin, acceptDrift = false, tail = 20 } = {}) {
  let state = readState(env);
  const at = nowIso();
  let remoteOk = false; let health = null;
  if (store) { try { health = await store.health(); remoteOk = !!health.ok; } catch { remoteOk = false; } }
  const nss = all ? knownNamespaces(state, env).filter((n) => !NAMESPACES[n.split('/')[0]].open || n.includes('/')) : only;
  const minDriftFreeMs = Number.isFinite(Number(windowMin)) && windowMin !== undefined ? Number(windowMin) * 60000 : MODE.DRIFT_FREE_MS;
  const withDrift = (ns) => { const e = state.namespaces[ns]; const since = e?.since || ''; let s = state; for (const d of driftSince(ns, since, env)) { if (!s.namespaces[ns] || !s.namespaces[ns].lastDriftAt || d.at > s.namespaces[ns].lastDriftAt) s = MODE.applyDrift(s, { ...d, key: d.key }); } return s; };

  if (cmd === 'status' || cmd === 'drift') {
    const list = nss.length ? nss : knownNamespaces(state, env);
    const rows = [];
    for (const ns of list) {
      const drift = driftSince(ns, state.namespaces[ns]?.since || '', env);
      if (store && remoteOk) { try { await uploadDrift(store, ns, env); } catch { /* best effort */ } }
      const mode = MODE.modeOf(state, ns);
      const next = MODE.nextStep(state, ns, { remoteOk, now: at, minDriftFreeMs });
      // status doesn't compute manifests (it would walk every data folder): say how they are checked instead
      if (/both manifests/.test(next.reason || '')) next.reason = mode === 'local' ? `copy and verify first: data-migrate apply ${ns}` : 'manifests are compared at the cut';
      if (mode === 'shadow' && next.next === 'wait' && /manifests are compared/.test(next.reason) && !drift.length) {
        const quiet = Date.parse(at) - Date.parse(state.namespaces[ns]?.since || at);
        if (quiet >= minDriftFreeMs) { next.next = 'cutover'; next.reason = 'quiet for the window; the manifests are compared at the cut'; }
        else next.reason = `quiet for ${Math.round(quiet / 60000)} min, needs ${Math.round(minDriftFreeMs / 60000)}`;
      }
      rows.push({ ns, mode, since: state.namespaces[ns]?.since || '', drift: drift.length, lastDriftAt: drift.at(-1)?.at || '', cursor: state.namespaces[ns]?.cursor || 0, next: next.next, nextReason: next.reason || '', ...(cmd === 'drift' ? { entries: drift.slice(-Math.max(1, tail)) } : {}) });
    }
    return { $axf: 'data-mode-status@1', at, remote: { configured: !!store, ok: remoteOk, cursor: health?.cursor ?? null }, mode: state.mode, namespaces: rows, summary: MODE.summary(state) };
  }

  if (!nss.length) throw new DataStoreError('invalid_body', `${cmd} needs the namespaces to move (or --all)`);
  if (!store) throw new DataStoreError('unavailable', 'axf-data is not configured (AXF_DATA_URL / --url)');
  const results = [];
  for (const ns of nss) {
    const res = { ns, from: MODE.modeOf(state, ns), to: '', ok: false, reason: '' };
    try {
      if (cmd === 'shadow' || cmd === 'cutover') {
        if (cmd === 'cutover') state = withDrift(ns);
        const m = remoteOk ? await manifests(store, ns, env) : { local: null, remote: null, errors: [] };
        const accept = acceptDrift ? driftSince(ns, state.namespaces[ns]?.since || '', env).map((d) => d.at) : [];
        const cursor = cmd === 'cutover' ? health.cursor : undefined;
        let manifestId = '';
        if (cmd === 'cutover') { try { manifestId = (await store.snapshot([ns], { mode: 'cutover' })).id; } catch (e) { if (e.code !== 'forbidden') throw e; } }
        const r = MODE.transition(state, { ns, to: cmd, at, by, cursor, manifest: manifestId || undefined, ctx: { manifests: { local: m.local, remote: m.remote }, remoteOk, now: at, acceptDrift: accept, minDriftFreeMs } });
        state = r.state; writeState(state, env); await publish(store, state, r.changes, by);
        Object.assign(res, { to: cmd, ok: true, cursor: state.namespaces[ns].cursor, manifest: manifestId });
      } else if (cmd === 'local') {
        const r = MODE.transition(state, { ns, to: 'local', at, by, ctx: {} });
        state = r.state; writeState(state, env); await publish(store, state, r.changes, by);
        Object.assign(res, { to: 'local', ok: true });
      } else if (cmd === 'rollback') {
        if (MODE.modeOf(state, ns) === 'cutover') {
          const r = MODE.transition(state, { ns, to: 'rollback', at, by, ctx: {} });
          state = r.state; writeState(state, env); await publish(store, state, r.changes, by);
        }
        const rep = await replay(store, ns, state.namespaces[ns]?.cursor || 0, env);
        res.replay = rep;
        const m = await manifests(store, ns, env);
        const same = sameManifest(m.local, m.remote);
        if (rep.gaps.length || !same.equal) {
          Object.assign(res, { to: 'rollback', ok: false, reason: rep.gaps.length ? rep.gaps.join('; ') : 'local and axf-data still differ after the replay', diffs: same.diffs });
        } else {
          const r = MODE.transition(state, { ns, to: 'local', at: nowIso(), by, ctx: { manifests: { local: m.local, remote: m.remote }, remoteOk, replayed: true } });
          state = r.state; writeState(state, env); await publish(store, state, r.changes, by);
          Object.assign(res, { to: 'local', ok: true });
        }
      } else throw new DataStoreError('invalid_body', `unknown command "${cmd}"`);
    } catch (e) { res.ok = false; res.reason = e.message; }
    finally { await uploadDrift(store, ns, env).catch(() => 0); }
    results.push(res);
  }
  return { $axf: 'data-mode-change@1', at, cmd, by, ok: results.every((r) => r.ok), results, summary: MODE.summary(state) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const flag = (k) => { const i = args.indexOf(`--${k}`); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, v && !v.startsWith('--') ? 2 : 1); return v && !v.startsWith('--') ? v : true; };
  const json = !!flag('json'); const all = !!flag('all'); const url = flag('url'); const token = flag('token'); const by = flag('by'); const windowMin = flag('window'); const accept = !!flag('accept-drift'); const tail = Number(flag('tail')) || 20;
  const cmd = ['status', 'shadow', 'cutover', 'rollback', 'local', 'drift'].includes(args[0]) ? args.shift() : 'status';
  const store = typeof url === 'string' ? createDataStore({ backend: httpBackend({ url, token: typeof token === 'string' ? token : process.env.AXF_DATA_TOKEN || '' }), by: 'svc:cli' }) : remoteStore();
  try {
    const r = await run({ cmd, only: args, all, store, by: typeof by === 'string' ? by : 'svc:cli', windowMin: windowMin === true ? undefined : windowMin, acceptDrift: accept, tail });
    if (json) console.log(JSON.stringify(r, null, 1));
    else if (r.$axf === 'data-mode-status@1') {
      console.log(`axf-data: ${r.remote.configured ? (r.remote.ok ? `up (cursor ${r.remote.cursor})` : 'NOT reachable') : 'not configured (AXF_DATA_URL)'}`);
      for (const n of r.namespaces) console.log(`  ${n.ns.padEnd(28)} ${n.mode.padEnd(9)} drift ${String(n.drift).padStart(3)}  next: ${n.next}${n.nextReason ? ` (${n.nextReason})` : ''}`);
      if (cmd === 'drift') for (const n of r.namespaces) for (const e of n.entries) console.log(`    ${e.at} ${e.op} ${e.kind} ${e.key}${e.error ? ` — ${e.error}` : ''}`);
    } else for (const x of r.results) console.log(`${x.ok ? '✓' : '✗'} ${x.ns}: ${x.from} → ${x.to || x.from}${x.reason ? `  ${x.reason}` : ''}`);
    process.exit(r.ok === false ? 1 : 0);
  } catch (e) { console.error(`data-mode: ${e.code || 'error'}: ${e.message}`); process.exit(1); }
}

export { canonical, keyFor };
