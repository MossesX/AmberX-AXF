/**
 * Agent training contracts (core/engines/agent-training-rules.mjs): agent-training@1 and vocabulary-index@1.
 *
 * Every employee agent (an agent-definition@1 record in the Agent manager) carries ONE training block: what to learn
 * from (data sources: website scopes, product catalogues, code in given languages, files, pasted text, web search,
 * MCP), how each source is fetched, how the material is processed and stored (RAG chunks in the agent's memory index,
 * summaries, or both), the categories the wizard sorts everything into, and what the training built and attached
 * to the agent: tools, skills, a persona, lingo packs and a categorized vocabulary index.
 *
 *   agent-training@1    the training spec + outputs of one agent (stored on the agent as `training`)
 *   vocabulary-index@1  the categorized terms a training run extracted (one per agent, referenced by id)
 *
 * Outputs reference existing records, never copies: `skillIds` / `personaId` / `lingoIds` / `toolIds` are
 * agent-definition@1 ids (framework/core/agents.ts), `skillPages` are agent-skill@1 ids (core/engines/swarm-rules.mjs).
 * Pure: normalizers fill defaults and drop junk, validators name the field ({ field, code, message }), `jsonSchemas()`
 * writes the JSON Schemas and `axf schemas` snapshots the registry to framework/schemas/agent-training.json for Python
 * readers (the console's agent-manager server). Nothing here fetches, embeds or stores anything: a host does.
 * Fixture spec/fixtures/agent-training.json, check spec/check-agent-training.mts. Kotlin twin deferred (PORTING.md).
 */
// Pinned from framework/core/agents.ts (agent-definition@1), which plain Node cannot import from an .mjs engine;
// spec/check-agent-training.mts asserts these four stay equal to the reference.
export const AGENT_ID_PATTERN = '^[a-z0-9][a-z0-9._-]{0,63}$';
const MEMORY_TYPES = ['none', 'buffer', 'summary', 'keyword', 'vector', 'hybrid'];
const TRAINING_DEFAULTS = { chunkSize: 1200, overlap: 120, chunkMin: 300, chunkMax: 6000, overlapMax: 1000 };
const TRAINING_SCHEDULES = ['manual', 'hourly', 'daily', 'weekly'];

export const TAGS = { training: 'agent-training@1', vocabulary: 'vocabulary-index@1' };
export const CONTRACT = TAGS.training;

/** What kind of material a source is. */
export const SOURCE_TYPES = ['website', 'product', 'code', 'files', 'text', 'search', 'mcp'];
/** How a source is fetched; `FETCH_BY_TYPE` says which methods each type allows (the first is its default). */
export const FETCH_METHODS = ['firecrawl', 'http', 'repo', 'git', 'upload', 'paste', 'mcp'];
export const FETCH_BY_TYPE = {
  website: ['firecrawl', 'http'], product: ['firecrawl', 'http'], code: ['repo', 'git', 'upload'], files: ['upload', 'repo'],
  text: ['paste'], search: ['firecrawl'], mcp: ['mcp'],
};
/** Code languages / stacks a code source may be narrowed to (an open list: `other` carries anything else). */
export const CODE_LANGUAGES = ['react', 'typescript', 'javascript', 'python', 'kotlin', 'java', 'swift', 'go', 'rust', 'css', 'html', 'sql', 'shell', 'markdown', 'other'];
export const CATEGORY_KINDS = ['product', 'code', 'docs', 'process', 'brand', 'support', 'people', 'custom'];
/** Where processed material goes: RAG chunks in the memory index, summaries as facts, both, or nowhere (dry run). */
export const STORAGE_MODES = ['rag', 'summaries', 'both', 'none'];
/** The memory index a RAG store uses: the searchable agent-definition@1 memory types. */
export const INDEX_TYPES = MEMORY_TYPES.filter((t) => ['keyword', 'vector', 'hybrid'].includes(t));
/** What a run may build from the material and attach to the agent. */
export const EXTRACTS = ['vocabulary', 'pairs', 'tools', 'skills', 'persona'];
export const SCHEDULES = TRAINING_SCHEDULES;
export const STATUSES = ['empty', 'draft', 'ready', 'running', 'trained', 'stale', 'failed'];
/** Kinds of generated things a run auto-attached to the agent. */
export const ATTACH_KINDS = ['vocabulary', 'pairs', 'tool', 'skill', 'skill-page', 'persona', 'lingo'];

export const AGENT_TRAINING = {
  tags: TAGS, idPattern: AGENT_ID_PATTERN,
  sourceTypes: SOURCE_TYPES, fetchMethods: FETCH_METHODS, fetchByType: FETCH_BY_TYPE, codeLanguages: CODE_LANGUAGES, categoryKinds: CATEGORY_KINDS,
  storageModes: STORAGE_MODES, indexTypes: INDEX_TYPES, extracts: EXTRACTS, schedules: SCHEDULES, statuses: STATUSES, attachKinds: ATTACH_KINDS,
  limits: {
    name: 120, description: 1000, label: 80, url: 2000, text: 30000, query: 400, categories: 40, keywords: 40, keyword: 40, sources: 40, include: 40, pattern: 400,
    productTypes: 40, productType: 80, languages: 20, paths: 40, files: 200, file: 400, categoryIds: 40, tokenEnv: 120, uri: 2000, tool: 120,
    toolIds: 60, skillIds: 60, skillPages: 60, lingoIds: 20, attached: 200, log: 60, logLine: 400, terms: 2000, term: 120, meaning: 400, termSources: 10,
  },
  ranges: { depth: [0, 10], limit: [1, 2000], chunkSize: [TRAINING_DEFAULTS.chunkMin, TRAINING_DEFAULTS.chunkMax], overlap: [0, TRAINING_DEFAULTS.overlapMax], maxItems: [100, 200000] },
  defaults: {
    processing: { chunkSize: TRAINING_DEFAULTS.chunkSize, overlap: TRAINING_DEFAULTS.overlap, dedupe: true, summarize: false, extract: ['vocabulary', 'pairs', 'skills'], embedProfile: '' },
    storage: { mode: 'rag', index: 'hybrid', scope: '', maxItems: 20000, replace: true },
    source: { depth: 2, limit: 50 },
  },
};
const L = AGENT_TRAINING.limits;
const R = AGENT_TRAINING.ranges;
const ID_RE = new RegExp(AGENT_ID_PATTERN);

/* ------------------------------------------------------------------ */
/* helpers                                                              */
/* ------------------------------------------------------------------ */

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v, max) => (v === undefined || v === null ? '' : typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '').slice(0, max);
const bool = (v, d) => (v === undefined || v === null ? d : v === true || v === 'true');
const num = (v, d, [lo, hi]) => { const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v; return typeof n === 'number' && Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.floor(n))) : d; };
/** A list of trimmed non-empty strings from an array or a newline / comma separated string (capped, de-duplicated). */
const list = (v, max, len, sep = /\r?\n|,/) => {
  const raw = Array.isArray(v) ? v.map((x) => str(x, len + 1)) : typeof v === 'string' ? v.split(sep) : [];
  const out = [];
  for (const x of raw) { const t = x.trim().slice(0, len); if (t && !out.includes(t)) out.push(t); if (out.length >= max) break; }
  return out;
};
const pick = (v, allowed, d) => (allowed.includes(v) ? v : d);
const picks = (v, allowed, max) => list(v, max, 40).filter((x) => allowed.includes(x));
const ids = (v, max) => list(v, max, 64).filter((x) => ID_RE.test(x));
const slug = (s, fallback) => (str(s, 200).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[^a-z0-9]+|-+$/g, '').slice(0, 64) || fallback);
const err = (field, code, message) => ({ field, code, message });
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const when = (v) => (typeof v === 'string' && ISO_RE.test(v) ? v : '');

/* ------------------------------------------------------------------ */
/* agent-training@1                                                     */
/* ------------------------------------------------------------------ */

/** The empty training block every employee agent starts with (the migration writes exactly this). */
export function emptyTraining(agentId = '') {
  return normTraining({ agentId });
}

function normCategory(c, i) {
  const o = isObj(c) ? c : { label: str(c, L.label) };
  const label = str(o.label, L.label).trim();
  return { id: slug(o.id || label, `category-${i + 1}`), label: label || slug(o.id, `category-${i + 1}`), kind: pick(o.kind, CATEGORY_KINDS, 'custom'), keywords: list(o.keywords, L.keywords, L.keyword) };
}

function normSource(s, i) {
  const o = isObj(s) ? s : {};
  const type = pick(o.type, SOURCE_TYPES, 'website');
  const allowed = FETCH_BY_TYPE[type];
  const D = AGENT_TRAINING.defaults.source;
  const out = {
    id: slug(o.id, `source-${i + 1}`), type, label: str(o.label, L.label), fetch: pick(o.fetch, FETCH_METHODS, allowed[0]), enabled: bool(o.enabled, true),
    url: str(o.url, L.url).trim(), include: list(o.include, L.include, L.pattern), exclude: list(o.exclude, L.include, L.pattern), depth: num(o.depth, D.depth, R.depth), limit: num(o.limit, D.limit, R.limit),
    productTypes: list(o.productTypes, L.productTypes, L.productType), languages: picks(o.languages, CODE_LANGUAGES, L.languages), paths: list(o.paths, L.paths, L.pattern), files: list(o.files, L.files, L.file),
    text: str(o.text, L.text), query: str(o.query, L.query).trim(), tokenEnv: str(o.tokenEnv, L.tokenEnv), uri: str(o.uri, L.uri), tool: str(o.tool, L.tool), args: isObj(o.args) ? o.args : {},
    categoryIds: ids(o.categoryIds, L.categoryIds),
  };
  return out;
}

function normAttached(a) {
  const o = isObj(a) ? a : {};
  return { kind: pick(o.kind, ATTACH_KINDS, 'skill'), id: str(o.id, 64), at: when(o.at), auto: bool(o.auto, true) };
}

/** Normalize a training block: defaults filled, unknown values dropped, lists capped. Never throws. */
export function normTraining(raw) {
  const o = isObj(raw) ? raw : {};
  const P = { ...AGENT_TRAINING.defaults.processing, ...(isObj(o.processing) ? o.processing : {}) };
  const S = { ...AGENT_TRAINING.defaults.storage, ...(isObj(o.storage) ? o.storage : {}) };
  const out0 = isObj(o.outputs) ? o.outputs : {};
  const voc = isObj(out0.vocabulary) ? out0.vocabulary : {};
  const run = isObj(o.lastRun) ? o.lastRun : null;
  const sources = (Array.isArray(o.sources) ? o.sources : []).slice(0, L.sources).map(normSource);
  const categories = (Array.isArray(o.categories) ? o.categories : []).slice(0, L.categories).map(normCategory);
  const catIds = new Set(categories.map((c) => c.id));
  for (const s of sources) s.categoryIds = s.categoryIds.filter((c) => catIds.has(c));
  const status = pick(o.status, STATUSES, sources.length ? 'draft' : 'empty');
  return {
    $axf: TAGS.training, agentId: str(o.agentId, 64), name: str(o.name, L.name), description: str(o.description, L.description),
    status: status === 'empty' && sources.length ? 'draft' : status,
    categories, sources,
    processing: {
      chunkSize: num(P.chunkSize, AGENT_TRAINING.defaults.processing.chunkSize, R.chunkSize), overlap: num(P.overlap, AGENT_TRAINING.defaults.processing.overlap, R.overlap),
      dedupe: bool(P.dedupe, true), summarize: bool(P.summarize, false), extract: picks(P.extract, EXTRACTS, EXTRACTS.length), embedProfile: str(P.embedProfile, L.name),
    },
    storage: { mode: pick(S.mode, STORAGE_MODES, 'rag'), index: pick(S.index, INDEX_TYPES, 'hybrid'), scope: ID_RE.test(str(S.scope, 64)) ? str(S.scope, 64) : '', maxItems: num(S.maxItems, AGENT_TRAINING.defaults.storage.maxItems, R.maxItems), replace: bool(S.replace, true) },
    schedule: pick(o.schedule, SCHEDULES, 'manual'),
    outputs: {
      toolIds: ids(out0.toolIds, L.toolIds), skillIds: ids(out0.skillIds, L.skillIds), skillPages: ids(out0.skillPages, L.skillPages), personaId: ID_RE.test(str(out0.personaId, 64)) ? str(out0.personaId, 64) : '', lingoIds: ids(out0.lingoIds, L.lingoIds),
      vocabulary: { id: ID_RE.test(str(voc.id, 64)) ? str(voc.id, 64) : '', terms: num(voc.terms, 0, [0, L.terms]), byCategory: Object.fromEntries(Object.entries(isObj(voc.byCategory) ? voc.byCategory : {}).filter(([k]) => catIds.has(k)).map(([k, v]) => [k, num(v, 0, [0, L.terms])])) },
      pairs: num(out0.pairs, 0, [0, 100000]),
      attached: (Array.isArray(out0.attached) ? out0.attached : []).slice(0, L.attached).map(normAttached),
    },
    lastRun: run ? { at: when(run.at), status: pick(run.status, ['completed', 'partial', 'failed'], 'failed'), added: num(run.added, 0, [0, 10 ** 9]), log: list(run.log, L.log, L.logLine, /\r?\n/) } : null,
    updatedAt: when(o.updatedAt),
  };
}

/** Problems with a normalized training block ([] = fine). `ctx.known` (ids per collection) checks the references. */
export function trainingErrors(t, ctx, p = 'training') {
  const out = [];
  if (!isObj(t)) return [err(p, 'invalid', `${p} must be an object`)];
  if (t.$axf !== TAGS.training) out.push(err(`${p}.$axf`, t.$axf ? 'invalid' : 'missing', `${p} needs $axf: ${TAGS.training}`));
  if (typeof t.agentId !== 'string' || !ID_RE.test(t.agentId)) out.push(err(`${p}.agentId`, t.agentId ? 'invalid' : 'missing', 'a training block belongs to one agent: agentId must be its id'));
  else if (ctx?.known?.agents && !has(ctx.known.agents, t.agentId)) out.push(err(`${p}.agentId`, 'invalid', `unknown agent ${t.agentId}`));
  if (t.status !== 'empty' && !(Array.isArray(t.sources) && t.sources.length)) out.push(err(`${p}.sources`, 'missing', 'add at least one source before training'));
  const seen = new Set();
  for (const [i, c] of (Array.isArray(t.categories) ? t.categories : []).entries()) {
    if (seen.has(c.id)) out.push(err(`${p}.categories[${i}].id`, 'invalid', `category id ${c.id} is used twice`));
    seen.add(c.id);
    if (!c.label) out.push(err(`${p}.categories[${i}].label`, 'missing', `category ${c.id} needs a label`));
  }
  const sids = new Set();
  for (const [i, s] of (Array.isArray(t.sources) ? t.sources : []).entries()) {
    const q = `${p}.sources[${i}]`;
    if (sids.has(s.id)) out.push(err(`${q}.id`, 'invalid', `source id ${s.id} is used twice`));
    sids.add(s.id);
    if (!FETCH_BY_TYPE[s.type]?.includes(s.fetch)) out.push(err(`${q}.fetch`, 'invalid', `a ${s.type} source is fetched by ${FETCH_BY_TYPE[s.type]?.join(' or ')}, not ${s.fetch}`));
    if ((s.type === 'website' || s.type === 'product' || s.type === 'mcp' || s.fetch === 'git') && !/^https?:\/\//.test(s.url)) out.push(err(`${q}.url`, s.url ? 'invalid' : 'missing', `${s.type} sources need a URL starting with http:// or https://`));
    if (s.type === 'code' && s.fetch === 'repo' && !s.paths.length) out.push(err(`${q}.paths`, 'missing', 'code sources from the repo need at least one file glob'));
    if ((s.type === 'files' || (s.type === 'code' && s.fetch === 'upload')) && !s.files.length) out.push(err(`${q}.files`, 'missing', `${s.type} sources need at least one uploaded file`));
    if (s.type === 'text' && !s.text.trim()) out.push(err(`${q}.text`, 'missing', 'text sources need text'));
    if (s.type === 'search' && !s.query) out.push(err(`${q}.query`, 'missing', 'search sources need a query'));
    if (s.type === 'mcp' && !s.uri && !s.tool) out.push(err(`${q}.uri`, 'missing', 'mcp sources name a resource uri or a tool'));
  }
  const refs = [['toolIds', 'tools', 'tool'], ['skillIds', 'skills', 'skill'], ['lingoIds', 'lingo', 'lingo pack']];
  for (const [field, coll, what] of refs) for (const id of t.outputs?.[field] ?? []) if (ctx?.known?.[coll] && !has(ctx.known[coll], id)) out.push(err(`${p}.outputs.${field}`, 'invalid', `unknown ${what} ${id}`));
  if (t.outputs?.personaId && ctx?.known?.personas && !has(ctx.known.personas, t.outputs.personaId)) out.push(err(`${p}.outputs.personaId`, 'invalid', `unknown persona ${t.outputs.personaId}`));
  for (const id of t.outputs?.skillPages ?? []) if (ctx?.known?.skillPages && !has(ctx.known.skillPages, id)) out.push(err(`${p}.outputs.skillPages`, 'invalid', `unknown skill page ${id}`));
  return out;
}
const has = (set, id) => (set instanceof Set ? set.has(id) : Array.isArray(set) ? set.includes(id) : isObj(set) ? id in set : true);

/** The agent-definition@1 training jobs (one per enabled source) a host runs to fill the memory index from a spec. */
export function trainingJobs(t) {
  if (!isObj(t) || !Array.isArray(t.sources)) return [];
  const tags = (s) => [...new Set(['training', ...s.categoryIds])].slice(0, 10);
  return t.sources.filter((s) => s.enabled && t.storage.mode !== 'none').map((s) => {
    const src = s.type === 'text' ? { type: 'text', title: s.label || s.id, text: s.text }
      : s.type === 'search' ? { type: 'firecrawl-search', query: s.query, limit: s.limit }
        : s.type === 'mcp' ? (s.uri ? { type: 'mcp-resource', url: s.url, tokenEnv: s.tokenEnv, uri: s.uri } : { type: 'mcp-tool', url: s.url, tokenEnv: s.tokenEnv, tool: s.tool, args: s.args })
          : s.fetch === 'firecrawl' ? (s.depth === 0 ? { type: 'firecrawl-scrape', url: s.url } : { type: 'firecrawl-crawl', url: s.url, limit: s.limit, include: s.include })
            : s.fetch === 'http' ? { type: 'url', url: s.url }
              : { type: 'repo', paths: s.fetch === 'upload' ? s.files : s.paths };
    return { id: `${t.agentId}.training.${s.id}`, name: s.label || `${s.type} ${s.id}`, agentId: t.agentId, sources: [src], chunkSize: t.processing.chunkSize, overlap: t.processing.overlap, replace: t.storage.replace, schedule: t.schedule, tags: tags(s) };
  });
}

/* ------------------------------------------------------------------ */
/* vocabulary-index@1                                                   */
/* ------------------------------------------------------------------ */

/** Normalize a vocabulary index: terms de-duplicated (case-insensitive), capped, grouped by category. */
export function normVocabulary(raw) {
  const o = isObj(raw) ? raw : {};
  const seen = new Set();
  const terms = [];
  for (const t of Array.isArray(o.terms) ? o.terms : []) {
    const x = isObj(t) ? t : { term: t };
    const term = str(x.term, L.term).trim();
    const key = term.toLowerCase();
    if (!term || seen.has(key)) continue;
    seen.add(key);
    terms.push({ term, meaning: str(x.meaning, L.meaning).trim(), categoryId: ID_RE.test(str(x.categoryId, 64)) ? str(x.categoryId, 64) : '', count: num(x.count, 1, [0, 10 ** 9]), sources: list(x.sources, L.termSources, L.url) });
    if (terms.length >= L.terms) break;
  }
  const byCategory = {};
  for (const t of terms) (byCategory[t.categoryId || 'uncategorized'] ??= []).push(t.term);
  return { $axf: TAGS.vocabulary, id: ID_RE.test(str(o.id, 64)) ? str(o.id, 64) : '', agentId: str(o.agentId, 64), terms, byCategory, updatedAt: when(o.updatedAt) };
}

export function vocabularyErrors(v, p = 'vocabulary') {
  const out = [];
  if (!isObj(v)) return [err(p, 'invalid', `${p} must be an object`)];
  if (v.$axf !== TAGS.vocabulary) out.push(err(`${p}.$axf`, v.$axf ? 'invalid' : 'missing', `${p} needs $axf: ${TAGS.vocabulary}`));
  if (!ID_RE.test(String(v.id ?? ''))) out.push(err(`${p}.id`, v.id ? 'invalid' : 'missing', 'a vocabulary index needs an id'));
  if (!ID_RE.test(String(v.agentId ?? ''))) out.push(err(`${p}.agentId`, v.agentId ? 'invalid' : 'missing', 'a vocabulary index belongs to one agent'));
  return out;
}

/* ------------------------------------------------------------------ */
/* JSON Schemas (written by `axf schemas`)                              */
/* ------------------------------------------------------------------ */

export function jsonSchemas() {
  const strList = (max, len) => ({ type: 'array', maxItems: max, items: { type: 'string', maxLength: len } });
  const idList = (max) => ({ type: 'array', maxItems: max, items: { type: 'string', pattern: AGENT_ID_PATTERN } });
  const rng = ([lo, hi]) => ({ type: 'integer', minimum: lo, maximum: hi });
  const head = (name, tag, title, description) => ({ $schema: 'https://json-schema.org/draft/2020-12/schema', $id: `axf/${name}.schema.json`, title: `AmberX AXF ${title} (${tag})`, description: `Generated from framework/core/engines/agent-training-rules.mjs. ${description}` });
  const tsOrBlank = { anyOf: [{ type: 'string', format: 'date-time' }, { const: '' }] };
  const category = { type: 'object', required: ['id', 'label'], properties: { id: { type: 'string', pattern: AGENT_ID_PATTERN }, label: { type: 'string', maxLength: L.label }, kind: { enum: CATEGORY_KINDS }, keywords: strList(L.keywords, L.keyword) } };
  const source = {
    type: 'object', required: ['id', 'type', 'fetch'],
    properties: {
      id: { type: 'string', pattern: AGENT_ID_PATTERN }, type: { enum: SOURCE_TYPES }, label: { type: 'string', maxLength: L.label }, fetch: { enum: FETCH_METHODS }, enabled: { type: 'boolean' },
      url: { type: 'string', maxLength: L.url }, include: strList(L.include, L.pattern), exclude: strList(L.include, L.pattern), depth: rng(R.depth), limit: rng(R.limit),
      productTypes: strList(L.productTypes, L.productType), languages: { type: 'array', maxItems: L.languages, items: { enum: CODE_LANGUAGES } }, paths: strList(L.paths, L.pattern), files: strList(L.files, L.file),
      text: { type: 'string', maxLength: L.text }, query: { type: 'string', maxLength: L.query }, tokenEnv: { type: 'string', maxLength: L.tokenEnv }, uri: { type: 'string', maxLength: L.uri }, tool: { type: 'string', maxLength: L.tool }, args: { type: 'object' },
      categoryIds: idList(L.categoryIds),
    },
    allOf: Object.entries(FETCH_BY_TYPE).map(([type, methods]) => ({ if: { properties: { type: { const: type } } }, then: { properties: { fetch: { enum: methods } } } })),
  };
  const training = {
    ...head('agent-training', TAGS.training, 'agent training', 'The training spec and outputs of one employee agent: data sources, fetch method, processing and storage (RAG / summaries), categories, and what was built and attached (tools, skills, persona, lingo, vocabulary index). Outputs reference agent-definition@1 records and agent-skill@1 pages by id.'),
    type: 'object', required: ['$axf', 'agentId', 'status', 'sources', 'processing', 'storage', 'outputs'],
    properties: {
      $axf: { const: TAGS.training }, agentId: { type: 'string', pattern: AGENT_ID_PATTERN }, name: { type: 'string', maxLength: L.name }, description: { type: 'string', maxLength: L.description }, status: { enum: STATUSES },
      categories: { type: 'array', maxItems: L.categories, items: category }, sources: { type: 'array', maxItems: L.sources, items: source },
      processing: { type: 'object', properties: { chunkSize: rng(R.chunkSize), overlap: rng(R.overlap), dedupe: { type: 'boolean' }, summarize: { type: 'boolean' }, extract: { type: 'array', items: { enum: EXTRACTS } }, embedProfile: { type: 'string', maxLength: L.name } } },
      storage: { type: 'object', properties: { mode: { enum: STORAGE_MODES }, index: { enum: INDEX_TYPES }, scope: { anyOf: [{ type: 'string', pattern: AGENT_ID_PATTERN }, { const: '' }] }, maxItems: rng(R.maxItems), replace: { type: 'boolean' } } },
      schedule: { enum: SCHEDULES },
      outputs: {
        type: 'object',
        properties: {
          toolIds: idList(L.toolIds), skillIds: idList(L.skillIds), skillPages: { type: 'array', maxItems: L.skillPages, items: { $ref: 'axf/agent-skill.schema.json#/properties/id' } },
          personaId: { anyOf: [{ type: 'string', pattern: AGENT_ID_PATTERN }, { const: '' }] }, lingoIds: idList(L.lingoIds),
          vocabulary: { type: 'object', properties: { id: { anyOf: [{ $ref: 'axf/vocabulary-index.schema.json#/properties/id' }, { const: '' }] }, terms: rng([0, L.terms]), byCategory: { type: 'object', additionalProperties: rng([0, L.terms]) } } },
          pairs: { type: 'integer', minimum: 0 },
          attached: { type: 'array', maxItems: L.attached, items: { type: 'object', required: ['kind', 'id'], properties: { kind: { enum: ATTACH_KINDS }, id: { type: 'string' }, at: tsOrBlank, auto: { type: 'boolean' } } } },
        },
      },
      lastRun: { anyOf: [{ type: 'object', properties: { at: tsOrBlank, status: { enum: ['completed', 'partial', 'failed'] }, added: { type: 'integer', minimum: 0 }, log: strList(L.log, L.logLine) } }, { type: 'null' }] },
      updatedAt: tsOrBlank,
    },
  };
  const vocabulary = {
    ...head('vocabulary-index', TAGS.vocabulary, 'vocabulary index', 'The categorized terms a training run extracted for one agent (category ids are the agent-training@1 categories).'),
    type: 'object', required: ['$axf', 'id', 'agentId', 'terms'],
    properties: {
      $axf: { const: TAGS.vocabulary }, id: { type: 'string', pattern: AGENT_ID_PATTERN }, agentId: { type: 'string', pattern: AGENT_ID_PATTERN },
      terms: { type: 'array', maxItems: L.terms, items: { type: 'object', required: ['term'], properties: { term: { type: 'string', maxLength: L.term }, meaning: { type: 'string', maxLength: L.meaning }, categoryId: { anyOf: [{ type: 'string', pattern: AGENT_ID_PATTERN }, { const: '' }] }, count: { type: 'integer', minimum: 0 }, sources: strList(L.termSources, L.url) } } },
      byCategory: { type: 'object', additionalProperties: strList(L.terms, L.term) }, updatedAt: tsOrBlank,
    },
  };
  return { 'agent-training.schema.json': training, 'vocabulary-index.schema.json': vocabulary };
}

/** The registry snapshot `axf schemas` writes to framework/schemas/agent-training.json (Python readers use it). */
export function registrySnapshot() {
  return { ...AGENT_TRAINING, empty: emptyTraining('') };
}
