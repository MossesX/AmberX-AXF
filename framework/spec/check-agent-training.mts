/**
 * Agent training contracts (core/engines/agent-training-rules.mjs): agent-training@1 and vocabulary-index@1. The
 * fixture replays (normalizer, validators that name the field, the job expansion into agent-definition@1 training
 * jobs), the pinned agent-definition@1 constants match the reference, the registry snapshot and the JSON Schemas are
 * current, the empty block the migration writes is the engine's, and the Python snapshot carries it.
 * Kotlin twin deferred (PORTING.md).
 *   npx -y tsx framework/spec/check-agent-training.mts            (--write regenerates spec/fixtures/agent-training.json)
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import * as T from '../core/engines/agent-training-rules.mjs';
import { AGENT_ID_PATTERN, MEMORY_TYPES, TRAINING_DEFAULTS, TRAINING_SCHEDULES, TRAINING_SOURCE_TYPES, validateAgentItem } from '../core/agents.ts';

let n = 0;
const ok = (c: unknown, m: string) => { assert.ok(c, m); n++; };
const eq = (a: unknown, b: unknown, m: string) => { assert.deepEqual(a, b, m); n++; };
const root = new URL('../../', import.meta.url);
const read = (p: string) => JSON.parse(readFileSync(new URL(p, root), 'utf8'));
const fields = (errs: { field: string }[]) => errs.map((e) => e.field);

/* ---- the contract: computed here, replayed from the fixture ---- */
const AT = '2026-11-10T16:30:00.000Z';
const known = { agents: ['coder', 'writer'], tools: ['calc'], skills: ['review'], personas: ['calm'], lingo: ['eng'], skillPages: ['react-ui'] };
const full = {
  $axf: 'agent-training@1', agentId: 'coder', name: 'Front-end product training', description: 'Our shop, our stack.', status: 'trained', schedule: 'daily',
  categories: [{ id: 'shop', label: 'Shop', kind: 'product', keywords: 'sku, bundle, sku' }, { label: 'React stack', kind: 'code', keywords: ['hook', 'tsx'] }, { id: 'ghost' }],
  sources: [
    { id: 'site', type: 'website', fetch: 'firecrawl', url: 'https://shop.example/docs', include: ['/docs/*'], exclude: '/docs/legacy/*', depth: 3, limit: 5000, categoryIds: ['shop', 'nope'] },
    { type: 'product', url: 'https://shop.example/catalog', productTypes: ['Speakers', 'Cables'], fetch: 'http', categoryIds: ['shop'] },
    { type: 'code', fetch: 'repo', paths: 'apps/console-web/plugins/**/web/*.tsx', languages: ['react', 'typescript', 'cobol'], categoryIds: ['react-stack'] },
    { type: 'files', files: ['uploads/brand-guide.pdf'], fetch: 'upload', enabled: 'false' },
    { type: 'text', fetch: 'paste', text: 'Support hours are 9 to 5.', label: 'Hours' },
    { type: 'search', query: 'AmberX AXF framework controls', limit: 3 },
    { type: 'mcp', url: 'https://hub.example/mcp', tokenEnv: 'HUB_TOKEN', tool: 'catalog_dump', args: { full: true } },
  ],
  processing: { chunkSize: 50, overlap: '200', dedupe: 'true', summarize: true, extract: ['vocabulary', 'persona', 'magic'], embedProfile: 'main' },
  storage: { mode: 'both', index: 'buffer', scope: 'Bad Scope', maxItems: 5, replace: false },
  outputs: { toolIds: ['calc'], skillIds: ['review'], skillPages: ['react-ui'], personaId: 'calm', lingoIds: ['eng'], vocabulary: { id: 'coder.vocab', terms: 240, byCategory: { shop: 200, 'react-stack': 40, gone: 3 } }, pairs: 12, attached: [{ kind: 'persona', id: 'calm', at: AT }, { kind: 'bogus', id: 'x', auto: false }] },
  lastRun: { at: AT, status: 'completed', added: 812, log: ['crawl https://shop.example/docs: 40 pages', 'completed: 812 knowledge chunks'] },
  updatedAt: AT, evil: 'dropped',
};
const normFull = T.normTraining(full);
const errsFull = T.trainingErrors(normFull, { known });
const draft = T.normTraining({ agentId: 'writer', sources: [{ type: 'code', fetch: 'repo' }, { type: 'website', url: 'shop.example' }, { type: 'files', fetch: 'upload' }, { type: 'search' }, { type: 'mcp', url: 'https://h/mcp' }, { id: 'dup', type: 'text', text: 'a' }, { id: 'dup', type: 'text', text: '' }] });
const errsDraft = T.trainingErrors(draft, { known });
const junk = T.normTraining({ agentId: 'coder', sources: [{ type: 'telepathy', url: 'nope' }], outputs: { toolIds: ['calc', 'ghost'] } });
const errsJunk = T.trainingErrors(junk, { known });
const empty = T.emptyTraining('coder');
const errsEmpty = T.trainingErrors(empty, { known });
const unknownAgent = T.trainingErrors(T.emptyTraining('nobody'), { known });
const noAgent = T.trainingErrors(T.normTraining({}), {});
const jobs = T.trainingJobs(normFull);
const vocab = T.normVocabulary({ id: 'coder.vocab', agentId: 'coder', terms: [{ term: 'SKU', meaning: 'stock keeping unit', categoryId: 'shop', count: 40, sources: ['https://shop.example/docs/skus'] }, { term: 'sku', meaning: 'dup' }, 'hook', { term: '' }, { term: 'Bundle', categoryId: 'Bad Id' }], updatedAt: AT });
const vocabErrs = [T.vocabularyErrors(vocab), T.vocabularyErrors({ $axf: 'vocabulary-index@1' }), T.vocabularyErrors('x')];

const computed = {
  contract: T.CONTRACT, at: AT, known,
  full: { raw: full, normalized: normFull, errors: errsFull },
  draft: { normalized: draft, errors: errsDraft },
  junk: { normalized: junk, errors: errsJunk },
  empty: { normalized: empty, errors: errsEmpty },
  unknownAgent, noAgent, jobs,
  vocabulary: { normalized: vocab, errors: vocabErrs },
  schemas: Object.keys(T.jsonSchemas()).sort(),
};

const fixtureUrl = new URL('fixtures/agent-training.json', import.meta.url);
if (process.argv.includes('--write')) { writeFileSync(fixtureUrl, JSON.stringify(computed, null, 2) + '\n'); console.log('wrote spec/fixtures/agent-training.json'); }
const fixture = JSON.parse(readFileSync(fixtureUrl, 'utf8'));
eq(JSON.parse(JSON.stringify(computed)), fixture, 'fixture replays: agent-training@1 + vocabulary-index@1 (re-run with --write after a deliberate change)');

/* ---- the rules, spelled out ---- */
eq([T.AGENT_ID_PATTERN, T.INDEX_TYPES, T.SCHEDULES, T.AGENT_TRAINING.ranges.chunkSize, T.AGENT_TRAINING.ranges.overlap],
  [AGENT_ID_PATTERN, MEMORY_TYPES.filter((t) => ['keyword', 'vector', 'hybrid'].includes(t)), TRAINING_SCHEDULES, [TRAINING_DEFAULTS.chunkMin, TRAINING_DEFAULTS.chunkMax], [0, TRAINING_DEFAULTS.overlapMax]],
  'the pinned agent-definition@1 constants equal the reference (framework/core/agents.ts)');
eq(errsFull, [], 'a full block with every reference known validates');
ok(!('evil' in normFull) && normFull.sources.length === 7, 'unknown keys drop; every source kept');
eq([junk.sources[0].type, junk.sources[0].fetch, fields(errsJunk)], ['website', 'firecrawl', ['training.sources[0].url', 'training.outputs.toolIds']], 'an unknown source type falls back to website (then fails on its URL); an unknown tool is named');
eq(normFull.categories.map((c) => c.id), ['shop', 'react-stack', 'ghost'], 'category ids slug from the label when missing');
eq(normFull.categories[0].keywords, ['sku', 'bundle'], 'keywords de-duplicate');
eq(normFull.sources[0].categoryIds, ['shop'], 'a source only points at categories that exist');
eq([normFull.sources[1].fetch, normFull.sources[2].languages, normFull.sources[3].enabled, T.normTraining({ sources: [{ type: 'code' }] }).sources[0].fetch], ['http', ['react', 'typescript'], false, 'repo'], 'a known fetch method is kept (the validator judges it); a missing one takes the type\'s default; unknown languages drop; enabled parses');
eq(fields(T.trainingErrors(T.normTraining({ ...full, sources: [{ type: 'product', fetch: 'git' }] }), {})), ['training.sources[0].fetch', 'training.sources[0].url'], 'a fetch method the type does not allow, and a missing URL, are named by field');
eq([normFull.processing.chunkSize, normFull.processing.overlap, normFull.processing.extract, normFull.storage.index, normFull.storage.scope, normFull.storage.maxItems], [300, 200, ['vocabulary', 'persona'], 'hybrid', '', 100], 'processing and storage clamp to the ranges; a bad index type falls back to hybrid');
eq(Object.keys(normFull.outputs.vocabulary.byCategory), ['shop', 'react-stack'], 'vocabulary counts keep only known categories');
eq(normFull.outputs.attached.map((a) => a.kind), ['persona', 'skill'], 'an unknown attach kind falls back to skill');
ok(fields(errsFull).length === 0 && fields(T.trainingErrors(normFull, { known: { ...known, tools: [] } })).includes('training.outputs.toolIds'), 'output references are checked against what exists (tools, skills, persona, lingo, skill pages)');
eq(fields(errsDraft), ['training.sources[0].paths', 'training.sources[1].url', 'training.sources[2].files', 'training.sources[3].query', 'training.sources[4].uri', 'training.sources[6].id', 'training.sources[6].text'], 'every source rule names its field');
eq([empty.status, empty.sources, empty.categories, empty.outputs.toolIds, empty.lastRun, errsEmpty], ['empty', [], [], [], null, []], 'the empty block an existing agent gets validates with no sources');
eq(fields(unknownAgent), ['training.agentId'], 'an unknown agent is refused');
eq(fields(noAgent), ['training.agentId'], 'a block with no agent is refused');
eq(jobs.map((j) => j.sources[0].type), ['firecrawl-crawl', 'url', 'repo', 'text', 'firecrawl-search', 'mcp-tool'], 'enabled sources expand into agent-definition@1 training jobs (the disabled files source is skipped)');
ok(jobs.every((j) => TRAINING_SOURCE_TYPES.includes(j.sources[0].type as never)), 'every expanded job uses a source type the reference knows');
ok(jobs.every((j) => validateAgentItem('training', j, { known: { agents: ['coder'] } }).ok), 'every expanded job validates under agent-definition@1');
eq(jobs[0].tags, ['training', 'shop'], 'jobs are tagged with their categories');
eq(T.trainingJobs(T.normTraining({ ...full, storage: { mode: 'none' } })), [], 'storage mode none runs no jobs');
eq(vocab.terms.map((t) => t.term), ['SKU', 'hook', 'Bundle'], 'vocabulary terms de-duplicate case-insensitively and drop blanks');
eq(vocab.byCategory, { shop: ['SKU'], uncategorized: ['hook', 'Bundle'] }, 'terms group by category (a bad category id is uncategorized)');
eq(vocabErrs.map(fields), [[], ['vocabulary.id', 'vocabulary.agentId'], ['vocabulary']], 'vocabulary validators name the field');

/* ---- snapshots current ---- */
const snap = read('framework/schemas/agent-training.json');
eq(snap, JSON.parse(JSON.stringify(T.registrySnapshot())), 'framework/schemas/agent-training.json is the current registry snapshot (axf schemas)');
eq(snap.empty, JSON.parse(JSON.stringify(T.emptyTraining(''))), 'the snapshot carries the empty block the Python migration copies onto every agent');
for (const [name, schema] of Object.entries(T.jsonSchemas())) eq(read(`framework/schemas/json/${name}`), JSON.parse(JSON.stringify(schema)), `framework/schemas/json/${name} is current (axf schemas)`);
const trainingSchema = T.jsonSchemas()['agent-training.schema.json'] as { properties: { outputs: { properties: { skillPages: { items: { $ref: string } }; vocabulary: { properties: { id: { anyOf: { $ref?: string }[] } } } } } } };
ok(trainingSchema.properties.outputs.properties.skillPages.items.$ref === 'axf/agent-skill.schema.json#/properties/id' && trainingSchema.properties.outputs.properties.vocabulary.properties.id.anyOf[0].$ref === 'axf/vocabulary-index.schema.json#/properties/id', 'outputs reference agent-skill@1 and vocabulary-index@1 by $ref, never a copy');
ok(read('framework/schemas/json/agent-skill.schema.json').properties.id, 'the agent-skill@1 schema the $ref points at exists');

console.log(`check-agent-training: ${n} checks passed`);
