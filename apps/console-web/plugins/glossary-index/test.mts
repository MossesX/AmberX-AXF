// @ts-nocheck: a Node test, not part of the console's build
/**
 * Self-test for the Glossary & Index plugin: the catalog built from the real repo, the completeness check, search
 * ranking, the change log, and the page's pure model (filter, sort, letters, index tree).
 *
 *   npx -y tsx apps/console-web/plugins/glossary-index/test.mts
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const scratch = mkdtempSync(join(tmpdir(), 'axf-glossary-test-'));
process.env.AXF_GLOSSARY_DIR = scratch;
const cat = await import('./catalog.mjs');
const core = await import('./web/core.ts');

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log(`  ✓ ${name}`); };

const built = cat.buildCatalog();
const byId = new Map(built.entries.map((e: { id: string }) => [e.id, e]));

ok('every console plugin folder has a plugin entry', () => {
  const dir = join(cat.ROOT, 'apps/console-web/plugins');
  for (const f of readdirSync(dir).filter((x) => !x.startsWith('_') && !x.startsWith('.'))) {
    if (existsSync(join(dir, f, 'plugin.json'))) assert.ok(byId.has(`plugin:${f}`), `plugin:${f}`);
  }
});

ok('every asset type and every kind of source is in the catalog', () => {
  const types = JSON.parse(readFileSync(join(cat.ROOT, 'framework/schemas/asset-types.json'), 'utf8')).types;
  for (const t of Object.keys(types)) assert.ok(byId.has(`asset-type:${t}`), t);
  for (const k of ['concept', 'plugin', 'feature', 'screen', 'control', 'setting', 'command', 'asset-type', 'asset', 'cli', 'build-option', 'job-type']) assert.ok(built.counts[k] > 0, `kind ${k}`);
  assert.ok(built.total > 2000, `total ${built.total}`);
});

ok('entries are well formed: id, term, kind, category, summary, keywords; ids unique', () => {
  const seen = new Set();
  for (const e of built.entries) {
    assert.ok(e.id && e.term && e.kind in cat.KINDS && e.category && e.summary, e.id);
    assert.ok(Array.isArray(e.keywords));
    assert.ok(!seen.has(e.id), `duplicate ${e.id}`);
    seen.add(e.id);
    for (const r of e.related ?? []) assert.ok(byId.has(r), `${e.id} → ${r}`);
  }
});

ok('every hand-written concept links only to entries that exist', () => {
  const terms = JSON.parse(readFileSync(cat.TERMS_FILE, 'utf8')).terms;
  for (const t of terms) for (const r of t.related ?? []) assert.ok(byId.has(r), `concept:${t.id} → ${r} does not exist`);
});

ok('plugins carry their API (REST, MCP, CLI) and list what they contain', () => {
  const p = byId.get('plugin:glossary-index') as { api: { kind: string; name: string }[]; children: string[] };
  assert.ok(p.api.some((a) => a.kind === 'mcp' && a.name === 'glossary_index_search'));
  assert.ok(p.api.some((a) => a.kind === 'rest' && a.name === 'GET /api/plugins/glossary-index/catalog'));
  assert.ok(p.children.includes('command:glossary-index:search'));
});

ok('completeness check passes on the repo and fails on a rise in undescribed items', () => {
  assert.deepEqual(cat.checkCatalog(built).errors, []);
  const r = cat.checkCatalog(built, { generic: built.generic - 1 });
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /no description of their own/);
});

ok('search ranks exact and leading term matches first; every word must match', () => {
  const hits = cat.search(built.entries, 'merge queue', 10);
  assert.equal(hits[0].id, 'concept:merge-queue');
  assert.equal(cat.search(built.entries, 'merge zzzqqq', 10).length, 0);
});

ok('writeCatalog writes once, records what changed, and is idempotent', () => {
  const a = cat.writeCatalog({ reason: 'test', build: 'glossary-index-demos' });
  assert.equal(a.wrote, true);
  assert.equal(a.diff.added.length, a.catalog.total);
  const b = cat.writeCatalog({ reason: 'test again' });
  assert.equal(b.wrote, false);
  const log = JSON.parse(readFileSync(cat.CHANGES_FILE, 'utf8'));
  assert.equal(log.length, 1);
  assert.equal(log[0].build, 'glossary-index-demos');
  const d = cat.diffCatalogs({ entries: [{ id: 'a', term: 'A' }, { id: 'b' }] }, { entries: [{ id: 'a', term: 'A2' }, { id: 'c' }] });
  assert.deepEqual(d, { added: ['c'], removed: ['b'], changed: ['a'] });
});

ok('keywords drop stop words and keep ids like asset@1', () => {
  const k = cat.keywordsFor('The asset@1 format', 'and every hot-swap');
  assert.ok(k.includes('asset@1') && k.includes('hot-swap') && !k.includes('the') && !k.includes('every'));
});

// ---------------- the page's model ----------------
const entries = built.entries as import('./web/core.ts').Entry[];

ok('filter: kind, drafts, undescribed, words', () => {
  const plugins = core.filterEntries(entries, { q: '', kind: 'plugin', drafts: true });
  assert.ok(plugins.length > 30 && plugins.every((e) => e.kind === 'plugin'));
  assert.ok(core.filterEntries(entries, { q: '', kind: '', drafts: false }).every((e) => !e.draft));
  assert.ok(core.filterEntries(entries, { q: '', kind: '', drafts: true, undescribed: true }).every((e) => e.generic));
  assert.equal(core.filterEntries(entries, { q: 'merge queue', kind: '', drafts: true })[0].id, 'concept:merge-queue');
});

ok('sort and letters: A–Z, Z–A, # last', () => {
  const az = core.sortEntries(entries.slice(0, 200), 'az', built.kinds);
  for (let i = 1; i < az.length; i++) assert.ok(az[i - 1].term.localeCompare(az[i].term, 'en', { sensitivity: 'base' }) <= 0);
  assert.equal(core.letterOf('--wrap-groups'), 'W');
  assert.equal(core.letterOf('3D view'), '#');
  const groups = core.byLetter([{ term: 'b' }, { term: '1x' }, { term: 'a' }] as never);
  assert.deepEqual(groups.map((g) => g.letter), ['A', 'B', '#']);
});

ok('index tree: categories nest on ›, counts add up', () => {
  const tree = core.indexTree(entries);
  const total = tree.reduce((s, t) => s + t.count, 0);
  assert.equal(total, entries.length);
  const plugins = tree.find((t) => t.label === 'Plugins');
  assert.ok(plugins && plugins.children.length > 30);
});

ok('api groups: REST, MCP, command line in that order', () => {
  const g = core.apiGroups([{ kind: 'cli', name: 'x' }, { kind: 'rest', name: 'GET /a' }, { kind: 'mcp', name: 'm' }]);
  assert.deepEqual(g.map((x) => x.label), ['REST', 'MCP tool', 'Command line']);
});

console.log(`glossary: ${n} checks passed (${built.total} entries)`);
