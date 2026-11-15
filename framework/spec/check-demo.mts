/**
 * demonstration@1 / book@1 / clip@1 / docs@1 (core/engines/demo-rules.mjs): the four types are registered (types,
 * optional, late-optional, asset-types order, never rolled, never shared), the fixture replays (normalisers, errors, the
 * generator from a glossary entry, walkthrough conversion, the book planner, minutes, moves, outline, the clip tagger,
 * the docs plan), both validators give the same messages, every starter validates, and the schemas carry every field.
 * Kotlin twin deferred (PORTING.md).
 *   npx -y tsx framework/spec/check-demo.mts            (--write regenerates spec/fixtures/demo.json)
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { validateAsset } from '../core/validate';
import { ASSET_TYPES, OPTIONAL_TYPES } from '../core/types';
import * as R from '../core/engines/demo-rules.mjs';
import * as engine from '../cli/build-engine.mjs';

let n = 0;
const ok = (c: unknown, m: string) => { assert.ok(c, m); n++; };
const eq = (a: unknown, b: unknown, m: string) => { assert.deepEqual(a, b, m); n++; };
const root = new URL('../../', import.meta.url);
const read = (p: string) => JSON.parse(readFileSync(new URL(p, root), 'utf8'));

/* ---- registered everywhere ---- */
const spec = read('framework/schemas/asset-types.json');
for (const t of R.DEMO_TYPES) {
  ok(ASSET_TYPES.includes(t as never), `${t} is an asset type`);
  ok(OPTIONAL_TYPES.includes(t as never), `${t} is optional (older apps still validate)`);
  eq(spec.types[t].roll, { slot: false, asset: false }, `${t} is never rolled`);
  eq(spec.types[t].shared, false, `${t} is not baked into every app (data, not look)`);
  eq(spec.types[t].group, 'Demos', `${t} sits in the Demos group`);
}
eq(Object.keys(spec.types), [...ASSET_TYPES], 'asset-types.json lists the types in the TS order (Kotlin reads the same file)');
eq(Object.keys(spec.types).at(-1), 'uac-policy', 'uac-policy stays last');
eq(spec.types.demonstration.enums.surface, [...R.DEMO_ENUMS.surface], 'registry surface enum = the rules file');
eq(spec.types.clip.enums.kind, [...R.DEMO_ENUMS.clipKind], 'registry clip kind enum = the rules file');
eq(spec.types.docs.enums.depth, [...R.DEMO_ENUMS.docsDepth], 'registry depth enum = the rules file');
eq(spec.types.docs.enums.format, [...R.DEMO_ENUMS.docsFormat], 'registry format enum = the rules file');

/* ---- the contract: computed here, replayed from the fixture ---- */
const AT = '2026-11-07T12:00:00.000Z';
const entry = {
  id: 'control:console-web:ui-review:approve', term: 'Approve', kind: 'control', category: 'Plugins › UI Review › Controls', summary: 'Approves the item: its PR may be called ready.',
  detail: 'Approves the item: its PR may be called ready. The build that submitted it carries on and the screenshots stay in the group.', app: 'Dev Console', plugin: 'ui-review', where: ['Dev Console'],
  api: [{ kind: 'rest', name: 'POST /api/plugins/ui-review/decide' }, { kind: 'mcp', name: 'ui_review_decide' }, { kind: 'cli', name: 'axf ui-review decide' }],
  related: ['plugin:ui-review', 'control:console-web:ui-review:reject'], keywords: ['approve', 'review', 'pr'], tags: ['approve', 'button'],
};
const plugin = { id: 'plugin:ui-review', term: 'UI Review', kind: 'plugin', category: 'Plugins › UI Review', summary: 'Screenshots for approval.', where: ['view:ui-review', 'settings-tab:ui-review'], children: ['control:console-web:ui-review:approve', 'control:console-web:ui-review:reject'], api: [] };
const reject = { id: 'control:console-web:ui-review:reject', term: 'Reject', kind: 'control', category: 'Plugins › UI Review › Controls', summary: 'Rejects the item.' };
const catalog: Record<string, unknown> = { [entry.id]: entry, [plugin.id]: plugin, [reject.id]: reject };
const lookup = (id: string) => catalog[id] as never;

const goodDemo = { about: 'concept:asset', app: 'console', surface: 'live', steps: [{ say: 'Hello.', do: 'nav:home', target: 'home' }, { say: 'Bye.', wait: 500, highlight: 'Here' }], chain: ['other-demo'], generated: { from: 'manual' } };
const goodBook = { plan: { totalMinutes: 10, chapterMinutes: 4, style: 'tutorial' }, chapters: [{ id: 'a', title: 'A', minutes: 6, items: [{ ref: 'concept:asset' }, { ref: 'demonstration/what-is-an-asset', minutes: 2 }] }, { id: 'b', title: 'B', items: [{ ref: 'clip/x-clip' }, { ref: 'book/other#intro' }] }], docs: { enabled: true, depth: 'deep', format: 'interactive-html-ts', interactive: 'live' } };
const goodClip = { kind: 'demo', source: { kind: 'demonstration', id: 'what-is-an-asset' }, media: { video: 'clips/x.mp4', seconds: 12.5 }, recorded: { at: AT, app: 'console' }, transcript: [{ at: 0, say: 'Hi' }], entries: ['concept:asset'], keywords: ['a', 'b'] };
const goodDocs = { source: { kind: 'book', id: 'getting-started' }, depth: 'standard', format: 'html', interactive: 'none', files: [{ path: 'index.html', kind: 'index' }], generatedAt: AT };
const cases: Record<string, [string, unknown]> = {
  'demo-ok': ['demonstration', goodDemo],
  'demo-not-an-object': ['demonstration', 'nope'],
  'demo-no-steps': ['demonstration', { steps: [] }],
  'demo-bad-step': ['demonstration', { steps: [{ say: '', do: 'https://evil', target: '<img>', wait: -1 }] }],
  'demo-bad-rest': ['demonstration', { ...goodDemo, about: 'nope', surface: 'tv', chain: ['Bad Id'], generated: { from: 'ai' }, voice: { speed: 9 } }],
  'book-ok': ['book', goodBook],
  'book-not-an-object': ['book', 'nope'],
  'book-bad-plan': ['book', { plan: { totalMinutes: -1, chapterMinutes: 0, style: 'rant' }, chapters: 'x' }],
  'book-bad-chapters': ['book', { ...goodBook, chapters: [{ id: 'A', title: '' }, { id: 'a', title: 'x', items: [{ ref: 'what/is/this' }] }, { id: 'a', title: 'y' }] }],
  'book-docs-live-needs-ts': ['book', { ...goodBook, docs: { enabled: true, depth: 'deep', format: 'html', interactive: 'live' } }],
  'book-docs-markdown-no-examples': ['book', { ...goodBook, docs: { enabled: true, depth: 'light', format: 'markdown', interactive: 'examples' } }],
  'clip-ok': ['clip', goodClip],
  'clip-not-an-object': ['clip', 'nope'],
  'clip-bad': ['clip', { kind: 'gif', source: { kind: 'book' }, media: { video: '../x.mp4', seconds: -1 }, recorded: { at: 'yesterday' }, transcript: [{ say: 1 }], chain: ['Bad'] }],
  'docs-ok': ['docs', goodDocs],
  'docs-not-an-object': ['docs', 'nope'],
  'docs-bad': ['docs', { source: { kind: 'entries', entries: [] }, depth: 'huge', format: 'pdf', interactive: 'live', files: [{ path: '/etc/passwd', kind: 'index' }, { path: 'x.html', kind: 'thing' }], generatedAt: 'now' }],
  'other-type': ['button', { steps: [] }],
};
const generated = R.demonstrationFromEntry(entry as never, { lookup, at: AT, build: 'glossary-index-demos' });
const plainBook = R.normalizeBook(goodBook);
const computed = {
  defaults: { demonstration: R.normalizeDemonstration(null), book: R.normalizeBook(null), clip: R.normalizeClip(null), docs: R.normalizeDocs(null) },
  normalized: {
    demo: R.normalizeDemonstration(goodDemo),
    demoJunk: R.normalizeDemonstration({ about: 'x', steps: [{ say: ' Hi ', do: 'javascript:alert(1)', target: 'a{b}', wait: 99999999, title: 'T' }, { say: '' }, 'junk'], voice: { speed: 5 }, chain: ['ok-id', 'Bad'], extra: true }),
    book: plainBook,
    bookJunk: R.normalizeBook({ plan: { totalMinutes: 9999, chapterMinutes: 0, style: 'x', theme: 'Bad Theme' }, chapters: [{ id: 'a', title: 'A' }, { id: 'a', title: 'dup' }, { title: 'No id', items: [{ ref: 'bad ref' }, { ref: 'concept:asset', minutes: 3, note: 'n' }] }], docs: { enabled: true, interactive: 'live' } }),
    clip: R.normalizeClip(goodClip),
    docs: R.normalizeDocs(goodDocs),
    docsLive: R.normalizeDocs({ ...goodDocs, interactive: 'live' }),
  },
  errors: Object.fromEntries(Object.entries(cases).map(([k, [t, d]]) => [k, R.demoAssetErrors(t, d)])),
  generated,
  generatedPlugin: R.demonstrationFromEntry(plugin as never, { lookup, at: AT }),
  seconds: { demo: R.demonstrationSeconds(goodDemo), generated: R.demonstrationSeconds(generated.data), steps: R.stepsSeconds(goodDemo.steps) },
  walkthrough: R.demonstrationToWalkthrough({ id: 'what-is-an-asset', name: 'What is an asset?', data: goodDemo }),
  targets: { control: R.helpTargetOf(entry), screen: R.helpTargetOf({ id: 'screen:console-web:glossary-index:view:glossary-index', plugin: 'glossary-index' }), concept: R.helpTargetOf({ id: 'concept:asset' }), view: R.viewOf(entry, lookup), viewOwn: R.viewOf(plugin), viewScreen: R.viewOf({ id: 'screen:console-web:view:builds' }) },
  refs: { entry: R.parseRef('concept:asset'), demo: R.parseRef('demonstration/what-is-an-asset'), chapter: R.parseRef('book/getting-started#assets'), bad: R.parseRef('nope'), made: R.makeRef('book', 'b', 'c') },
  plan: { tenByFour: R.bookPlan({ totalMinutes: 10, chapterMinutes: 4 }), noTotal: R.bookPlan({}), count: R.bookPlan({ totalMinutes: 30, count: 4 }) },
  newBook: R.newBook({ title: 'My book', totalMinutes: 12, chapterMinutes: 4, style: 'tour', docs: { enabled: true, depth: 'extreme', format: 'interactive-html-ts', interactive: 'live' } }),
  minutes: R.bookMinutes(goodBook),
  moves: {
    item: R.moveItem(plainBook, { chapter: 'a', index: 0 }, { chapter: 'b', index: 1 }).chapters.map((c) => c.items.map((i) => i.ref)),
    itemOut: R.moveItem(plainBook, { chapter: 'a', index: 9 }, { chapter: 'b' }).chapters.map((c) => c.items.map((i) => i.ref)),
    chapter: R.moveChapter(plainBook, 1, 0).chapters.map((c) => c.id),
    add: R.addItem(plainBook, 'b', 'plugin:ui-review', 0).chapters[1].items.map((i) => i.ref),
    addDup: R.addItem(plainBook, 'a', 'concept:asset', 1).chapters[0].items.map((i) => i.ref),
  },
  outline: R.bookOutline([{ id: 'getting-started', name: 'Getting started', data: goodBook }], (ref) => (ref === 'concept:asset' ? { title: 'Asset (asset@1)' } : undefined)),
  bookWalkthrough: R.bookToWalkthrough({ id: 'getting-started', name: 'Getting started', data: goodBook }, (ref) => (ref === 'demonstration/what-is-an-asset' ? { title: 'Demo', steps: goodDemo.steps } : { title: ref })),
  clipFrom: R.clipFromDemonstration({ id: 'what-is-an-asset', name: 'What is an asset?', data: goodDemo }, { video: 'clips/what-is-an-asset.mp4' }, { at: AT, viewport: { width: 1920, height: 1080 } }, { entries: [entry as never] }),
  clipKeywords: R.clipKeywords({ kind: 'demo', source: { kind: 'demonstration', id: 'd' }, entries: [entry as never, plugin as never], steps: goodDemo.steps }),
  docsPlans: {
    light: R.docsPlan({ depth: 'light', format: 'markdown' }, goodBook.chapters),
    standard: R.docsPlan({ depth: 'standard', format: 'html' }, goodBook.chapters),
    deep: R.docsPlan({ depth: 'deep', format: 'interactive-html-ts', interactive: 'examples' }, goodBook.chapters),
    extreme: R.docsPlan({ depth: 'extreme', format: 'interactive-html-ts', interactive: 'live' }, goodBook.chapters),
  },
  keywords: R.autoKeywords(['The Build manager, a plugin: it shows every build.', ['axf', 'axf', 'a', '42', 'merge-queue']]),
  slugs: [R.slugify('What is an asset?'), R.slugify('--'), R.slugify('plugin:ui-review')],
};
const FX = 'framework/spec/fixtures/demo.json';
if (process.argv.includes('--write')) writeFileSync(new URL(FX, root), `${JSON.stringify({ $axf: 'fixture@1', about: 'demonstration@1 / book@1 / clip@1 / docs@1 rules (core/engines/demo-rules.mjs); regenerate: npx -y tsx framework/spec/check-demo.mts --write', at: AT, entry, cases, ...computed }, null, 1)}\n`);
const fx = read(FX);
for (const k of Object.keys(computed) as (keyof typeof computed)[]) eq(computed[k], fx[k], `fixture: ${k}`);

/* ---- what the contract promises ---- */
for (const k of ['demo-ok', 'book-ok', 'clip-ok', 'docs-ok', 'other-type']) eq(fx.errors[k], [], `${k} has no errors`);
ok(fx.errors['demo-no-steps'].length === 1 && /1 to 60 steps/.test(fx.errors['demo-no-steps'][0]), 'a demo needs steps');
ok(fx.errors['demo-bad-step'].length === 4, 'say, do (URL), target (< >) and wait are each named');
ok(fx.errors['demo-bad-rest'].length === 5, 'about, surface, chain, generated.from and voice.speed are each named');
ok(fx.errors['book-bad-plan'].length === 4, 'plan minutes, chapter minutes, style and the chapters list are named');
ok(fx.errors['book-bad-chapters'].length === 4, 'bad id, empty title, bad ref and a duplicate id are named');
ok(fx.errors['book-docs-live-needs-ts'].some((e: string) => /interactive-html-ts/.test(e)), 'live docs need the interactive HTML + TS format');
ok(fx.errors['book-docs-markdown-no-examples'].some((e: string) => /markdown/.test(e)), 'markdown docs cannot run examples');
ok(fx.errors['clip-bad'].length === 7, 'kind, source id, video path, seconds, recorded.at, transcript and chain are named');
ok(fx.errors['docs-bad'].length >= 6, 'source entries, depth, format, live-needs-ts, both files and generatedAt are named');
eq(fx.normalized.demoJunk.steps, [{ say: 'Hi', do: '', target: '', title: 'T', wait: 30000 }], 'junk steps: script dropped, bad target dropped, wait capped, empty step gone');
eq(fx.normalized.demoJunk.chain, ['ok-id'], 'bad chain ids dropped');
eq(fx.normalized.demoJunk.about, '', 'a bad about is dropped');
eq(fx.normalized.demo.entries, ['concept:asset'], 'the about entry is always covered');
eq(fx.normalized.bookJunk.chapters.map((c: { id: string }) => c.id), ['a', 'no-id'], 'duplicate chapter dropped, missing id slugged from the title');
eq(fx.normalized.bookJunk.chapters[1].items, [{ ref: 'concept:asset', minutes: 3, note: 'n' }], 'bad refs dropped, minutes and note kept');
eq(fx.normalized.bookJunk.plan.totalMinutes, 600, 'total minutes capped');
eq(fx.normalized.bookJunk.docs.format, 'interactive-html-ts', 'live interactivity pulls the format up to interactive HTML + TS');
eq(fx.normalized.docsLive.format, 'interactive-html-ts', 'same for a docs asset');
eq(fx.defaults.demonstration.surface, 'live', 'a demo runs on the live UI by default');
eq(fx.defaults.book.plan, { totalMinutes: 0, chapterMinutes: 5, style: 'tutorial', theme: '', narrator: '', speed: 1 }, 'book plan defaults');
eq(fx.defaults.book.docs.enabled, false, 'docs are off until the wizard ticks them');

// the generator
ok(fx.generated.id === 'demo-control-console-web-ui-review-approve' && fx.generated.name === 'Approve demonstration', 'generated id and name');
eq(fx.generated.data.about, entry.id, 'generated demo is about its entry');
eq(fx.generated.data.steps[0].do, 'nav:ui-review', 'the first step moves the console to the plugin\'s view (found through lookup)');
eq(fx.generated.data.steps[0].target, 'approve', 'and highlights the control\'s help target');
eq(fx.generated.data.steps.map((s: { title: string }) => s.title), ['Approve', 'What it does', 'Where', 'API', 'See also'], 'intro, detail, where, API and see-also steps');
ok(/REST.*MCP.*command line/.test(fx.generated.data.steps[3].say), 'the API step names REST, MCP and CLI');
ok(fx.generated.data.steps[4].say.includes('UI Review') && fx.generated.data.steps[4].say.includes('Reject'), 'see also names the related entries');
eq(fx.generated.data.generated, { from: 'glossary', at: AT, build: 'glossary-index-demos' }, 'where it was generated from');
ok(fx.generated.data.keywords.includes('approve') && fx.generated.data.keywords.includes('ui-review') && fx.generated.data.keywords.includes('demonstration') && fx.generated.data.keywords.length >= 12, 'auto-tagged keywords');
eq(fx.generatedPlugin.data.steps[0].do, 'nav:ui-review', 'a plugin entry opens its own view');
ok(fx.generatedPlugin.data.steps.some((s: { title: string }) => s.title === 'Contains'), 'a plugin lists what it contains');
ok(fx.seconds.demo > 2 && fx.seconds.generated > fx.seconds.demo, 'length estimates grow with the words');
eq(fx.walkthrough, { $axf: 'walkthrough@1', id: 'what-is-an-asset', title: 'What is an asset?', app: 'console', steps: [{ say: 'Hello.', do: 'nav:home', target: 'home' }, { say: 'Bye.', do: '', target: '' }], source: 'demonstration' }, 'walkthrough@1 shape Molly plays');
eq(fx.targets, { control: 'approve', screen: 'view:glossary-index', concept: '', view: 'ui-review', viewOwn: 'ui-review', viewScreen: 'builds' }, 'help targets and views');

// books
eq(fx.refs.chapter, { kind: 'book', id: 'getting-started', chapter: 'assets', ref: 'book/getting-started#assets' }, 'a chapter ref parses');
eq(fx.refs.bad, null, 'a bad ref is null');
eq(fx.plan.tenByFour, { count: 3, totalMinutes: 10, chapterMinutes: 4, minutes: [3, 3, 4] }, '10 minutes at 4 each = 3 chapters, the remainder on the last');
eq(fx.plan.noTotal.minutes, [5, 5, 5], 'no total = three chapters of the chapter length');
eq(fx.plan.count.minutes, [7, 7, 7, 9], 'a fixed count splits the total');
eq(fx.newBook.chapters.map((c: { id: string; minutes: number }) => [c.id, c.minutes]), [['chapter-1', 4], ['chapter-2', 4], ['chapter-3', 4]], 'the wizard makes the chapters');
eq(fx.newBook.docs, { enabled: true, depth: 'extreme', format: 'interactive-html-ts', interactive: 'live', includeApi: true, includeScreens: true }, 'the wizard keeps the docs options');
eq(fx.minutes.chapters.map((c: { minutes: number }) => c.minutes), [6, 4], 'an open chapter takes what is left of the total');
eq(fx.minutes.chapters[0].items.map((i: { minutes: number }) => i.minutes), [4, 2], 'items share the chapter minus the explicit ones');
eq(fx.moves.item, [['demonstration/what-is-an-asset'], ['clip/x-clip', 'concept:asset', 'book/other#intro']], 'an item moves between chapters');
eq(fx.moves.itemOut, [['concept:asset', 'demonstration/what-is-an-asset'], ['clip/x-clip', 'book/other#intro']], 'an out-of-range move changes nothing');
eq(fx.moves.chapter, ['b', 'a'], 'chapters reorder');
eq(fx.moves.add, ['plugin:ui-review', 'clip/x-clip', 'book/other#intro'], 'an item is added at an index');
eq(fx.moves.addDup, ['demonstration/what-is-an-asset', 'concept:asset'], 'adding a ref the chapter has moves it instead');
eq(fx.outline[0].children.map((c: { label: string; minutes: number; count: number }) => [c.label, c.minutes, c.count]), [['A', 6, 2], ['B', 4, 2]], 'the outline carries minutes and counts');
eq(fx.outline[0].children[0].children[0].label, 'Asset (asset@1)', 'items are labelled through resolve');
eq(fx.bookWalkthrough.steps.length, 1 + 2 + 1 + 1 + 1 + 1, 'a book previews as chapter intros + every item\'s steps');
eq(fx.bookWalkthrough.steps[0].say, 'Chapter: A.', 'a chapter without an intro gets one');

// clips
ok(fx.clipFrom.data.source.id === 'what-is-an-asset' && fx.clipFrom.data.media.video === 'clips/what-is-an-asset.mp4' && fx.clipFrom.data.media.seconds > 0, 'a clip from a demo keeps its source and media');
eq(fx.clipFrom.data.transcript.map((t: { say: string }) => t.say), ['Hello.', 'Bye.'], 'the transcript is one line per step');
ok(fx.clipFrom.data.transcript[1].at > 0, 'transcript times grow');
ok(fx.clipFrom.data.keywords.includes('approve') && fx.clipFrom.data.keywords.includes('ui-review') && fx.clipFrom.data.keywords.includes('nav') && fx.clipFrom.data.keywords.includes('home') && fx.clipFrom.data.keywords.length >= 15, 'a clip carries the large keyword set (entries, steps, actions)');
ok(fx.clipKeywords.includes('screenshots') && fx.clipKeywords.includes('plugins'), 'clip keywords reach into every entry\'s words');
eq(fx.clipFrom.data.entries, ['concept:asset'], 'the entries the demo covers');

// docs
eq(fx.docsPlans.light.files.map((f: { path: string }) => f.path), ['index.md'], 'light markdown = one page');
eq(fx.docsPlans.standard.files.map((f: { path: string }) => f.path), ['index.html', 'chapters/a.html', 'chapters/b.html', 'docs.css'], 'standard html = index + chapters + styles');
ok(fx.docsPlans.deep.files.some((f: { path: string }) => f.path === 'items/concept-asset.html') && fx.docsPlans.deep.files.some((f: { path: string }) => f.path === 'docs.ts') && fx.docsPlans.deep.files.some((f: { path: string }) => f.path === 'data/examples.json'), 'deep interactive = item pages + the TS runtime + examples');
ok(fx.docsPlans.extreme.files.some((f: { path: string }) => f.path === 'live.ts') && fx.docsPlans.extreme.files.some((f: { path: string }) => f.path === 'data/search.json'), 'extreme live = live components + search index');
ok(!fx.docsPlans.light.files.some((f: { kind: string }) => f.kind === 'style'), 'markdown ships no stylesheet');
ok(fx.keywords.includes('merge-queue') && !fx.keywords.includes('the') && !fx.keywords.includes('42') && fx.keywords.filter((k: string) => k === 'axf').length === 1, 'stop words and numbers out, dashes kept, deduped');
eq(fx.slugs, ['what-is-an-asset', 'item', 'plugin-ui-review'], 'slugs');
for (const k of Object.keys(R.DOCS_DEPTH_ABOUT)) ok(R.DEMO_ENUMS.docsDepth.includes(k as never), `depth ${k} is explained`);

/* ---- both validators agree ---- */
for (const [k, [t, d]] of Object.entries(cases)) {
  if (!R.DEMO_TYPES.includes(t) || k.endsWith('not-an-object')) continue; // junk data: each validator words it its own way
  const env = { $axf: 'asset@1', type: t, id: 'case-x', name: 'Case', version: '1.0.0', data: d };
  const core = validateAsset(env).errors;
  const be = engine.validateAsset(env).errors;
  for (const m of fx.errors[k]) { ok(core.some((e: string) => e.includes(m)), `core validator names "${m}" (${k})`); ok(be.some((e: string) => e.includes(m)), `build engine names "${m}" (${k})`); }
}

/* ---- starters ---- */
for (const t of R.DEMO_TYPES) {
  const dir = `framework/assets/${t}/`;
  const starters = readdirSync(new URL(dir, root)).filter((f) => f.endsWith('.json')).map((f) => read(`${dir}${f}`));
  ok(starters.length >= 1, `${t}: at least one starter`);
  for (const a of starters) {
    eq(validateAsset(a).errors, [], `${a.id}: core validator`);
    eq(engine.validateAsset(a).errors, [], `${a.id}: build engine`);
    ok(typeof a.description === 'string' && a.description.length > 40, `${a.id}: described (the glossary indexes it)`);
    eq(R.demoAssetErrors(t, R.normalizeDemoAsset(t, a.data)), [], `${a.id}: normalised data still validates`);
  }
}
const starterBook = read('framework/assets/book/getting-started.json');
ok(starterBook.data.chapters.some((c: { items: { ref: string }[] }) => c.items.some((i) => i.ref === 'demonstration/what-is-an-asset')), 'the starter book uses the starter demonstration');

/* ---- schemas ---- */
for (const t of R.DEMO_TYPES) {
  const schema = read(`framework/schemas/json/${t}.schema.json`);
  for (const k of Object.keys(R.demoSchemaProperties(t))) ok(schema.properties.data.properties[k], `${t} schema has ${k}`);
}

console.log(`demo: ${n} checks passed`);
