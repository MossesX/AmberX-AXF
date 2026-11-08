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



/* ---------------- demonstrations, books, clips, docs (demos.mjs + docs.mjs on the scratch store) ---------------- */

const demos = await import('./demos.mjs');
const docs = await import('./docs.mjs');

ok('the four demo kinds are glossary kinds with the framework starters indexed', () => {
  for (const k of ['demonstration', 'book', 'clip', 'docs']) assert.ok(built.counts[k] >= 1, `kind ${k}`);
  assert.ok(byId.has('demonstration:what-is-an-asset') && byId.has('book:getting-started') && byId.has('clip:what-is-an-asset-clip') && byId.has('docs:getting-started-docs'));
  const book = byId.get('book:getting-started') as { related: string[]; category: string };
  assert.equal(book.category, 'Demos › Books');
  assert.ok(book.related.includes('demonstration:what-is-an-asset') && book.related.includes('concept:asset'), 'a book links to what it holds');
});

ok('a demonstration is generated from any entry, saved, indexed and plays as walkthrough@1', () => {
  const a = demos.generate('plugin:ui-review', { save: true, build: 'test' });
  assert.equal(a.type, 'demonstration');
  assert.equal(a.data.about, 'plugin:ui-review');
  assert.ok(a.data.steps.length >= 3 && a.data.steps[0].do === 'nav:ui-review', 'the first step opens the plugin');
  assert.ok(a.data.keywords.length >= 10);
  const w = demos.walkthroughOf('demonstration', a.id);
  assert.equal(w.$axf, 'walkthrough@1');
  assert.equal(w.steps.length, a.data.steps.length);
  const fresh = cat.buildCatalog();
  assert.ok(fresh.entries.some((e: { id: string }) => e.id === `demonstration:${a.id}`), 'the saved demo is a glossary entry');
  assert.throws(() => demos.generate('nope:nothing'), /no glossary entry/);
});

ok('ui-api@1: the API does everything the Demonstration Designer editor does (new, set, steps, chain, find)', () => {
  const a = demos.newDemo({ name: 'Parity tour' });
  assert.equal(a.id, 'parity-tour'); assert.equal(a.data.steps.length, 1);
  assert.equal(demos.newDemo({ name: 'Parity tour' }).id, 'parity-tour-2', 'a taken id gets -2, never overwrites');
  let d = demos.changeDemo(a.id, { op: 'add-step', step: { say: 'Second', do: 'nav:builds', wait: 99999 } });
  assert.deepEqual(d.data.steps.map((s: { say: string }) => s.say), ['Say what this step shows.', 'Second']);
  assert.equal(d.data.steps[1].wait, 30000, 'wait is clamped like the editor clamps it');
  d = demos.changeDemo(a.id, { op: 'move-step', index: 1, dir: -1 });
  assert.equal(d.data.steps[0].say, 'Second');
  d = demos.changeDemo(a.id, { op: 'set-step', index: 1, step: { say: 'First no more', highlight: 'Here' } });
  assert.equal(d.data.steps[1].highlight, 'Here');
  d = demos.changeDemo(a.id, { op: 'set', name: 'Parity tour!', speed: 1.25, surface: 'preview', about: 'plugin:ui-review' });
  assert.equal(d.name, 'Parity tour!'); assert.equal(d.data.voice.speed, 1.25); assert.equal(d.data.surface, 'preview'); assert.ok(d.data.entries.includes('plugin:ui-review'));
  d = demos.changeDemo(a.id, { op: 'chain-add', id: 'parity-tour-2' });
  assert.deepEqual(d.data.chain, ['parity-tour-2']);
  assert.throws(() => demos.changeDemo(a.id, { op: 'chain-add', id: a.id }), /cannot chain itself/);
  d = demos.changeDemo(a.id, { op: 'chain-remove', id: 'parity-tour-2' });
  assert.deepEqual(d.data.chain, []);
  d = demos.changeDemo(a.id, { op: 'remove-step', index: 0 });
  assert.equal(d.data.steps.length, 1);
  assert.throws(() => demos.changeDemo(a.id, { op: 'remove-step', index: 0 }), /at least one step/);
  assert.throws(() => demos.changeDemo(a.id, { op: 'set-step', index: 7, step: {} }), /no step 7/);
  assert.throws(() => demos.changeDemo(a.id, { op: 'explode' }), /unknown demonstration change/);
  assert.ok(demos.find('demonstration', { q: 'parity' }).some((s: { id: string }) => s.id === a.id), 'find = the designer search');
  assert.ok(demos.find('demonstration', { generated: true }).every((s: { generated: string }) => s.generated === 'glossary'), 'find generated = Only generated');
});

ok('ui-api@1: every control of the Demonstration Designer and the Book Builder maps to a real op (plugin.json ui)', () => {
  const pj = JSON.parse(readFileSync(new URL('./plugin.json', import.meta.url), 'utf8'));
  const ids = new Set(pj.commands.items.map((c: { id: string }) => c.id));
  for (const id of ['demo-new', 'demo-change']) assert.ok(ids.has(id), `${id} is a command (REST, MCP, CLI)`);
  assert.equal(pj.ui.$axf, 'ui-api@1');
  for (const v of ['demo-designer', 'book-builder']) assert.ok(Object.keys(pj.ui.views[v].actions).length > 30 && pj.ui.views[v].state.length >= 4, v);
});

ok('a book comes out of the wizard, takes items, moves them and previews as one walkthrough', () => {
  const b = demos.newBook({ title: 'Test book', totalMinutes: 9, chapterMinutes: 3, docs: { enabled: true, depth: 'deep', format: 'interactive-html-ts', interactive: 'examples' } });
  assert.equal(b.data.chapters.length, 3);
  let n = demos.changeBook(b.id, { op: 'add-item', chapter: 'chapter-1', ref: 'concept:asset' });
  n = demos.changeBook(b.id, { op: 'add-item', chapter: 'chapter-1', ref: 'demonstration/demo-plugin-ui-review' });
  n = demos.changeBook(b.id, { op: 'move-item', from: { chapter: 'chapter-1', index: 1 }, to: { chapter: 'chapter-2', index: 0 } });
  assert.deepEqual(n.data.chapters.map((c: { items: { ref: string }[] }) => c.items.map((i) => i.ref)), [['concept:asset'], ['demonstration/demo-plugin-ui-review'], []]);
  n = demos.changeBook(b.id, { op: 'add-chapter', title: 'Extra' });
  assert.equal(n.data.chapters.length, 4);
  assert.throws(() => demos.changeBook(b.id, { op: 'add-item', chapter: 'chapter-1', ref: 'not a ref' }), /not a glossary entry id/);
  const w = demos.walkthroughOf('book', b.id);
  assert.ok(w.steps.length > 4 && w.steps[0].say.startsWith('Chapter'), 'chapter intro first');
  const o = demos.outline(b.id);
  assert.equal(o[0].children.length, 4);
  assert.equal(o[0].children[0].children[0].label, 'Asset (asset@1)', 'items are labelled through the glossary');
  const r = demos.recordBook(b.id, { dryRun: true });
  assert.ok(existsSync(r.file), 'the walkthrough is written for the recorder');
});

ok('a clip from a filmed demonstration carries its transcript, entries and a large keyword set', () => {
  const c = demos.clipFromDemo('demo-plugin-ui-review', { video: 'clips/x.mp4', seconds: 30 });
  assert.equal(c.type, 'clip');
  assert.equal(c.data.source.id, 'demo-plugin-ui-review');
  assert.ok(c.data.transcript.length >= 3 && c.data.keywords.length >= 30, `${c.data.keywords.length} keywords`);
  assert.ok(c.data.keywords.includes('ui-review') && c.data.keywords.includes('review'));
  const fresh = cat.buildCatalog();
  const e = fresh.entries.find((x: { id: string }) => x.id === `clip:${c.id}`) as { related: string[] };
  assert.ok(e && e.related.includes('demonstration:demo-plugin-ui-review'), 'the clip links to its demonstration');
});

ok('documentation is generated at every depth and format, exactly the planned files', () => {
  const light = docs.generateDocs({ source: { kind: 'book', id: 'test-book' }, options: { depth: 'light', format: 'markdown' } });
  assert.deepEqual(light.data.files.map((f: { path: string }) => f.path), ['index.md']);
  const deep = docs.generateDocs({ source: { kind: 'book', id: 'test-book' }, options: { depth: 'deep', format: 'interactive-html-ts', interactive: 'examples' }, tokens: { '--fx-bg': '#123' } });
  const paths = deep.data.files.map((f: { path: string }) => f.path);
  for (const p of ['index.html', 'chapters/chapter-1.html', 'items/concept-asset.html', 'docs.css', 'docs.ts', 'docs.js', 'data/book.json', 'data/examples.json', 'data/tokens.css']) assert.ok(paths.includes(p), p);
  const html = readFileSync(join(docs.DOCS_OUT, deep.id, 'items/concept-asset.html'), 'utf8');
  assert.ok(html.includes('data-root="../"') && html.includes('docs.js') && !html.includes('<script>alert'), 'relative root + runtime');
  assert.ok(readFileSync(join(docs.DOCS_OUT, deep.id, 'data/tokens.css'), 'utf8').includes('--fx-bg: #123'), 'the live tokens are written');
  const js = readFileSync(join(docs.DOCS_OUT, deep.id, 'docs.js'), 'utf8');
  assert.ok(!/interface |: string\b/.test(js) && js.includes('installSearch'), 'the TypeScript runtime compiled to JavaScript');
  const extreme = docs.generateDocs({ source: { kind: 'demonstration', id: 'demo-plugin-ui-review' }, options: { depth: 'extreme', format: 'interactive-html-ts', interactive: 'live' } });
  const xp = extreme.data.files.map((f: { path: string }) => f.path);
  assert.ok(xp.includes('live.js') && xp.includes('data/search.json'), 'extreme live = live frames + search');
  assert.ok(readFileSync(join(docs.DOCS_OUT, extreme.id, 'items/plugin-ui-review.html'), 'utf8').includes('data-live-view="ui-review"'), 'the live frame names the view');
  assert.equal(extreme.data.sourceHash.length, 16);
  assert.ok(cat.buildCatalog().entries.some((e: { id: string }) => e.id === `docs:${deep.id}`), 'docs are glossary entries');
});

ok('the build hook rebuilds the catalog for build events and ignores the rest', async () => {
  const hook = (await import('./build-hooks.mjs')).default;
  const none = await hook([{ event: 'note', build: { id: 'x' } }]);
  assert.equal(none.rebuilt, false);
  const r = await hook([{ event: 'step-done', build: { id: 'glossary-index-demos' } }, { event: 'pr-merged', build: { id: 'other' } }]);
  assert.deepEqual(r.builds, ['glossary-index-demos', 'other']);
  const log = JSON.parse(readFileSync(cat.CHANGES_FILE, 'utf8'));
  assert.ok(log.some((l: { build: string }) => String(l.build).includes('glossary-index-demos')) || r.rebuilt === false, 'the change log names the build when something moved');
});

ok('every demo command in plugin.json has a route in the server part', () => {
  const pj = JSON.parse(readFileSync(join(cat.ROOT, 'apps/console-web/plugins/glossary-index/plugin.json'), 'utf8'));
  const py = readFileSync(join(cat.ROOT, 'apps/console-web/plugins/glossary-index/server/__init__.py'), 'utf8');
  for (const c of pj.commands.items) {
    const [method, path] = c.route.split(' ');
    assert.ok(new RegExp(`@router\\.${method.toLowerCase()}\\("${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`).test(py), `${c.id}: ${c.route}`);
    assert.ok(c.description && c.description.length > 40, `${c.id} described`);
  }
});

console.log(`glossary demos: store, generator, books, clips, docs and hook checked`);
