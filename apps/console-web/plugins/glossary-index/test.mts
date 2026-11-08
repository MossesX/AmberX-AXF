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

/* ---------------- glossary walkthroughs (investor demos): request → brief → chain → saved, versioned, playable ---------------- */

const W = await import('./walkthrough-rules.mjs');
const walks = await import('./walkthroughs.mjs');
const pick = await import('./web/walkthrough-pick.ts');
const SAMPLE = ['concept:orchestrator', 'plugin:build-orchestrator', 'concept:priority-tag'];
const PROMPT = 'Run a chain to demonstrate and explain these features.';

ok('walkthrough request: defaults, de-duplicated terms, errors named', () => {
  const r = W.normalizeRequest({ terms: [SAMPLE[0], SAMPLE[0], SAMPLE[1]], prompt: PROMPT, extra: 1 });
  assert.deepEqual(r.terms, SAMPLE.slice(0, 2));
  assert.equal(r.audience, 'investors'); assert.equal(r.depth, 'standard'); assert.equal(r.tryIt, true); assert.equal(r.$axf, 'glossary-walkthrough-request@1');
  assert.equal((r as Record<string, unknown>).extra, undefined);
  assert.ok(W.requestErrors({ terms: [] }).some((e: string) => /at least one/.test(e)));
  assert.ok(W.requestErrors({ terms: ['nope'] }).some((e: string) => /not glossary entry ids/.test(e)));
  assert.ok(W.requestErrors({ terms: SAMPLE, audience: 'aliens' }).some((e: string) => /audience/.test(e)));
  assert.deepEqual(W.requestErrors({ terms: SAMPLE, prompt: PROMPT }), []);
});

ok('picker: kind, category, picked only, select all with the cap, order moves', () => {
  const concepts = pick.pickerEntries(entries, { q: '', kind: 'concept', category: '', selectedOnly: false }, []);
  assert.ok(concepts.length > 5 && concepts.every((e: { kind: string }) => e.kind === 'concept'));
  const top = pick.topCategories(entries);
  assert.ok(top.length > 3 && top.every((c: { count: number }) => c.count > 0));
  const inCat = pick.pickerEntries(entries, { q: '', kind: '', category: top[0].value, selectedOnly: false }, []);
  assert.ok(inCat.every((e: { category: string }) => e.category.split('›')[0].trim() === top[0].value));
  assert.deepEqual(pick.pickerEntries(entries, { q: '', kind: '', category: '', selectedOnly: true }, SAMPLE).map((e: { id: string }) => e.id).sort(), [...SAMPLE].sort());
  const r = pick.selectAll([], entries.slice(0, 70).map((e: { id: string }) => e.id));
  assert.equal(r.selected.length, pick.MAX_TERMS); assert.equal(r.skipped, 70 - pick.MAX_TERMS);
  assert.deepEqual(pick.moveTerm(['a', 'b', 'c'], 2, -1), ['a', 'c', 'b']);
  assert.deepEqual(pick.toggleTerm(['a'], 'a', false), []);
});

const planned = walks.plan({ terms: SAMPLE, prompt: PROMPT, title: 'Build pipeline tour' });

ok('brief: the prompt word for word, every feature with its summary, the answer format', () => {
  assert.equal(planned.id, 'build-pipeline-tour');
  assert.ok(planned.brief.includes(`> ${PROMPT}`));
  for (const id of SAMPLE) assert.ok(planned.brief.includes(id), id);
  assert.ok(planned.brief.includes('"steps"'));
  assert.equal(planned.features.length, 3);
  const msg = planned.features[1].prompt.messages[0].content as string;
  assert.ok(msg.includes('nav:build-orchestrator') && msg.includes(PROMPT));
  assert.match(planned.features[1].prompt.system, /ONE JSON object/);
});

ok('chain replies: fenced JSON parsed, invented screens dropped, junk falls back', () => {
  const t = planned.features[1].template;
  const reply = W.parseFeatureReply('Sure!\n```json\n{"headline":"Every build in bite-size steps","points":["Steps of 30 minutes or less"],"steps":[{"kind":"show","title":"Open it","say":"This is the orchestrator.","do":"nav:build-orchestrator","target":""},{"kind":"show","say":"Invented.","do":"nav:made-up","target":"#nothing"},{"kind":"try","title":"Try it","say":"Open it yourself.","do":"nav:build-orchestrator"}]}\n```', { template: t });
  assert.equal(reply.ok, true); assert.equal(reply.steps.length, 3);
  assert.equal(reply.steps[1].do, ''); assert.equal(reply.steps[1].target, '');
  assert.equal(reply.steps[2].kind, 'try');
  assert.equal(W.parseFeatureReply('no json here', { template: t }).ok, false);
  assert.equal(W.parseFeatureReply('{"steps":[]}', { template: t }).ok, false);
});

let v1: Record<string, any>;
ok('assemble: one part by Claude, the rest by template, saved as 1.0.0 with demos + book assets', () => {
  const replies = { 'plugin:build-orchestrator': '{"headline":"Every build in bite-size steps","points":["Steps of 30 minutes or less, each on Fable or Opus"],"steps":[{"kind":"show","title":"Open it","say":"This is the build orchestrator.","do":"nav:build-orchestrator"},{"kind":"try","title":"Try it","say":"Open it yourself.","do":"nav:build-orchestrator"}]}' };
  v1 = walks.assemble({ terms: SAMPLE, prompt: PROMPT, title: 'Build pipeline tour', mode: 'claude' }, replies, { model: 'claude-opus-5-5' });
  assert.deepEqual(W.bundleErrors(v1), []);
  assert.equal(v1.version, '1.0.0');
  assert.deepEqual(v1.features.map((f: { source: string }) => f.source), ['template', 'claude', 'template']);
  assert.equal(v1.generator.mode, 'claude'); assert.equal(v1.generator.model, 'claude-opus-5-5');
  assert.equal(v1.generator.chain[0].error, 'no reply');
  for (const f of v1.features) { assert.equal(f.steps.at(-1).kind, 'try', `${f.term} ends with try it`); assert.ok(f.docs.headline && f.docs.summary, `${f.term} docs`); }
  assert.ok(!v1.features[0].docs.related.some((x: { id: string }) => x.id.startsWith('demonstration:')), 'related never names generated demos');
  assert.equal(v1.request.prompt, PROMPT);
  for (const f of v1.features) assert.equal(demos.get('demonstration', f.demonstration)?.data.about, f.entry);
  const book = demos.get('book', 'build-pipeline-tour');
  assert.equal(book.data.plan.style, 'tour'); assert.equal(book.data.chapters.length, 3);
  assert.ok(walks.list().some((w: { id: string }) => w.id === 'build-pipeline-tour'));
});

ok('versions: regenerate bumps, diff says what changed, restore saves a new version, stale demos go', () => {
  const v2 = walks.assemble({ terms: SAMPLE.slice(0, 2), prompt: PROMPT, title: 'Build pipeline tour', mode: 'template' }, {});
  assert.equal(v2.version, '1.1.0'); assert.equal(v2.createdAt, v1.createdAt);
  assert.equal(demos.get('demonstration', 'build-pipeline-tour-f3'), null, 'the third part demo is gone');
  const vs = walks.versions('build-pipeline-tour');
  assert.deepEqual(vs.map((v: { version: string }) => v.version), ['1.1.0', '1.0.0']);
  assert.deepEqual(vs[0].diff.removed, ['Priority tag']);
  assert.ok(vs[0].diff.changed.includes('Build orchestrator'), 'the part Claude wrote changed back to the template');
  const v3 = walks.restore('build-pipeline-tour', '1.0.0');
  assert.equal(v3.version, '1.2.0'); assert.equal(v3.features.length, 3);
  assert.equal(v3.history[0].note, 'Restored 1.0.0'); assert.equal(v3.history.length, 3);
  assert.equal(walks.get('build-pipeline-tour', '1.0.0').version, '1.0.0');
});

ok('player model: flat steps with intro / outro, part starts, try-it hit test, walkthrough@1', () => {
  const b = walks.current('build-pipeline-tour');
  const steps = W.playSteps(b);
  assert.equal(steps[0].feature, -1); assert.equal(steps.at(-1).feature, -1);
  assert.equal(steps.length, 2 + b.features.reduce((n: number, f: { steps: unknown[] }) => n + f.steps.length, 0));
  const starts = W.featureStarts(b);
  assert.equal(starts.length, 3); assert.equal(starts[0], 1); assert.equal(steps[starts[1]].feature, 1);
  const tryStep = { kind: 'try', target: 'approve', say: 'x' };
  const closest = (el: { sel: string }, sel: string) => el.sel === sel;
  assert.equal(W.tryHit(tryStep, { sel: '[data-axf-id="approve"]' }, (t: string) => [`[data-axf-id="${t}"]`], closest), true);
  assert.equal(W.tryHit(tryStep, { sel: '#other' }, (t: string) => [`[data-axf-id="${t}"]`], closest), false);
  assert.equal(W.tryHit({ ...tryStep, kind: 'show' }, { sel: '[data-axf-id="approve"]' }, (t: string) => [`[data-axf-id="${t}"]`], closest), false);
  const wt = W.bundleToWalkthrough(b);
  assert.equal(wt.$axf, 'walkthrough@1'); assert.equal(wt.steps.length, steps.length);
  assert.equal(W.safeSrc('walkthroughs/demo.walkthrough.json'), 'walkthroughs/demo.walkthrough.json');
  for (const bad of ['https://evil.example/x.json', '//evil/x.json', '../x.json', 'a/../../x.json', 'x.js']) assert.equal(W.safeSrc(bad), '', bad);
});

ok('export → import: the sandbox file carries the walkthrough, its demos and book', () => {
  const x = walks.exportBundle('build-pipeline-tour');
  assert.equal(x.$axf, 'glossary-walkthrough-export@1');
  assert.equal(x.assets.length, 4);
  assert.ok(walks.remove('build-pipeline-tour'));
  assert.equal(walks.current('build-pipeline-tour'), null);
  assert.equal(demos.get('demonstration', 'build-pipeline-tour-f1'), null);
  const back = walks.importBundle(JSON.parse(JSON.stringify(x)));
  assert.equal(back.version, '1.2.0'); assert.equal(back.features.length, 3);
  assert.equal(demos.get('demonstration', 'build-pipeline-tour-f2')?.data.steps[0].say, 'This is the build orchestrator.');
  assert.throws(() => walks.importBundle({ $axf: 'glossary-walkthrough@1', id: 'x' }), /version|feature/);
});

console.log(`glossary walkthroughs: request, picker, brief, chain replies, versions, player model, export/import checked (${n} checks in all)`);

ok('the shipped sample (investor-tour, written by Claude ahead of time) validates, plays and imports', () => {
  const sample = JSON.parse(readFileSync(join(cat.ROOT, 'apps/console-web/plugins/glossary-index/samples/investor-tour.walkthrough.json'), 'utf8'));
  assert.equal(sample.$axf, 'glossary-walkthrough-export@1');
  assert.deepEqual(W.bundleErrors(sample.walkthrough), []);
  assert.ok(sample.walkthrough.features.every((f: { source: string }) => f.source === 'claude'));
  assert.ok(W.playSteps(sample.walkthrough).some((s: { kind: string; target: string }) => s.kind === 'try' && s.target), 'at least one try-it step on a real control');
  for (const f of sample.walkthrough.features) assert.ok(byId.has(f.entry), `${f.entry} is still in the glossary`);
  const back = walks.importBundle(sample);
  assert.equal(back.id, 'investor-tour'); assert.equal(demos.get('book', 'investor-tour')?.data.chapters.length, sample.walkthrough.features.length);
});
console.log(`glossary walkthroughs: shipped sample checked (${n} checks in all)`);
