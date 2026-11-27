/**
 * data-store-migration@1: the console's data sources → data-store@1 keys, and the count + hash manifest check that
 * gates every namespace. Run through check-data-store.mjs (`--write` regenerates the `example` block).
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as D from '../core/data-store.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const FIX = join(ROOT, 'framework/spec/fixtures/data-store-migration.json');
const POLICIES = ['copy', 'journal', 'blob-sqlite', 'rebuild', 'skip'];
const COUNTS = ['files', 'lines', 'rows', 'none'];
/** A `to` template → one concrete key: placeholders and globs become plain segments. */
const sampleKey = (to) => to.replace(/<[^>]+>/g, 'x').replace(/\{[^}]*\}/g, 'x').replace(/\*\*?/g, 'x').replace(/\s*\+.*$/, '').replace(/ \(.*$/, '');

/**
 * The worked example: a source folder (relative file → text) mapped onto a namespace, its M0 manifest, the target after a
 * faithful copy (M1 equal) and after a lost file (diff). Pure: the same numbers on every port.
 */
function example() {
  const files = {
    'plans/p1.json': '{ "title": "Plan one",\n  "status": "parked" }',
    'plans/p2.json': '{"status":"active","title":"Plan two"}',
    'categories.json': '["Apps", "Framework"]',
    'shipped-log.jsonl': '{"at":"2026-11-01T00:00:00Z","plan":"p1"}\n{"plan":"p2","at":"2026-11-02T00:00:00Z"}\n',
    'README.md': '# Plans\n',
  };
  const items = Object.entries(files).map(([rel, text]) => {
    const kind = D.kindOfFile(rel);
    if (kind === 'record') return { path: rel, kind, etag: D.etagOf(1, JSON.parse(text)), size: new TextEncoder().encode(D.canonical(JSON.parse(text))).length };
    if (kind === 'journal') { const lines = text.split('\n').filter(Boolean).map((l) => JSON.parse(l)); return { path: rel.replace(/\.jsonl$/, ''), kind, etag: D.journalEtag(lines), entries: lines.length, size: lines.reduce((n, l) => n + D.canonical(l).length + 1, 0) }; }
    return { path: rel, kind, etag: D.etagOf(1, new TextEncoder().encode(text)), size: new TextEncoder().encode(text).length };
  });
  const m0 = D.manifestOf(items);
  const reformatted = items.map((i) => (i.path === 'plans/p1.json' ? { ...i, etag: D.etagOf(1, { status: 'parked', title: 'Plan one' }) } : i));
  const lost = items.filter((i) => i.path !== 'plans/p2.json');
  const extraEntry = items.map((i) => (i.kind === 'journal' ? { ...i, etag: D.journalEtag([{ at: '2026-11-01T00:00:00Z', plan: 'p1' }, { plan: 'p2', at: '2026-11-02T00:00:00Z' }, { plan: 'p3' }]), entries: 3 } : i));
  return {
    sourceFiles: Object.keys(files),
    keys: items.map((i) => `planner/${i.path}`),
    m0,
    copied: D.sameManifest({ namespaces: { planner: m0 } }, { namespaces: { planner: D.manifestOf(reformatted) } }),
    lostFile: D.sameManifest({ namespaces: { planner: m0 } }, { namespaces: { planner: D.manifestOf(lost) } }),
    extraJournalEntry: D.sameManifest({ namespaces: { planner: m0 } }, { namespaces: { planner: D.manifestOf(extraEntry) } }),
  };
}

export async function checkMigration({ WRITE = false } = {}) {
  const fx = JSON.parse(readFileSync(FIX, 'utf8'));
  let n = 0;
  assert.equal(fx.$axf, 'data-store-migration@1'); n += 1;
  const ids = new Set(), froms = new Set(), used = new Set();
  for (const s of fx.sources) {
    assert.ok(s.id && !ids.has(s.id), `duplicate or missing source id ${s.id}`); ids.add(s.id);
    assert.ok(s.from && !froms.has(s.from), `duplicate or missing from ${s.from}`); froms.add(s.from);
    assert.ok(POLICIES.includes(s.policy), `${s.id}: policy ${s.policy}`);
    assert.ok(COUNTS.includes(s.count), `${s.id}: count ${s.count}`);
    assert.ok(Array.isArray(s.writers) && s.writers.length, `${s.id}: writers`);
    const key = D.parseKey(sampleKey(s.to));
    assert.equal(key.ns, s.ns, `${s.id}: key ${s.to} is not in ${s.ns}`);
    used.add(s.ns);
    const kinds = s.kind === 'by-file' ? ['record', 'blob', 'journal'] : [s.kind];
    for (const k of kinds) assert.ok(D.NAMESPACES[s.ns].kinds.includes(k), `${s.id}: ${s.ns} does not hold ${k}s`);
    if (s.policy === 'journal') assert.equal(s.kind, 'journal', `${s.id}: journal policy needs kind journal`);
    if (s.policy === 'blob-sqlite') { assert.equal(s.kind, 'blob'); assert.ok(Array.isArray(s.tables) && s.tables.length, `${s.id}: tables`); assert.equal(s.count, 'rows'); }
    if (s.policy === 'rebuild') assert.equal(s.count, 'none', `${s.id}: a rebuilt source has no count check`);
    if (s.policy === 'copy' || s.policy === 'journal') assert.notEqual(s.count, 'none', `${s.id}: a copied source needs a count check`);
    if (s.ns === 'plugins') assert.ok(/^plugins\/<folder>\//.test(s.to) || /^plugins\/[a-z0-9-]+\//.test(s.to), `${s.id}: plugin keys carry the folder`);
    n += 1;
  }
  for (const ns of fx.order) { assert.ok(D.NAMESPACES[ns], `order names unknown namespace ${ns}`); assert.ok(used.has(ns), `order names ${ns} but no source maps to it`); }
  for (const ns of used) assert.ok(fx.order.includes(ns), `${ns} has sources but no place in order`);
  assert.ok(!fx.order.includes('_meta')); n += 1;
  for (const e of fx.excluded) { assert.equal(e.policy, 'skip'); assert.ok(e.from && e.why); }
  n += 1;
  for (const k of ['where', 'rev', 'equal', 'unparseable', 'large']) assert.ok(fx.manifest[k], `manifest.${k}`);
  for (const k of ['duringCopy', 'inShadow', 'afterCutover', 'never']) assert.ok(fx.rollback[k], `rollback.${k}`);
  n += 1;
  // the ui-review folder is its own namespace, every other plugin folder goes under plugins/
  assert.equal(D.pluginKey('ui-review', 'items.json'), 'ui-review/items.json');
  assert.equal(D.pluginKey('shipped-features', 'ledger.sqlite'), 'plugins/shipped-features/ledger.sqlite');
  assert.ok(fx.sources.some((s) => s.to === 'ui-review/items.json') && !fx.sources.some((s) => s.to.startsWith('plugins/ui-review/')));
  for (const [ext, kind] of Object.entries(fx.fileKinds)) if (ext !== '*') assert.equal(D.kindOfFile(`a${ext}`), kind);
  assert.equal(D.kindOfFile('shot.png'), fx.fileKinds['*']);
  n += 1;
  const ex = example();
  assert.ok(ex.copied.equal, 'a faithful copy (even reformatted JSON) has an equal manifest');
  assert.ok(!ex.lostFile.equal && ex.lostFile.diffs[0].a.count === ex.lostFile.diffs[0].b.count + 1, 'a lost file shows in count and hash');
  assert.ok(!ex.extraJournalEntry.equal && ex.extraJournalEntry.diffs[0].a.count === ex.extraJournalEntry.diffs[0].b.count, 'an extra journal entry shows in the hash with the same count');
  if (WRITE) { fx.example = ex; writeFileSync(FIX, `${JSON.stringify(fx, null, 2)}\n`); }
  else assert.deepEqual(fx.example, JSON.parse(JSON.stringify(ex)), 'migration example drifted (run --write)');
  n += 1;
  return n;
}
