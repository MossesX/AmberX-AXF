#!/usr/bin/env node
/**
 * data-migrate — copy the console's data onto axf-data, one namespace at a time, and prove nothing was lost.
 *
 * Brett, Nov 15 2026: "the console goes down, all the data is still available, all the notes are available, and the
 * builds keep running. That's what I need."
 *
 *   node framework/cli/data-migrate.mjs [plan] [<ns>…]        DRY RUN (the default): files, keys, bytes, kinds per namespace,
 *                                                            unparseable / large / unmapped files; nothing written anywhere
 *   node framework/cli/data-migrate.mjs apply <ns>… | --all   backup first (required), copy, verify; refuses on any mismatch
 *   node framework/cli/data-migrate.mjs verify [<ns>…]        M0 (source) against M1 (axf-data) without copying
 *   --json  machine output · --url / --token  axf-data (default AXF_DATA_URL / AXF_DATA_TOKEN) · --report-dir <dir>
 *
 * The map is framework/schemas/data-store-paths.json (the rules form of fixtures/data-store-migration.json), walked over
 * the four roots (plugins, data, repo `_claude/builds`, projects). Rules: framework/spec/DATA-STORE.md → Migration.
 *
 *   M0   computed over the source with the copy's own mapping, every key at rev 1: a record's etag is
 *        etagOf(1, canonical JSON), a blob's etagOf(1, bytes), a journal's journalEtag(its entries)
 *   M1   computed over axf-data the same way (record / blob hash under rev 1, a journal's etag over the entries read
 *        back), so a re-run after a later write still compares content, not revs
 *   copy idempotent: a key whose content already matches is skipped; a journal gets only the entries it lacks (its first
 *        entries must match the source: a journal is never truncated or rewritten, a difference is a mismatch)
 *   gate sameManifest(M0, M1).equal, plus row counts per table for SQLite files; any difference = exit 1, the report
 *        says which keys, and the namespace stays in local mode (nothing reads the target until `data-mode shadow`)
 *   backup before any write: a tar.gz of the namespace's source files in <data>/migration/backups/, plus a snapshot
 *        on axf-data when the token may take one
 *   report <data>/migration/<ns>.json (data-migration-report@1), and the M0 / M1 pair in it
 */
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DataStoreError, LIMITS, NAMESPACES, canonical, createDataStore, etagOf, httpBackend, journalEtag, manifestOf, sameManifest } from '../core/data-store.mjs';
import { kindOfKey, mapRel, nsIdOf, remoteStore, roots } from '../core/data-files.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const ORDER = JSON.parse(readFileSync(join(ROOT, 'framework/spec/fixtures/data-store-migration.json'), 'utf8')).order;
const SKIP_FILE = /(\.tmp(-\d+)?|\.tmp\.\d+|\.lock|\.running|\.pid|\.axf-etag|-wal|-shm|\.axf-(upload|fetch)-\d+|\.bak)$|\/\.history-lock$/;
const LARGE = 1 << 20;
const enc = new TextEncoder();
const utf8len = (s) => enc.encode(s).length;

// ── source: walk the roots, map every file ────────────────────────────────────────────────────────────────────────────
// Not data: package installs, and git checkouts inside a data folder (agent-swarm's job worktrees hold whole repo copies,
// tens of GB). A folder with a `.git` entry (a clone's directory or a worktree's file) is a checkout.
const SKIP_DIR = new Set(['node_modules', '.git']);
export const isCheckout = (ents) => ents.some((e) => e.name === '.git');
function walk(dir, out = [], top = true) {
  let ents; try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  if (!top && isCheckout(ents)) return out;
  for (const e of ents) {
    const f = join(dir, e.name);
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) { if (!SKIP_DIR.has(e.name)) walk(f, out, false); } else if (e.isFile()) out.push(f);
  }
  return out;
}
/** Where to walk under each root (the repo holds only _claude/builds; the rest of the checkout maps to nothing). */
function startDirs(r) {
  const projects = existsSync(r.projects) ? readdirSync(r.projects).filter((p) => !p.startsWith('.')).flatMap((p) => [join(r.projects, p, '_data'), ...(p === '_shared' ? [join(r.projects, p, '_claude')] : [])]) : [];
  return { plugins: [r.plugins], data: [join(r.data, 'state.json'), join(r.data, 'deploys')], repo: [join(r.repo, '_claude/builds')], projects };
}
/** Every source file → { file, root, rel, key, ns } or listed as unmapped / skipped. */
export function scan(env = process.env) {
  const r = roots(env); const starts = startDirs(r);
  const order = ['plugins', 'data', 'repo', 'projects'];
  const seen = new Set(); const mapped = []; const unmapped = []; let skipped = 0;
  for (const root of order) {
    for (const s of starts[root]) {
      const files = existsSync(s) && lstatSync(s).isFile() ? [s] : walk(s);
      for (const f of files) {
        if (seen.has(f)) continue; seen.add(f);
        // a file under an earlier root (plugins inside data) belongs to that root
        const owner = order.find((o) => { const rel = relative(r[o], f); return rel && !rel.startsWith('..') && !rel.startsWith(sep); });
        if (owner !== root) continue;
        const rel = relative(r[root], f).split(sep).join('/');
        if (SKIP_FILE.test(rel)) { skipped += 1; continue; }
        const key = mapRel(root, rel);
        if (!key) { unmapped.push(`${root}:${rel}`); continue; }
        mapped.push({ file: f, root, rel, key, ns: nsIdOf(key) });
      }
    }
  }
  return { roots: r, mapped, unmapped, skipped };
}

/**
 * A SQLite file as SQLite itself sees it: the backup API copies the main file plus whatever still sits in its -wal
 * (the console writes ledger.sqlite in WAL mode; the raw bytes alone miss the rows not checkpointed yet, and the row
 * counts, read through SQLite, would then differ). The source is opened read-only. Raw bytes when python3 is missing.
 */
function sqliteSnapshot(file) {
  const dir = mkdtempSync(join(tmpdir(), 'data-migrate-sqlite-')); const out = join(dir, 'snap.sqlite');
  try {
    execFileSync('python3', ['-I', '-c', 'import sqlite3,sys;s=sqlite3.connect("file:"+sys.argv[1]+"?mode=ro",uri=True);d=sqlite3.connect(sys.argv[2]);s.backup(d);d.execute("PRAGMA journal_mode=DELETE");d.close();s.close()', file, out], { stdio: ['ignore', 'ignore', 'pipe'] });
    return readFileSync(out);
  } catch { return readFileSync(file); } finally { rmSync(dir, { recursive: true, force: true }); }
}
/** One source file as it will be stored: kind, the body to send, and its rev-1 manifest item. */
function sourceItem(src) {
  // ns = the registry namespace (plugins, builds, …); nsid = the migration unit (plugins/<folder> for open namespaces).
  // Manifest paths are relative to the nsid, as on the axf-data side (remoteItems strips the same prefix).
  const ns = src.key.split('/')[0];
  const nsid = src.ns || nsIdOf(src.key);
  const path = src.key.slice(nsid.length + 1);
  let raw;
  // live data: a file listed by the walk can be gone by the time it is read (rotated reports); it is simply not part of
  // this source any more (left out of M0, like a file that never existed)
  try { raw = sqliteFile(src.key) ? sqliteSnapshot(src.file) : readFileSync(src.file); } catch (e) { if (e?.code === 'ENOENT') return { ...src, vanished: true, notes: [] }; throw e; }
  let kind = kindOfKey(src.key);
  const notes = [];
  if (kind === 'record') {
    try {
      const doc = JSON.parse(raw.toString('utf8'));
      const body = canonical(doc);
      if (utf8len(body) > LARGE) notes.push('large');
      return { ...src, kind, data: doc, item: { path, kind, etag: etagOf(1, body), size: utf8len(body) }, notes };
    } catch {
      if (!NAMESPACES[ns].kinds.includes('blob')) return { ...src, kind, error: 'unparseable', notes: ['unparseable'] };
      kind = 'blob'; notes.push('asBlob');
    }
  }
  if (kind === 'journal') {
    const lines = raw.toString('utf8').split('\n').filter((l) => l.trim());
    const entries = []; const bad = [];
    lines.forEach((l, i) => { try { entries.push(JSON.parse(l)); } catch { bad.push(i + 1); } });
    if (bad.length) notes.push(`skipped ${bad.length} unparseable line(s): ${bad.slice(0, 5).join(', ')}`);
    // an entry over the 256 KiB entry limit moves as a record, and the journal keeps a pointer line in its place
    // ({ large: <key>, rev?, at?, by?, action? }: what builds-store.mjs writes and journalOf reads back)
    const extras = [];
    const stored = entries.map((e, i) => {
      if (utf8len(canonical(e)) <= LIMITS.entryBytes) return e;
      if (!NAMESPACES[ns].kinds.includes('record')) return e;
      const key = `${nsid}/journal-large/${path.replace(/\//g, '__').slice(0, 60)}-${String(i + 1).padStart(6, '0')}.json`;
      const body = canonical(e);
      extras.push({ ...src, key, kind: 'record', data: e, item: { path: key.slice(nsid.length + 1), kind: 'record', etag: etagOf(1, body), size: utf8len(body) }, notes: ['large-entry'] });
      return Object.fromEntries([['large', key], ...['rev', 'at', 'by', 'action'].filter((k) => e && e[k] !== undefined).map((k) => [k, e[k]])]);
    });
    const big = stored.filter((e) => utf8len(canonical(e)) > LIMITS.entryBytes).length;
    if (big) return { ...src, kind, error: `${big} entr${big === 1 ? 'y is' : 'ies are'} over the ${LIMITS.entryBytes}-byte entry limit`, notes };
    if (extras.length) notes.push(`${extras.length} large entr${extras.length === 1 ? 'y' : 'ies'} moved as records`);
    return { ...src, kind, entries: stored, extras, item: { path, kind, etag: journalEtag(stored), entries: stored.length, size: stored.reduce((n, e) => n + canonical(e).length + 1, 0) }, notes };
  }
  if (!NAMESPACES[ns].kinds.includes('blob')) return { ...src, kind: 'blob', error: `${ns} holds no blobs (${src.rel})`, notes };
  // Over the blob limit: the file stays local, listed with why (not an error, so the rest of the namespace still
  // moves). SQLite files the console still writes (chat-viewer/chats.db) reach Postgres as tables via mirror_sync.
  if (raw.length > LIMITS.blobBytes) return { ...src, kind: 'blob', local: `${raw.length} bytes, over the ${LIMITS.blobBytes}-byte blob limit: stays local${sqliteFile(src.key) ? ' (its tables are mirrored by axf-data: mirror_sync / axf data tables --sync)' : ''}`, notes };
  const bytes = new Uint8Array(raw);
  return { ...src, kind: 'blob', bytes, item: { path, kind: 'blob', etag: etagOf(1, bytes), size: bytes.length }, notes };
}
const nsPrefix = (nsid) => { const [head, folder] = nsid.split('/'); return { head, prefix: folder ? `${folder}/` : '' }; };
const sqliteFile = (k) => /\.(sqlite|db)$/i.test(k);

/** Row counts per table of a SQLite file (python3's sqlite3; null when python3 isn't there). */
function sqliteRows(file) {
  try { return JSON.parse(execFileSync('python3', ['-I', '-c', 'import sqlite3,sys,json;c=sqlite3.connect("file:"+sys.argv[1]+"?mode=ro",uri=True);print(json.dumps({t:c.execute(f"SELECT COUNT(*) FROM \\"{t}\\"").fetchone()[0] for (t,) in c.execute("SELECT name FROM sqlite_master WHERE type=\'table\' AND name NOT LIKE \'sqlite_%\'")}))', file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })); } catch { return null; }
}

// ── plan ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
export function plan(scanned, only = []) {
  const byNs = new Map();
  for (const s of scanned.mapped) { if (only.length && !only.some((o) => s.ns === o || s.ns.startsWith(`${o}/`))) continue; if (!byNs.has(s.ns)) byNs.set(s.ns, []); byNs.get(s.ns).push(s); }
  const rank = (ns) => { const i = ORDER.indexOf(ns.split('/')[0]); return i < 0 ? 99 : i; };
  const out = [];
  for (const ns of [...byNs.keys()].sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : 1))) {
    const all = byNs.get(ns).map(sourceItem).filter((i) => !i.vanished).flatMap((i) => [i, ...(i.extras || [])]);
    const items = all.filter((i) => !i.local);
    const ok = items.filter((i) => !i.error);
    out.push({
      ns, files: items.length, keys: ok.length, m0: manifestOf(ok.map((i) => i.item)),
      kinds: ok.reduce((m, i) => ({ ...m, [i.kind]: (m[i.kind] || 0) + 1 }), {}),
      errors: items.filter((i) => i.error).map((i) => ({ key: i.key, file: i.file, error: i.error })),
      large: ok.filter((i) => i.notes.includes('large')).map((i) => i.key), asBlob: ok.filter((i) => i.notes.includes('asBlob')).map((i) => i.key),
      notes: ok.filter((i) => i.notes.some((n) => n.startsWith('skipped') || n.includes('moved as records'))).map((i) => `${i.key}: ${i.notes.join('; ')}`),
      sqlite: ok.filter((i) => sqliteFile(i.key)).map((i) => i.key),
      stayLocal: all.filter((i) => i.local).map((i) => ({ key: i.key, why: i.local })),
      items,
    });
  }
  return out;
}

// ── target: M1 over axf-data, the same way ────────────────────────────────────────────────────────────────────────────
async function remoteItems(store, nsid) {
  const { head, prefix } = nsPrefix(nsid);
  const out = []; let after = '';
  for (;;) {
    const l = await store.list(head, { prefix, after });
    for (const i of l.items) {
      const path = i.path.slice(prefix.length);
      if (i.kind === 'journal') {
        const entries = []; let since = 0;
        for (;;) { const r = await store.read(`${head}/${i.path}`, { since }); entries.push(...r.entries.map((e) => e.entry)); if (!r.next) break; since = r.next; }
        out.push({ path, kind: 'journal', etag: journalEtag(entries), entries: entries.length, size: entries.reduce((n, e) => n + canonical(e).length + 1, 0), list: entries });
      } else out.push({ path, kind: i.kind, etag: `1-${i.etag.split('-')[1]}`, size: i.size });
    }
    if (!l.next) break; after = l.next;
  }
  return out;
}
export async function manifestRemote(store, nsid) { return manifestOf((await remoteItems(store, nsid)).map(({ list, ...i }) => i)); }

// ── copy ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
async function copyOne(store, it, have) {
  const key = it.key;
  if (it.kind === 'journal') {
    const cur = have?.list || [];
    for (let i = 0; i < cur.length; i += 1) if (i >= it.entries.length || canonical(cur[i]) !== canonical(it.entries[i])) return { key, op: 'mismatch', why: i >= it.entries.length ? `axf-data has ${cur.length} entries, the source ${it.entries.length}` : `entry ${i + 1} differs` };
    const rest = it.entries.slice(cur.length);
    let sent = 0;
    while (sent < rest.length) {
      let n = 0, bytes = 0;
      while (sent + n < rest.length && n < 2000) { const b = canonical(rest[sent + n]).length + 1; if (n && bytes + b > LIMITS.appendBytes - 1024) break; bytes += b; n += 1; }
      await store.append(key, rest.slice(sent, sent + n), { idempotencyKey: `migrate-${cur.length + sent}-${n}` });
      sent += n;
    }
    return { key, op: rest.length ? (cur.length ? 'appended' : 'created') : 'same', entries: rest.length };
  }
  if (have && have.etag === it.item.etag) return { key, op: 'same' };
  const cur = have ? await store.get(key) : null;
  const pre = cur ? { ifMatch: cur.etag } : { create: true };
  if (it.kind === 'record') await store.put(key, it.data, pre);
  else await store.put(key, it.bytes, { ...pre, contentType: /\.md$/i.test(key) ? 'text/markdown' : sqliteFile(key) ? 'application/vnd.sqlite3' : 'application/octet-stream' });
  return { key, op: cur ? 'updated' : 'created' };
}

function backupSource(dataDir, p, at) {
  const dir = join(dataDir, 'migration', 'backups'); mkdirSync(dir, { recursive: true });
  const file = join(dir, `${p.ns.replace('/', '__')}-${at.replace(/[^0-9]/g, '').slice(0, 14)}.tar.gz`);
  const list = join(dir, `.${process.pid}.list`);
  writeFileSync(list, p.items.map((i) => i.file).join('\n'));
  // live data: a file can vanish between the scan and the backup (rotated reports); the copy uses the bytes read at the
  // scan, so a vanished file is not lost from the copy, only from this tarball: tar notes it and goes on
  try { execFileSync('tar', ['-czf', file, '--absolute-names', '--ignore-failed-read', '-T', list], { stdio: ['ignore', 'ignore', 'pipe'] }); } finally { rmSync(list, { force: true }); }
  return file;
}

async function verifyNs(store, p, tmp) {
  const m1 = await manifestRemote(store, p.ns);
  const same = sameManifest({ namespaces: { [p.ns]: p.m0 } }, { namespaces: { [p.ns]: m1 } });
  const out = { m1, equal: same.equal, diffs: same.diffs, keys: [] };
  if (!same.equal) {
    const remote = new Map((await remoteItems(store, p.ns)).map((i) => [i.path, i]));
    for (const it of p.items.filter((i) => !i.error)) { const r = remote.get(it.item.path); if (!r) out.keys.push({ key: it.key, why: 'missing on axf-data' }); else if (r.etag !== it.item.etag) out.keys.push({ key: it.key, why: 'content differs' }); remote.delete(it.item.path); }
    for (const path of remote.keys()) out.keys.push({ key: `${nsPrefix(p.ns).head}/${nsPrefix(p.ns).prefix}${path}`, why: 'only on axf-data' });
  }
  for (const k of p.sqlite) {
    const it = p.items.find((i) => i.key === k);
    const rec = await store.get(k);
    if (!rec) continue;
    const f = join(tmp, k.replace(/\//g, '__')); writeFileSync(f, Buffer.from(rec.data));
    const a = sqliteRows(it.file), b = sqliteRows(f);
    if (a && b && JSON.stringify(a) !== JSON.stringify(b)) { out.equal = false; out.keys.push({ key: k, why: `row counts differ: ${JSON.stringify(a)} vs ${JSON.stringify(b)}` }); }
    out.rows = { ...(out.rows || {}), [k]: a };
  }
  if (p.errors.length) { out.equal = false; out.keys.push(...p.errors.map((e) => ({ key: e.key, why: e.error }))); }
  return out;
}

export async function run({ cmd = 'plan', only = [], store = null, env = process.env, reportDir = '', at = new Date().toISOString(), log = () => {} } = {}) {
  const scanned = scan(env);
  const plans = plan(scanned, only);
  const dataDir = roots(env).data;
  const repDir = reportDir || join(dataDir, 'migration');
  const summary = { $axf: 'data-migration-run@1', cmd, at, dryRun: cmd === 'plan', namespaces: [], unmapped: scanned.unmapped.length, skipped: scanned.skipped, ok: true };
  if (cmd === 'plan') {
    for (const p of plans) summary.namespaces.push({ ns: p.ns, files: p.files, keys: p.keys, kinds: p.kinds, count: p.m0.count, bytes: p.m0.bytes, hash: p.m0.hash, errors: p.errors, large: p.large, asBlob: p.asBlob, sqlite: p.sqlite, notes: p.notes, stayLocal: p.stayLocal });
    summary.ok = plans.every((p) => !p.errors.length);
    summary.unmappedSample = scanned.unmapped.slice(0, 20);
    return summary;
  }
  if (!store) throw new DataStoreError('unavailable', 'axf-data is not configured (AXF_DATA_URL / --url)');
  const tmp = mkdtempSync(join(tmpdir(), 'data-migrate-'));
  try {
    for (const p of plans) {
      const rep = { $axf: 'data-migration-report@1', ns: p.ns, at, cmd, files: p.files, m0: p.m0, large: p.large, asBlob: p.asBlob, errors: p.errors, notes: p.notes };
      if (cmd === 'apply') {
        if (p.errors.length) { rep.refused = `${p.errors.length} source file(s) can't move: fix them first`; rep.ok = false; }
        else {
          rep.backup = backupSource(dataDir, p, at); log(`${p.ns}: backup ${rep.backup}`);
          try { const snap = await store.snapshot([p.ns]); rep.targetSnapshot = snap.id; } catch (e) { if (e.code !== 'forbidden') throw e; rep.targetSnapshot = 'not allowed for this token'; }
          const remote = new Map((await remoteItems(store, p.ns)).map((i) => [i.path, i]));
          rep.copy = [];
          for (const it of p.items) rep.copy.push(await copyOne(store, it, remote.get(it.item.path)));
          rep.counts = rep.copy.reduce((m, c) => ({ ...m, [c.op]: (m[c.op] || 0) + 1 }), {});
          log(`${p.ns}: ${Object.entries(rep.counts).map(([k, v]) => `${v} ${k}`).join(', ')}`);
        }
      }
      if (rep.refused === undefined) {
        const v = await verifyNs(store, p, tmp);
        Object.assign(rep, { m1: v.m1, equal: v.equal, diffs: v.diffs, mismatches: v.keys, rows: v.rows });
        if (rep.copy?.some((c) => c.op === 'mismatch')) { rep.equal = false; rep.mismatches.push(...rep.copy.filter((c) => c.op === 'mismatch').map((c) => ({ key: c.key, why: c.why }))); }
        rep.ok = rep.equal;
        if (!rep.ok && cmd === 'apply') rep.refused = 'manifests differ after the copy: the namespace stays local (nothing reads axf-data), fix and re-run';
      }
      mkdirSync(repDir, { recursive: true });
      writeFileSync(join(repDir, `${p.ns.replace('/', '__')}.json`), `${JSON.stringify(rep, null, 1)}\n`);
      summary.namespaces.push({ ns: p.ns, ok: rep.ok, count: p.m0.count, m1: rep.m1?.count, copy: rep.counts, refused: rep.refused, mismatches: (rep.mismatches || []).slice(0, 20), backup: rep.backup });
      if (!rep.ok) summary.ok = false;
    }
  } finally { rmSync(tmp, { recursive: true, force: true }); }
  return summary;
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const flag = (k) => { const i = args.indexOf(`--${k}`); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, v && !v.startsWith('--') ? 2 : 1); return v && !v.startsWith('--') ? v : true; };
  const json = !!flag('json'); const all = !!flag('all'); const url = flag('url'); const token = flag('token'); const reportDir = flag('report-dir');
  const cmd = ['plan', 'apply', 'verify'].includes(args[0]) ? args.shift() : 'plan';
  if (cmd === 'apply' && !all && !args.length) { console.error('apply needs the namespaces to move (or --all): node framework/cli/data-migrate.mjs apply settings'); process.exit(2); }
  const store = typeof url === 'string' ? createDataStore({ backend: httpBackend({ url, token: typeof token === 'string' ? token : process.env.AXF_DATA_TOKEN || '' }), by: 'svc:cli' }) : remoteStore();
  try {
    const r = await run({ cmd, only: all ? [] : args, store, reportDir: typeof reportDir === 'string' ? reportDir : '', log: json ? () => {} : (l) => console.log(l) });
    if (json) console.log(JSON.stringify(r, null, 1));
    else {
      console.log(`${cmd === 'plan' ? 'Dry run (nothing written)' : cmd}: ${r.namespaces.length} namespace(s), ${r.unmapped} unmapped file(s) stay local, ${r.skipped} temp/lock file(s) skipped`);
      for (const n of r.namespaces) console.log(cmd === 'plan' ? `  ${n.ns.padEnd(28)} ${String(n.count).padStart(6)} keys ${String(n.bytes).padStart(12)} bytes ${JSON.stringify(n.kinds)}${n.errors.length ? `  ✗ ${n.errors.length} can't move` : ''}${n.large.length ? `  large: ${n.large.join(', ')}` : ''}${n.stayLocal?.length ? `  stays local: ${n.stayLocal.map((x) => x.key).join(', ')}` : ''}` : `  ${n.ok ? '✓' : '✗'} ${n.ns.padEnd(28)} ${n.count} → ${n.m1 ?? '?'}${n.refused ? `  REFUSED: ${n.refused}` : ''}${n.mismatches.length ? `  ${n.mismatches.map((m) => `${m.key} (${m.why})`).slice(0, 3).join('; ')}` : ''}`);
    }
    process.exit(r.ok ? 0 : 1);
  } catch (e) { console.error(`data-migrate: ${e.code || 'error'}: ${e.message}`); process.exit(1); }
}
