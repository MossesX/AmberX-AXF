#!/usr/bin/env node
/**
 * data-tables — move a set of shared-data files onto axf-data's Postgres tables, check them, cut them over
 * (framework/spec/DATA-INVENTORY.md "Order for s4"; build postgres-part-b-plan-plan-studio-catalog).
 *
 *   node framework/cli/data-tables.mjs sets                       the sets, their files, keys and tables
 *   node framework/cli/data-tables.mjs status <set>|all [--json]  per file: local vs axf-data (same / differs / missing /
 *                                                                 extra on axf-data), rows per table vs the rows the files give
 *   node framework/cli/data-tables.mjs backfill <set>|all [--apply]   write every file axf-data lacks or holds differently
 *                                                                 (ifMatch on the etag read), append journal lines it lacks
 *   node framework/cli/data-tables.mjs cutover <set> [--apply] [--keys]
 *                                                                 backfill, verify (every file equal, every table's rows equal
 *                                                                 the files' count), then flip the set's namespaces to cutover
 *                                                                 (data-mode rules: shadow first, no drift). --keys also flips the
 *                                                                 set's key-level overrides (data-store-mode@1 `keys`): only once
 *                                                                 every writer runs code that reads them (the console restarted
 *                                                                 on main after #848). --skip <ns/path> (repeatable) leaves one
 *                                                                 key override as it is.
 *   --url / --token override AXF_DATA_URL / AXF_DATA_TOKEN (the cli token reads `_meta/tables`). --projects <dir> names the
 *   hub volume (default AXHUB_PROJECTS_DIR or /projects).
 *
 * A set's tables count what each document gives them (`rows(doc)`), the same rule services/axf-data/tables.py applies, so
 * a table whose row count differs from the files means a key did not land in its table (or an extra key on axf-data).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import * as files from '../core/data-files.mjs';
import { DataStoreError, canonical } from '../core/data-store.mjs';
import * as MODE from '../core/data-store-mode.mjs';

const nowIso = () => new Date().toISOString();
const len = (v) => (Array.isArray(v) ? v.length : 0);
const dicts = (v) => Array.isArray(v) && v.every((x) => x && typeof x === 'object' && !Array.isArray(x));
const scalars = (v) => Array.isArray(v) && v.every((x) => x === null || ['string', 'number', 'boolean'].includes(typeof x));

/** Every file under `dir` (relative paths), recursively; dot files and temp files skipped. */
function walk(dir, base = dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || /\.tmp(-|$)|\.\d+\.\d+\.tmp$|\.lock$/.test(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, base));
    else if (e.isFile()) out.push(relative(base, p));
  }
  return out;
}

/**
 * The sets. `files(projects)` → absolute paths; `tables` → { table: (key, doc) → rows the key gives it, or 0 };
 * `namespaces` flip as a whole, `keys` (ns → paths, a trailing / is a prefix) flip as key-level overrides.
 */
export const SETS = {
  plan: {
    step: 's4.2',
    title: 'plan, Plan Studio, profiles, projects, plan media',
    files(P) {
      const fw = join(P, 'amberx-axf/_data/framework/plan');
      const out = ['plan.json', 'profiles.json', 'projects.json'].map((f) => join(fw, f)).filter(existsSync);
      out.push(...walk(join(fw, 'profiles')).filter((f) => f.endsWith('/framework/plan/plan.json')).map((f) => join(fw, 'profiles', f)));
      out.push(...walk(join(fw, 'media')).map((f) => join(fw, 'media', f)));
      for (const p of existsSync(P) ? readdirSync(P) : []) { const m = join(P, p, '_data/project.manifest.json'); if (existsSync(m)) out.push(m); }
      out.push(...walk(join(P, 'amberx-axf/_data/plan-studio')).map((f) => join(P, 'amberx-axf/_data/plan-studio', f)));
      const tree = join(P, 'amberx-axf/_data/plan-studio-2/tree.json');
      if (existsSync(tree)) out.push(tree);
      return out;
    },
    tables: {
      plan_items: (k, d) => (/^console\/framework\/plan\/(profiles\/[^/]+\/framework\/plan\/)?plan\.json$/.test(k) ? (dicts(d.features) ? len(d.features) : 0) + (scalars(d.statuses) ? len(d.statuses) : 0) : 0),
      plan_profiles: (k, d) => (k === 'console/framework/plan/profiles.json' && dicts(d.profiles) ? len(d.profiles) : 0),
      plan_projects: (k, d) => (k === 'console/framework/plan/projects.json' && dicts(d.projects) ? len(d.projects) : 0),
      projects: (k) => (/^console\/(projects\/[^/]+\/)?project\.manifest\.json$/.test(k) ? 1 : 0),
      plan_media: (k) => (k.startsWith('console/framework/plan/media/') ? 1 : 0),
      planner_items: (k) => (/^planner\/(plans|projects\/[^/]+\/plans)\/[^/]+\.json$/.test(k) ? 1 : 0),
      planner_history: (k, d) => (/^planner\/(projects\/[^/]+\/)?history\/[^/]+\.json$/.test(k) && dicts(d.versions) ? len(d.versions) : 0),
      planner_categories: (k, d) => (/^planner\/(projects\/[^/]+\/)?categories\.json$/.test(k) && scalars(d.paths) ? len(d.paths) : 0),
      planner_lists: (k, d) => (/^planner\/(projects\/[^/]+\/)?(deleted|catalog-seen|blueprints)\.json$/.test(k) ? (scalars(d.ids) ? len(d.ids) : 0) + (scalars(d.keys) ? len(d.keys) : 0) + (dicts(d.items) ? len(d.items) : 0) : 0),
      planner_tree: (k, d) => (k === 'planner/v2/tree.json' ? (dicts(d.items) ? len(d.items) : 0) + (dicts(d.trash) ? len(d.trash) : 0) : 0),
    },
    namespaces: ['planner'],
    keys: { console: ['framework/plan/plan.json', 'framework/plan/profiles.json', 'framework/plan/projects.json', 'framework/plan/media/', 'project.manifest.json', 'projects/'], planner: ['v2/'] },
    // held on the files while the namespace is cut over: Plan Studio 2's tree is written by tree.mjs, which only reaches
    // axf-data from this build on (data-files); until every writer runs it, a key override keeps both old and new code
    // on the file. `--keys` copies it once more and flips it with the console keys.
    pinLocal: { planner: ['v2/'] },
  },
  catalog: {
    step: 's4.3',
    title: 'feature catalog, libraries index, project rules (tracker.json is generated from catalog_features, not stored)',
    files(P) {
      const fw = join(P, 'amberx-axf/_data/framework');
      const out = ['catalog/status.json', 'catalog/libraries.json', 'schemas/project-rules.json'].map((f) => join(fw, f)).filter(existsSync);
      out.push(...walk(join(fw, 'plan/profiles')).filter((f) => /\/framework\/(catalog\/(status|libraries)|schemas\/project-rules)\.json$/.test(f)).map((f) => join(fw, 'plan/profiles', f)));
      return out;
    },
    tables: {
      catalog_features: (k, d) => (/^console\/framework\/(plan\/profiles\/[^/]+\/framework\/)?catalog\/status\.json$/.test(k) && d && typeof d === 'object' && !Array.isArray(d) ? Object.values(d).filter((v) => v && typeof v === 'object' && !Array.isArray(v)).length : 0),
      catalog_libraries: (k, d) => (/^console\/framework\/(plan\/profiles\/[^/]+\/framework\/)?catalog\/libraries\.json$/.test(k) && dicts(d.items) ? len(d.items) : 0),
      project_rules: (k, d) => (/^console\/framework\/(plan\/profiles\/[^/]+\/framework\/)?schemas\/project-rules\.json$/.test(k) ? (dicts(d.rules) ? len(d.rules) : 0) + (scalars(d.knownKeys) ? len(d.knownKeys) : 0) : 0),
    },
    namespaces: [],
    keys: { console: ['framework/catalog/status.json', 'framework/catalog/libraries.json', 'framework/schemas/project-rules.json'] },
    // generated documents: not data, rebuilt from the tables (tracker.mjs); the old copy on axf-data is dropped at the cut
    drop: ['console/tracker.json'],
  },
  sessions: {
    step: 's4.6',
    title: 'session archive (sessions + session_messages) and the codebase change log (codebase_changes)',
    files(P) {
      const out = [];
      for (const d of ['sessions', 'changes']) out.push(...walk(join(P, 'amberx-axf/_data', d)).map((f) => join(P, 'amberx-axf/_data', d, f)));
      return out;
    },
    tables: {
      sessions: (k) => (/^sessions\/archive\/.+\.json$/.test(k) ? 1 : 0),
      session_messages: (k, d) => (/^sessions\/archive\/.+\.json$/.test(k) && dicts(d.prompts) ? len(d.prompts) : 0),
      codebase_changes: (k) => (/^changes\/\d{4}\/\d{2}\/[^/]+\.json$/.test(k) ? 1 : 0),
    },
    namespaces: ['sessions', 'changes'],
    keys: {},
    // the writers still write the hub files themselves (codebase-changes changes-core.mjs ChangeStore.put, the chat
    // archiver); in cutover they would keep writing files nobody reads. They move to data-files first.
    flipBlocked: 'the change log (apps/console-web/plugins/codebase-changes/changes-core.mjs) and the session archiver write the hub files directly, not through framework/core/data-files.mjs: move them first, then cut',
  },
};

function remote(opts) {
  const env = { ...process.env, ...(opts.url ? { AXF_DATA_URL: opts.url } : {}), ...(opts.token ? { AXF_DATA_TOKEN: opts.token } : {}) };
  const s = files.remoteStore(env);
  if (!s) throw new DataStoreError('unavailable', 'axf-data is not configured (AXF_DATA_URL / --url)');
  return s;
}

const isJournal = (key) => files.kindOfKey(key) === 'journal';
const isRecord = (p) => p.endsWith('.json');

function localOf(p) {
  const raw = readFileSync(p);
  if (!isRecord(p)) return { raw, doc: null };
  try { return { raw, doc: JSON.parse(raw.toString('utf8')) }; } catch { return { raw, doc: undefined }; }
}
const linesOf = (raw) => raw.toString('utf8').split('\n').filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch { return undefined; } }).filter((x) => x !== undefined);

async function remoteEntries(store, key) {
  const out = []; let since = 0;
  for (;;) {
    let r; try { r = await store.read(key, { since, limit: 5000 }); } catch (e) { if (e.code === 'not_found') return out; throw e; }
    out.push(...r.entries.map((x) => x.entry));
    if (!r.next) break; since = r.next;
  }
  return out;
}

async function listAll(store, ns, prefix = '') {
  const out = []; let after;
  for (;;) {
    const r = await store.list(ns, { prefix, after, limit: 1000 });
    out.push(...r.items.filter((i) => !i.deleted));
    if (!r.next) break; after = r.next;
  }
  return out;
}

/** Compare (and with apply, copy) every file of a set; count what each table should hold. */
export async function check(name, { store, apply = false, projects = process.env.AXHUB_PROJECTS_DIR || '/projects', log = () => {} } = {}) {
  const set = SETS[name];
  if (!set) throw new DataStoreError('invalid_body', `unknown set ${name} (${Object.keys(SETS).join(', ')})`);
  const env = { ...process.env, AXHUB_PROJECTS_DIR: projects };
  const report = { $axf: 'data-tables-check@1', set: name, step: set.step, at: nowIso(), apply, ok: false, files: 0, same: 0, written: [], differs: [], missing: [], unmapped: [], extraRemote: [], journals: [], tables: {}, problems: [] };
  const want = Object.fromEntries(Object.keys(set.tables).map((t) => [t, 0]));
  const seen = new Set();
  for (const p of set.files(projects)) {
    const key = files.keyFor(p, env);
    if (!key) { report.unmapped.push(p); continue; }
    report.files++;
    seen.add(key);
    const { raw, doc } = localOf(p);
    if (isJournal(key)) {
      const local = linesOf(raw);
      const rem = await remoteEntries(store, key);
      const overlap = Math.min(local.length, rem.length);
      const bad = local.slice(0, overlap).findIndex((e, i) => canonical(e) !== canonical(rem[i]));
      const j = { key, local: local.length, remote: rem.length, appended: 0, mismatchAt: bad < 0 ? null : bad };
      if (bad >= 0) report.problems.push(`${key}: line ${bad + 1} differs between the file and axf-data`);
      else if (local.length > rem.length) {
        if (apply) { await store.append(key, local.slice(rem.length)); j.appended = local.length - rem.length; log(`${key}: appended ${j.appended} line(s)`); }
        else report.problems.push(`${key}: ${local.length - rem.length} line(s) not on axf-data (backfill --apply appends them)`);
      }
      report.journals.push(j);
      if (bad < 0) report.same++;
      continue;
    }
    if (doc === undefined) { report.problems.push(`${p}: not valid JSON (left as it is)`); continue; }
    const rec = await store.get(key);
    const remoteSame = rec && (doc !== null ? rec.data && typeof rec.data === 'object' && canonical(rec.data) === canonical(doc) : rec.data instanceof Uint8Array && Buffer.compare(Buffer.from(rec.data), raw) === 0);
    if (!remoteSame) {
      if (apply) {
        await store.put(key, doc !== null ? doc : new Uint8Array(raw), rec ? { ifMatch: rec.etag } : { create: true, ...(doc === null ? { force: true } : {}) });
        report.written.push(key);
        log(`${key}: ${rec ? 'updated' : 'created'}`);
      } else (rec ? report.differs : report.missing).push(key);
    }
    if (remoteSame || apply) report.same++;
    for (const [t, fn] of Object.entries(set.tables)) want[t] += doc ? fn(key, doc) : fn(key, {});
  }
  // keys axf-data holds under the set's prefixes that no file has: their rows count too, so they are listed
  const prefixes = [...set.namespaces.map((ns) => [ns, '']), ...Object.entries(set.keys).flatMap(([ns, ps]) => ps.map((p) => [ns, p]))];
  for (const [ns, prefix] of prefixes) {
    for (const it of await listAll(store, ns, prefix)) {
      const key = `${ns}/${it.path}`;
      if (!prefix.endsWith('/') && prefix && it.path !== prefix) continue;
      if (seen.has(key) || it.kind === 'journal') continue;
      report.extraRemote.push(key);
      const d = it.kind === 'record' ? ((await store.get(key))?.data || {}) : {};
      for (const [tn, fn] of Object.entries(set.tables)) want[tn] += fn(key, d);
    }
  }
  let t = null;
  try { const r = await store.backend.get('_meta', 'tables'); t = JSON.parse(new TextDecoder().decode(r.bytes)); } catch (e) { report.problems.push(`_meta/tables not readable (${e.code || 'error'}): row counts not checked`); }
  if (t) {
    const rows = Object.fromEntries((t.tables || []).map((x) => [x.name, x.rows]));
    for (const [tn, n] of Object.entries(want)) {
      report.tables[tn] = { want: n, rows: rows[tn] ?? null };
      if (rows[tn] === undefined) report.problems.push(`table ${tn} does not exist on axf-data (deploy axf-data with tables version ${'≥'} 3)`);
      else if (rows[tn] !== n) report.problems.push(`table ${tn}: ${rows[tn]} rows, the files give ${n}`);
    }
    report.backfill = t.backfill || null;
    for (const f of t.backfill?.failed || []) report.problems.push(`backfill left ${f.ns}/${f.path} out of ${f.table}: ${f.error}`);
  }
  if (!apply) for (const k of [...report.differs, ...report.missing]) report.problems.push(`${k}: ${report.differs.includes(k) ? 'differs on axf-data' : 'not on axf-data'} (backfill --apply writes it)`);
  report.ok = !report.problems.length;
  return report;
}

/** Backfill + verify, then flip the namespaces (and with keys, the key overrides). */
export async function cutover(name, { store, apply = false, keys = false, skip = [], by = 'svc:cli', projects, log = () => {} } = {}) {
  const set = SETS[name];
  const report = { ...(await check(name, { store, apply, projects, log })), $axf: 'data-tables-cutover@1', flipped: [] };
  if (apply) { const again = await check(name, { store, apply: false, projects }); report.verify = { ok: again.ok, problems: again.problems, tables: again.tables }; report.ok = again.ok; report.problems = again.problems; }
  if (!apply || !report.ok) return report;
  if (set.flipBlocked) { report.ok = false; report.problems.push(`not flipped: ${set.flipBlocked}`); return report; }
  for (const key of set.drop || []) {
    const rec = await store.get(key).catch(() => null);
    if (rec) { await store.delete(key, { ifMatch: rec.etag }); (report.dropped ||= []).push(key); log(`${key}: dropped (generated, not data)`); }
  }
  const dm = await import('./data-mode.mjs');
  // namespaces: data-mode's own cut (manifests over the local files vs axf-data, drift, quiet window, snapshot)
  for (const ns of set.namespaces) {
    if (MODE.modeOf(dm.readState(), ns) === 'cutover') continue;
    const res = await dm.run({ cmd: 'cutover', only: [ns], store, by });
    for (const x of res.results || res.rows || []) if (x.ns === ns) { if (x.ok) report.flipped.push(`${ns}: ${x.from} → cutover`); else report.problems.push(`${ns}: ${x.reason}`); }
  }
  let state = dm.readState();
  const changes = [];
  if (!keys) {
    for (const [ns, paths] of Object.entries(set.pinLocal || {})) {
      for (const p of paths) {
        if (MODE.modeOf(state, ns, p.endsWith('/') ? `${p}x` : p) === 'local') continue;
        const r = MODE.transitionKey(state, { ns, path: p, to: 'local', at: nowIso(), by, verified: { at: nowIso(), how: 'data-tables: held on the files until its writers run data-files' } });
        state = r.state; changes.push(...r.changes);
      }
    }
  }
  if (keys) {
    const verified = { at: nowIso(), how: `data-tables cutover ${name}: every file equal on axf-data, rows per table equal`, tables: report.tables };
    for (const [ns, paths] of Object.entries(set.keys)) {
      for (const p of paths) {
        if (skip.includes(`${ns}/${p}`)) continue;
        if (MODE.modeOf(state, ns, p.endsWith('/') ? `${p}x` : p) === 'cutover') continue;
        const r = MODE.transitionKey(state, { ns, path: p, to: 'cutover', at: nowIso(), by, verified });
        state = r.state; changes.push(...r.changes);
      }
    }
  }
  if (changes.length) {
    dm.writeState(state);
    try { await dm.publish(store, state, changes, by); report.published = true; } catch (e) { report.published = false; report.publishError = `${e.code || 'error'}: ${e.message}`; }
  }
  report.flipped.push(...changes.map((c) => `${c.ns}${c.key ? `/${c.key}` : ''}: ${c.from} → ${c.to}`));
  report.ok = !report.problems.length;
  return report;
}

function print(r) {
  console.log(`${r.set} (${r.step}) · ${r.files} file(s) · ${r.same} equal on axf-data${r.written.length ? ` · ${r.written.length} written` : ''}${r.extraRemote.length ? ` · ${r.extraRemote.length} only on axf-data` : ''}`);
  for (const [t, v] of Object.entries(r.tables)) console.log(`  ${t.padEnd(20)} rows ${String(v.rows ?? '—').padStart(6)}  files give ${String(v.want).padStart(6)}  ${v.rows === v.want ? 'ok' : 'DIFFERS'}`);
  for (const j of r.journals) console.log(`  journal ${j.key}: ${j.local} line(s) local, ${j.remote} on axf-data${j.appended ? `, ${j.appended} appended` : ''}`);
  if (r.extraRemote.length) console.log(`  only on axf-data: ${r.extraRemote.slice(0, 8).join(', ')}${r.extraRemote.length > 8 ? ' …' : ''}`);
  if (r.flipped?.length) console.log(`  flipped: ${r.flipped.join('; ')}`);
  if (r.dropped?.length) console.log(`  dropped: ${r.dropped.join(', ')}`);
  for (const p of r.problems) console.log(`  ✗ ${p}`);
  console.log(r.ok ? '  ✓ ok' : '  ✗ not ok');
}

async function main(argv) {
  const args = [...argv];
  const flag = (n) => { const i = args.indexOf(n); if (i < 0) return false; args.splice(i, 1); return true; };
  const opt = (n) => { const i = args.indexOf(n); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
  const json = flag('--json'); const apply = flag('--apply'); const keys = flag('--keys');
  const skip = []; for (let v = opt('--skip'); v; v = opt('--skip')) skip.push(v);
  const url = opt('--url'); const token = opt('--token'); const projects = opt('--projects') || process.env.AXHUB_PROJECTS_DIR || '/projects';
  const [cmd = 'sets', which = 'all'] = args;
  if (cmd === 'sets') {
    for (const [n, s] of Object.entries(SETS)) console.log(`${n.padEnd(8)} ${s.step}  ${s.title}\n         tables: ${Object.keys(s.tables).join(', ')}\n         namespaces: ${s.namespaces.join(', ') || '—'} · keys: ${Object.entries(s.keys).map(([ns, ps]) => ps.map((p) => `${ns}/${p}`).join(', ')).join(', ') || '—'}${s.drop ? ` · generated (dropped at the cut): ${s.drop.join(', ')}` : ''}`);
    return 0;
  }
  const store = remote({ url, token });
  const names = which === 'all' ? Object.keys(SETS) : [which];
  let ok = true;
  for (const n of names) {
    const log = json ? () => {} : (m) => console.log(`  ${m}`);
    const r = cmd === 'cutover' ? await cutover(n, { store, apply, keys, skip, projects, log })
      : await check(n, { store, apply: cmd === 'backfill' && apply, projects, log });
    ok = ok && r.ok;
    if (json) console.log(JSON.stringify(r, null, 1)); else print(r);
  }
  return ok ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { console.error(`data-tables: ${e.code || 'error'}: ${e.message}`); process.exit(2); });
}
