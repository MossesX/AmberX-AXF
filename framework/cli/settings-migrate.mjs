#!/usr/bin/env node
/**
 * settings-migrate — move a duplicated setting onto its one true source (settings-source@1, SETTINGS-SOURCES.md →
 * Migration). For every key: read the owner and every former store that still holds it, keep the owner's value when it
 * is set (else the newest copy, recorded), write it to the owner, strip the key from the other stores, journal
 * before / after. Dry run by default.
 *
 *   node framework/cli/settings-migrate.mjs <key-or-pattern>… [--dry-run] [--apply] [--json]
 *   node framework/cli/settings-migrate.mjs --all [--apply]              every registry entry that has a `formerly`
 *   --registry <file>   another registry (tests)       --journal <file>   another journal (default: the build's migrations.json)
 *
 * A pattern (`accounts.*.use`) is expanded against the documents: every concrete key found in the owner or a former
 * store is one migration row. Journal: _claude/builds/reports/one-true-source-for-every-setting/migrations.json
 * ({ $axf: 'settings-migration@1', entries: [{ at, key, owner, pick: { store, value, why }, before, after, applied }] });
 * in before / after a store's value is `null` when it was unset / has been removed.
 */
import { statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, updateJson } from '../core/data-files.mjs';
import * as S from '../core/settings-source.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const JOURNAL_FRAME = 'settings-migration@1';
export const JOURNAL_FILE = join(REPO, '_claude/builds/reports/one-true-source-for-every-setting/migrations.json');

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
/**
 * Concrete keys a pattern entry has in `doc` at pointer template `tpl`: every `{n}` enumerates the object keys at that
 * level, `{rest}` the flat keys there, `{rest/}` every leaf path below. Returns [{ key, captures }].
 */
export function expandKeys(pattern, tpl, doc) {
  const c = S.compilePattern(pattern);
  const segs = S.pointerSegments(String(tpl).replace('{rest/}', '{nested}'));
  const out = [];
  const walk = (node, i, caps) => {
    if (i === segs.length) { out.push(caps); return; }
    const seg = segs[i];
    const m = /^\{(\d+|rest|nested)\}$/.exec(seg);
    if (!m) { if (isObj(node) && Object.hasOwn(node, seg)) walk(node[seg], i + 1, caps); return; }
    if (!isObj(node)) return;
    if (m[1] === 'rest') { for (const k of Object.keys(node)) if (/^[a-z0-9][a-zA-Z0-9_.-]*$/.test(k)) walk(node[k], i + 1, { ...caps, rest: k }); return; }
    if (m[1] === 'nested') { const leaves = (n, path) => { if (isObj(n) && Object.keys(n).length && path.length < 8) { for (const k of Object.keys(n)) if (/^[a-z0-9][a-zA-Z0-9_-]*$/.test(k)) leaves(n[k], [...path, k]); } else if (path.length) walk(n, i + 1, { ...caps, rest: path.join('.') }); }; leaves(node, []); return; }
    for (const k of Object.keys(node)) if (/^[a-z0-9][a-zA-Z0-9_-]*$/.test(k)) walk(node[k], i + 1, { ...caps, [m[1]]: k });
  };
  walk(doc, 0, {});
  const seen = new Set(); const rows = [];
  for (const caps of out) {
    let n = 0; const key = c.segs.map((s) => (s === '*' ? caps[String(++n)] : s)).concat(c.rest ? String(caps.rest || '').split('.') : []).join('.');
    if (!S.validKey(key) || seen.has(key)) continue;
    seen.add(key); rows.push({ key, captures: caps });
  }
  return rows;
}

const mtimeOf = (file) => { try { return statSync(file).mtimeMs; } catch { return 0; } };
const docTime = (doc, file) => { const t = isObj(doc) && typeof doc.updatedAt === 'string' ? Date.parse(doc.updatedAt) : NaN; return Number.isFinite(t) ? t : mtimeOf(file); };

/** The registry entries that still name a former store (the duplicates to migrate), as patterns. */
export function patternsWithFormerly(registry = S.loadRegistry()) { return registry.settings.filter((e) => Array.isArray(e.formerly) && e.formerly.length).map((e) => e.key); }

/** Every concrete key `pattern` has in the owner or a former store today. */
export async function keysFor(pattern, { registry = S.loadRegistry(), env = process.env } = {}) {
  if (S.validKey(pattern)) return [pattern];
  const entry = registry.settings.find((e) => e.key === pattern);
  if (!entry) throw new S.SettingsSourceError('no_owner', `"${pattern}" is not a registry key or pattern`);
  const store = { id: entry.store, ...registry.stores[entry.store] };
  const places = [{ store, pointer: entry.pointer }, ...(entry.formerly || []).map((f) => ({ store: { id: f.store, ...registry.stores[f.store] }, pointer: f.pointer || '' }))];
  const keys = new Set();
  for (const p of places) {
    if (p.store.kind !== 'data-store' || /\{\d+\}/.test(p.store.path)) continue; // a per-capture document (looks/{1}.json) is listed by concrete key
    const doc = await readJson(S.storeFile(p.store, {}, env), null);
    if (doc === null) continue;
    for (const r of expandKeys(pattern, p.pointer, doc)) keys.add(r.key);
  }
  return [...keys].sort();
}

/** What moving `key` would do: { key, owner, holders: [{ store, pointer, file, value, set, at }], pick, strip, conflict }. */
export async function planKey(key, { registry = S.loadRegistry(), env = process.env } = {}) {
  const owner = S.ownerOf(key, { registry, env });
  if (!owner) throw new S.SettingsSourceError('no_owner', `"${key}" has no owner in settings-sources.json`);
  if (owner.store.kind !== 'data-store') throw new S.SettingsSourceError('unreachable', `"${key}" lives in the browser: nothing to migrate from here`);
  const ownerDoc = await readJson(owner.file, null);
  const ownerValue = ownerDoc === null ? undefined : S.getAt(ownerDoc, owner.pointer);
  const holders = [{ store: owner.store.id, pointer: owner.pointer, file: owner.file, value: ownerValue, set: ownerValue !== undefined, at: docTime(ownerDoc, owner.file), owner: true }];
  for (const f of S.formerPlaces(key, { registry, env })) {
    if (f.store.kind !== 'data-store') continue;
    const doc = await readJson(f.file, null);
    const value = doc === null ? undefined : S.getAt(doc, f.pointer);
    holders.push({ store: f.store.id, pointer: f.pointer, file: f.file, value, set: value !== undefined, at: docTime(doc, f.file), owner: false });
  }
  const copies = holders.filter((h) => !h.owner && h.set);
  let pick;
  if (holders[0].set) pick = { store: owner.store.id, value: ownerValue, why: 'the owner holds a value: it wins' };
  else if (copies.length) { const newest = [...copies].sort((a, b) => b.at - a.at)[0]; pick = { store: newest.store, value: newest.value, why: `the owner is unset: the newest copy wins (${newest.store}, ${new Date(newest.at).toISOString()})` }; }
  else pick = { store: owner.store.id, value: undefined, why: 'no store holds a value: nothing to move' };
  const conflict = copies.some((h) => JSON.stringify(h.value) !== JSON.stringify(pick.value));
  return { key, owner: owner.store.id, pointer: owner.pointer, holders, pick, strip: copies.map((h) => h.store), conflict, noop: !copies.length && (holders[0].set || pick.value === undefined) };
}

/** Plan every key of the given keys / patterns. */
export async function plan(items, opts = {}) {
  const rows = [];
  for (const it of items) for (const key of await keysFor(it, opts)) rows.push(await planKey(key, opts));
  return rows;
}

/** Apply one planned row: owner written, copies stripped, journal entry appended. */
export async function applyRow(row, { registry = S.loadRegistry(), env = process.env, journal = JOURNAL_FILE, at = new Date().toISOString(), by = 'settings-migrate' } = {}) {
  const before = Object.fromEntries(row.holders.map((h) => [h.store, h.set ? h.value : null]));
  const after = {};
  if (row.pick.value !== undefined && (!row.holders[0].set || row.pick.store !== row.owner)) {
    await S.writeSetting(row.key, row.pick.value, { registry, env, store: row.owner });
  }
  after[row.owner] = row.pick.value === undefined ? null : row.pick.value;
  for (const h of row.holders) {
    if (h.owner || !h.set) continue;
    await updateJson(h.file, (doc) => S.deleteAt(doc, h.pointer), {});
    after[h.store] = null;
  }
  const entry = { at, by, key: row.key, owner: row.owner, pointer: row.pointer, pick: row.pick, before, after, stripped: row.strip, conflict: row.conflict, applied: true };
  await updateJson(journal, (doc) => ({ $axf: JOURNAL_FRAME, build: 'one-true-source-for-every-setting', entries: [...(isObj(doc) && Array.isArray(doc.entries) ? doc.entries : []), entry] }), { $axf: JOURNAL_FRAME, entries: [] });
  return entry;
}

/** Migrate: plan, then apply when `apply` is set. Returns { rows, applied: [entries] }. */
export async function migrate(items, { apply = false, ...opts } = {}) {
  const rows = await plan(items, opts);
  const applied = [];
  if (apply) for (const r of rows) if (!r.noop) applied.push(await applyRow(r, opts));
  return { rows, applied };
}

const line = (r) => `${r.noop ? '  ' : r.conflict ? '!!' : '->'} ${r.key.padEnd(44)} ${r.holders.map((h) => `${h.owner ? '*' : ''}${h.store}=${h.set ? JSON.stringify(h.value) : 'unset'}`).join('  ')}  → ${r.pick.value === undefined ? 'nothing' : JSON.stringify(r.pick.value)} (${r.pick.why})${r.strip.length ? `; strip from ${r.strip.join(', ')}` : ''}`;

export async function main(argv = process.argv.slice(2)) {
  const args = [...argv];
  const flag = (name) => { const i = args.indexOf(name); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
  const has = (name) => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };
  const json = has('--json'); const apply = has('--apply'); has('--dry-run'); const all = has('--all');
  const registryFile = flag('--registry'); const journal = flag('--journal') || JOURNAL_FILE;
  const registry = registryFile ? S.loadRegistry(resolve(registryFile)) : S.loadRegistry();
  const items = all ? patternsWithFormerly(registry) : args.filter((a) => !a.startsWith('--'));
  if (!items.length) { console.log('usage: settings-migrate.mjs <key-or-pattern>… | --all  [--dry-run | --apply] [--json] [--registry f] [--journal f]'); return 2; }
  const r = await migrate(items, { apply, registry, journal });
  if (json) console.log(JSON.stringify({ ok: true, applied: apply, rows: r.rows, journal: r.applied }, null, 1));
  else {
    console.log(r.rows.length ? r.rows.map(line).join('\n') : 'nothing holds these keys');
    const moving = r.rows.filter((x) => !x.noop).length;
    console.log(apply ? `applied ${r.applied.length} move(s); journal ${journal}` : `dry run: ${moving} move(s) would be made (--apply to make them)`);
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((c) => { process.exitCode = c; }, (e) => { console.error(e.message); process.exitCode = 1; });
}
