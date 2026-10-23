/*
 * Agent definitions — agent-definition@1 (kernel contract, web reference).
 *
 * One format for AI agents and the parts they are built from, so every AXF app (the Dev Console's agent manager,
 * Build Pilot, Android apps) loads the same agents: an **agent** = persona + lingo packs + skills + tools +
 * delegates + model + memory config; **add-ons** (agent-addon@1) bundle agents with their parts and seed memory;
 * **library items** (agent-library-item@1) carry one part on its own.
 *
 * This file is pure: validation and normalisation of every collection, the system-prompt composer, memory config
 * resolution, the memory text engine (tokens, BM25 ranking, chunking), workflow template filling, router parsing and
 * the add-on risk rules. Nothing here talks to a model, the network or storage; hosts do that. Mirrors:
 * Kotlin `ai.amberx.axf.kernel.agents` (Agents.kt) and the Python port `framework/python/axf/contracts/agents.py`,
 * all replaying spec/fixtures/agents.json (generated from this file by spec/gen-fixtures.mts).
 *
 * Every list here is an open registry: a host may know more builtin tools, memory types or source types than the
 * defaults (pass them in `AgentContext`); unknown values are refused only when the host did not declare them.
 */

export const AGENT_CONTRACT = 'agent-definition@1';
export const AGENT_ADDON_TAG = 'agent-addon@1';
export const AGENT_LIBRARY_ITEM_TAG = 'agent-library-item@1';
export const AGENT_MEMORY_TAG = 'agent-memory@1';
/** Capability id a host registers an agent runtime under (`axf.agents@1` is the console's service name for it). */
export const AGENTS_CAPABILITY = 'axf.agents';

export const AGENT_COLLECTIONS = ['agents', 'skills', 'personas', 'lingo', 'tools', 'workflows', 'training'] as const;
export type AgentCollection = (typeof AGENT_COLLECTIONS)[number];
/** Collections an add-on may provide, in install order (uninstall runs it backwards). */
export const ADDON_SECTIONS = ['personas', 'lingo', 'skills', 'tools', 'agents', 'workflows', 'training'] as const;

export const MEMORY_TYPES = ['none', 'buffer', 'summary', 'keyword', 'vector', 'hybrid'] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];
export const MEMORY_KINDS = ['fact', 'episode', 'summary', 'knowledge', 'note'] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];
export const MEMORY_RECORD_MODES = ['episodes', 'facts', 'both', 'off'] as const;
export const TOOL_KINDS = ['builtin', 'http', 'mcp', 'prompt', 'agent', 'workflow'] as const;
export type ToolKind = (typeof TOOL_KINDS)[number];
export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export const WORKFLOW_MODES = ['sequential', 'parallel', 'router', 'critic'] as const;
export const TRAINING_SOURCE_TYPES = ['firecrawl-scrape', 'firecrawl-crawl', 'firecrawl-search', 'url', 'repo', 'text', 'mcp-resource', 'mcp-tool'] as const;
export const TRAINING_SCHEDULES = ['manual', 'hourly', 'daily', 'weekly'] as const;
export const SCHEDULE_SECONDS: Record<string, number> = { hourly: 3600, daily: 86400, weekly: 7 * 86400 };

export const AGENT_ID_PATTERN = '^[a-z0-9][a-z0-9._-]{0,63}$';
export const TOOL_NAME_PATTERN = '^[a-zA-Z_][a-zA-Z0-9_]{0,63}$';
export const ADDON_ID_PATTERN = '^[a-z0-9][a-z0-9-]{1,47}$';
export const MEMORY_SCOPE_PATTERN = AGENT_ID_PATTERN;

/** Size caps shared by every port (characters, or items). */
export const AGENT_LIMITS = {
  name: 120, description: 1000, instructions: 30000, listItems: 200, listItem: 400, glossary: 300, examples: 30, example: 4000,
  samples: 20, voice: 200, steps: 40, sources: 40, memoryText: 8000, tags: 10, tag: 30, workflowLoops: 6, delegationDepth: 3,
} as const;

export const MEMORY_DEFAULTS = { type: 'hybrid' as MemoryType, topK: 6, window: 8, maxItems: 2000, record: 'both', decayDays: 0, minScore: 0 };
export const TRAINING_DEFAULTS = { chunkSize: 1200, overlap: 120, chunkMin: 300, chunkMax: 6000, overlapMax: 1000 };

export const MEMORY_SECTION = '## Memory\nYou have persistent memory across conversations. Relevant items are provided; use memory_search for more and memory_save for durable facts the user would want remembered.';
export const TOOLS_SECTION_PREFIX = '## Tools\nUse your tools when they help; read before you claim. Tools: ';
/** Names of the memory tools a host attaches when an agent's memory is on. */
export const MEMORY_TOOL_NAMES = ['memory_search', 'memory_save'] as const;

/* ---------------------------------------------------------------- types */

export interface AgentVoice { provider: string; voiceId: string; hint: string }
export interface AgentModel { profile?: string; model?: string; temperature?: number; max_tokens?: number }
export interface AgentMemoryConfig {
  type?: MemoryType; record?: string; topK?: number; window?: number; maxItems?: number; decayDays?: number; scope?: string; embedProfile?: string; minScore?: number;
}
export interface ResolvedMemory {
  type: MemoryType; scope: string; topK: number; window: number; maxItems: number; record: string; decayDays: number; embedProfile: string; minScore: number;
}
interface Base { id?: string; name?: string; tags?: string[]; forkedFrom?: string }
export interface AgentDef extends Base {
  icon?: string; description?: string; enabled?: boolean; personaId?: string; lingoIds?: string[]; skillIds?: string[]; toolIds?: string[];
  delegates?: string[]; instructions?: string; model?: AgentModel; memory?: AgentMemoryConfig; voice?: AgentVoice | null;
}
export interface SkillDef extends Base { description?: string; instructions?: string; triggers?: string[]; examples?: { input: string; output: string }[]; toolIds?: string[] }
export interface PersonaDef extends Base { role?: string; voice?: string; tone?: string; traits?: string[]; rules?: string[]; samples?: string[]; voiceSlot?: AgentVoice | null }
export interface LingoDef extends Base { description?: string; style?: string; glossary?: { term: string; meaning: string }[]; phrases?: string[]; avoid?: string[] }
export interface ToolDef extends Base { kind: ToolKind; config: Record<string, unknown>; parameters: Record<string, unknown>; description: string; dangerous?: boolean; enabled?: boolean }
export interface WorkflowStep { id: string; agentId: string; prompt?: string; label?: string; when?: string; memory?: boolean }
export interface WorkflowDef extends Base { description?: string; mode: string; steps: WorkflowStep[]; routerAgentId?: string; synthAgentId?: string; maxLoops?: number }
export interface TrainingSource { type: string; url?: string; query?: string; limit?: number; include?: string[]; paths?: string[]; title?: string; text?: string; tokenEnv?: string; uri?: string; tool?: string; args?: Record<string, unknown> }
export interface TrainingDef extends Base { agentId: string; sources: TrainingSource[]; chunkSize: number; overlap: number; replace: boolean; schedule: string; tags?: string[]; autoRun?: boolean }
export interface MemoryItem { id: string; kind: MemoryKind; text: string; tags?: string[]; source?: string; jobId?: string; createdAt: number; hits?: number; lastUsed?: number | null; vector?: number[] }
export interface AddonBundle {
  $axf: typeof AGENT_ADDON_TAG; id: string; name: string; version: string; description?: string; author?: string; icon?: string; requires?: Record<string, unknown>;
  provides: Partial<Record<(typeof ADDON_SECTIONS)[number], Record<string, unknown>[]>> & { memory?: Record<string, { kind?: string; text: string; tags?: string[]; source?: string }[]> };
}

/** What a validator may consult: the ids that exist, the builtin tools the host knows, and extra registry entries. */
export interface AgentContext {
  known?: Partial<Record<AgentCollection, Iterable<string>>>;
  /** builtin name → its parameter schema (used as the default `parameters` of a builtin tool) */
  builtins?: Record<string, { description?: string; parameters?: Record<string, unknown> }>;
  memoryTypes?: readonly string[];
  toolKinds?: readonly string[];
  sourceTypes?: readonly string[];
}
export interface AgentValidation<T = Record<string, unknown>> { ok: boolean; errors: string[]; warnings: string[]; item: T }

/* ---------------------------------------------------------------- helpers */

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max: number): string => (v === undefined || v === null ? '' : String(v)).slice(0, max);
const idRe = new RegExp(AGENT_ID_PATTERN);
const toolNameRe = new RegExp(TOOL_NAME_PATTERN);
const addonIdRe = new RegExp(ADDON_ID_PATTERN);
const SECRET_HEADER = /(?:bearer\s+\S{12,}|sk-|key)/i;

/** A newline-separated string or an array becomes a trimmed, non-empty list (capped). */
export function toLines(v: unknown, maxItems: number = AGENT_LIMITS.listItems, maxLen: number = AGENT_LIMITS.listItem): string[] {
  const raw = typeof v === 'string' ? v.split('\n') : Array.isArray(v) ? v.map((x) => (x === undefined || x === null ? '' : String(x))) : [];
  return raw.map((x) => x.trim()).filter(Boolean).slice(0, maxItems).map((x) => x.slice(0, maxLen));
}
function cleanVoice(v: unknown): AgentVoice {
  const o = isObj(v) ? v : {};
  return { provider: str(o.provider, AGENT_LIMITS.voice), voiceId: str(o.voiceId, AGENT_LIMITS.voice), hint: str(o.hint, AGENT_LIMITS.voice) };
}
function cleanTags(v: unknown): string[] | undefined {
  if (v === undefined) return undefined;
  return toLines(Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : [], AGENT_LIMITS.tags, AGENT_LIMITS.tag);
}
function has(ctx: AgentContext | undefined, coll: AgentCollection, id: string): boolean {
  const k = ctx?.known?.[coll];
  if (!k) return true; // no registry given: references are not checked
  for (const x of k) if (x === id) return true;
  return false;
}
function filterRefs(ctx: AgentContext | undefined, coll: AgentCollection, ids: unknown, self: string, warnings: string[], what: string): string[] {
  const out: string[] = [];
  for (const raw of toLines(ids)) {
    if (raw === self) continue;
    if (!has(ctx, coll, raw)) { warnings.push(`dropped unknown ${what} ${raw}`); continue; }
    if (!out.includes(raw)) out.push(raw);
  }
  return out;
}

/* ---------------------------------------------------------------- validation per collection */

export function validateAgentItem(collection: AgentCollection, raw: unknown, ctx?: AgentContext): AgentValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isObj(raw)) return { ok: false, errors: ['an item must be a JSON object'], warnings, item: {} };
  if (!(AGENT_COLLECTIONS as readonly string[]).includes(collection)) return { ok: false, errors: [`no collection ${collection}`], warnings, item: {} };
  const item: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) if (!['createdAt', 'updatedAt', 'origin'].includes(k)) item[k] = v;
  if (item.id !== undefined && item.id !== '') {
    const id = String(item.id).trim();
    if (!idRe.test(id)) errors.push('ids are lowercase letters, digits, dots, dashes and underscores (1–64 characters)');
    item.id = id;
  } else delete item.id;
  const self = typeof item.id === 'string' ? item.id : '';
  if (collection !== 'training') {
    const name = str(item.name, AGENT_LIMITS.name + 1).trim();
    if (!name) errors.push('a name is required');
    else if (name.length > AGENT_LIMITS.name) errors.push(`name can be at most ${AGENT_LIMITS.name} characters`);
    item.name = name;
  }
  if (item.description !== undefined) item.description = str(item.description, AGENT_LIMITS.description);
  const tags = cleanTags(item.tags);
  if (tags) item.tags = tags; else delete item.tags;

  switch (collection) {
    case 'agents': {
      const m = isObj(item.memory) ? { ...item.memory } : {};
      const types = ctx?.memoryTypes ?? MEMORY_TYPES;
      if (m.type && !types.includes(String(m.type))) errors.push(`memory type must be one of ${types.join(', ')}`);
      if (m.record && !(MEMORY_RECORD_MODES as readonly string[]).includes(String(m.record))) errors.push('memory record is episodes, facts, both or off');
      if (m.scope !== undefined && m.scope !== '' && !idRe.test(String(m.scope))) errors.push('memory scope must look like an id');
      for (const k of ['topK', 'window', 'maxItems', 'decayDays'] as const) {
        if (m[k] !== undefined && m[k] !== '' && m[k] !== null) {
          const n = Number(m[k]);
          if (!Number.isFinite(n) || n < 0) errors.push(`memory ${k} must be a number`); else m[k] = Math.floor(n);
        } else delete m[k];
      }
      item.memory = m;
      item.skillIds = filterRefs(ctx, 'skills', item.skillIds, '', warnings, 'skill');
      item.lingoIds = filterRefs(ctx, 'lingo', item.lingoIds, '', warnings, 'lingo pack');
      item.toolIds = filterRefs(ctx, 'tools', item.toolIds, '', warnings, 'tool');
      item.delegates = filterRefs(ctx, 'agents', item.delegates, self, warnings, 'delegate');
      const persona = str(item.personaId, AGENT_LIMITS.name);
      if (persona && !has(ctx, 'personas', persona)) { warnings.push(`dropped unknown persona ${persona}`); item.personaId = ''; } else item.personaId = persona;
      if (item.instructions !== undefined) {
        item.instructions = String(item.instructions);
        if ((item.instructions as string).length > AGENT_LIMITS.instructions) errors.push(`instructions can be at most ${AGENT_LIMITS.instructions} characters`);
      }
      if (item.enabled !== undefined) item.enabled = item.enabled !== false;
      if (item.voice !== undefined && item.voice !== null) {
        if (!isObj(item.voice)) errors.push('voice is an object {provider, voiceId, hint} or null');
        else item.voice = cleanVoice(item.voice);
      }
      if (item.model !== undefined) {
        if (!isObj(item.model)) errors.push('model is an object {profile, model, temperature, max_tokens}');
        else {
          const mo: AgentModel = {};
          if (item.model.profile) mo.profile = str(item.model.profile, AGENT_LIMITS.name);
          if (item.model.model) mo.model = str(item.model.model, AGENT_LIMITS.name);
          if (item.model.temperature !== undefined && item.model.temperature !== null && item.model.temperature !== '') {
            const t = Number(item.model.temperature);
            if (!Number.isFinite(t) || t < 0 || t > 2) errors.push('temperature is between 0 and 2'); else mo.temperature = t;
          }
          if (item.model.max_tokens !== undefined && item.model.max_tokens !== null && item.model.max_tokens !== '') {
            const n = Number(item.model.max_tokens);
            if (!Number.isFinite(n) || n < 1) errors.push('max_tokens is a positive number'); else mo.max_tokens = Math.floor(n);
          }
          item.model = mo;
        }
      }
      break;
    }
    case 'personas': {
      for (const k of ['role', 'voice', 'tone'] as const) if (item[k] !== undefined) item[k] = str(item[k], AGENT_LIMITS.description);
      item.traits = toLines(item.traits); item.rules = toLines(item.rules); item.samples = toLines(item.samples, AGENT_LIMITS.samples, AGENT_LIMITS.example);
      if (item.voiceSlot !== undefined && item.voiceSlot !== null) {
        if (!isObj(item.voiceSlot)) errors.push('voiceSlot is an object {provider, voiceId, hint} or null');
        else item.voiceSlot = cleanVoice(item.voiceSlot);
      }
      break;
    }
    case 'skills': {
      if (item.instructions !== undefined) {
        item.instructions = String(item.instructions);
        if ((item.instructions as string).length > AGENT_LIMITS.instructions) errors.push(`instructions can be at most ${AGENT_LIMITS.instructions} characters`);
      }
      item.triggers = toLines(item.triggers);
      const ex = Array.isArray(item.examples) ? item.examples : [];
      item.examples = ex.filter(isObj).slice(0, AGENT_LIMITS.examples).map((e) => ({ input: str(e.input, AGENT_LIMITS.example), output: str(e.output, AGENT_LIMITS.example) }));
      item.toolIds = filterRefs(ctx, 'tools', item.toolIds, '', warnings, 'tool');
      break;
    }
    case 'lingo': {
      if (item.style !== undefined) item.style = str(item.style, AGENT_LIMITS.description);
      const g = Array.isArray(item.glossary) ? item.glossary : [];
      item.glossary = g.filter(isObj).slice(0, AGENT_LIMITS.glossary).map((e) => ({ term: str(e.term, AGENT_LIMITS.listItem), meaning: str(e.meaning, AGENT_LIMITS.listItem) })).filter((e) => e.term);
      item.phrases = toLines(item.phrases); item.avoid = toLines(item.avoid);
      break;
    }
    case 'tools': {
      const name = String(item.name ?? '');
      if (!toolNameRe.test(name)) errors.push('tool name must be a function name: letters, digits, underscores (e.g. get_weather)');
      const kinds = ctx?.toolKinds ?? TOOL_KINDS;
      const kind = String(item.kind || 'builtin');
      if (!kinds.includes(kind)) errors.push(`tool kind must be one of ${kinds.join(', ')}`);
      const cfg: Record<string, unknown> = isObj(item.config) ? { ...item.config } : {};
      let params: unknown = item.parameters;
      if (kind === 'builtin') {
        const b = String(cfg.builtin ?? '');
        const builtins = ctx?.builtins;
        if (builtins && !(b in builtins)) errors.push(`unknown builtin; choose one of ${Object.keys(builtins).join(', ')}`);
        else if (!b) errors.push('builtin tools name which builtin they run');
        if (!params && builtins?.[b]?.parameters) params = builtins[b]!.parameters;
        if (!item.description && builtins?.[b]?.description) item.description = builtins[b]!.description;
      }
      if (kind === 'http') {
        if (!/^https?:\/\//.test(String(cfg.url ?? ''))) errors.push('http tools need a URL starting with http:// or https://');
        const method = String(cfg.method ?? 'GET').toUpperCase();
        if (!(HTTP_METHODS as readonly string[]).includes(method)) errors.push('unsupported method'); else cfg.method = method;
        const headers = isObj(cfg.headers) ? cfg.headers : {};
        for (const [k, v] of Object.entries(headers)) {
          if (typeof v !== 'string') { errors.push('header values must be strings (use env:VAR for secrets)'); continue; }
          if (!v.startsWith('env:') && SECRET_HEADER.test(v) && ['authorization', 'x-api-key', 'api-key'].includes(k.toLowerCase())) errors.push(`put secrets in an environment variable: set header ${k} to env:MY_VAR`);
        }
      }
      if (kind === 'mcp' && (!/^https?:\/\//.test(String(cfg.url ?? '')) || !cfg.tool)) errors.push('mcp tools need a server URL and the remote tool name');
      if (kind === 'prompt' && !String(cfg.template ?? '').trim()) errors.push('prompt tools need a template');
      if (kind === 'agent') {
        if (!cfg.agentId) errors.push('agent tools need the agent to delegate to');
        else if (!has(ctx, 'agents', String(cfg.agentId))) errors.push(`unknown agent ${String(cfg.agentId)}`);
      }
      if (kind === 'workflow') {
        if (!cfg.workflowId) errors.push('workflow tools need a workflow');
        else if (!has(ctx, 'workflows', String(cfg.workflowId))) errors.push(`unknown workflow ${String(cfg.workflowId)}`);
      }
      if (params === undefined || params === null) params = { type: 'object', properties: {} };
      if (!isObj(params) || params.type !== 'object') errors.push('parameters must be a JSON Schema object ({type: object, properties: {...}})');
      item.name = name; item.kind = kind; item.config = cfg; item.parameters = params;
      item.description = str(item.description, AGENT_LIMITS.description);
      item.dangerous = item.dangerous === true;
      if (item.enabled !== undefined) item.enabled = item.enabled !== false;
      break;
    }
    case 'workflows': {
      const mode = String(item.mode || 'sequential');
      if (!(WORKFLOW_MODES as readonly string[]).includes(mode)) errors.push('mode is sequential, parallel, router or critic');
      item.mode = mode;
      const steps = (Array.isArray(item.steps) ? item.steps : []).filter(isObj).slice(0, AGENT_LIMITS.steps);
      item.steps = steps.map((s, i) => {
        const sid = String(s.id || `s${i + 1}`).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) || `s${i + 1}`;
        const agentId = String(s.agentId ?? '');
        if (!agentId || !has(ctx, 'agents', agentId)) errors.push(`step ${sid}: unknown agent ${agentId}`);
        const out: WorkflowStep = { id: sid, agentId };
        if (s.prompt !== undefined) out.prompt = str(s.prompt, AGENT_LIMITS.instructions);
        if (s.label !== undefined) out.label = str(s.label, AGENT_LIMITS.name);
        if (s.when !== undefined) out.when = str(s.when, AGENT_LIMITS.description);
        if (s.memory !== undefined) out.memory = s.memory !== false;
        return out;
      });
      const ids = (item.steps as WorkflowStep[]).map((s) => s.id);
      if (new Set(ids).size !== ids.length) errors.push('step ids must be unique');
      if (mode === 'router') {
        if (!item.routerAgentId) errors.push('router workflows need a router agent');
        else if (!has(ctx, 'agents', String(item.routerAgentId))) errors.push(`unknown router agent ${String(item.routerAgentId)}`);
      }
      if (mode === 'parallel' && item.synthAgentId && !has(ctx, 'agents', String(item.synthAgentId))) errors.push(`unknown merge agent ${String(item.synthAgentId)}`);
      if (mode === 'critic' && (item.steps as WorkflowStep[]).length < 2) errors.push('critic workflows need a writer step and a reviewer step');
      if (item.maxLoops !== undefined && item.maxLoops !== null && item.maxLoops !== '') {
        const n = Number(item.maxLoops);
        if (!Number.isFinite(n) || n < 1) errors.push('maxLoops is a positive number'); else item.maxLoops = Math.min(Math.floor(n), AGENT_LIMITS.workflowLoops);
      } else delete item.maxLoops;
      break;
    }
    case 'training': {
      const agentId = String(item.agentId ?? '');
      if (!agentId) errors.push('a training job trains one agent: choose it');
      else if (!has(ctx, 'agents', agentId)) errors.push(`unknown agent ${agentId}`);
      item.agentId = agentId;
      if (item.name !== undefined) item.name = str(item.name, AGENT_LIMITS.name);
      const types = ctx?.sourceTypes ?? TRAINING_SOURCE_TYPES;
      const srcs = (Array.isArray(item.sources) ? item.sources : []).filter(isObj).slice(0, AGENT_LIMITS.sources);
      if (!srcs.length) errors.push('add at least one source');
      item.sources = srcs.map((s) => {
        const t = String(s.type ?? '');
        if (!types.includes(t)) { errors.push(`unknown source type ${t}`); return { ...s, type: t }; }
        const out: Record<string, unknown> = { ...s, type: t };
        if (['firecrawl-scrape', 'firecrawl-crawl', 'url', 'mcp-resource', 'mcp-tool'].includes(t) && !/^https?:\/\//.test(String(s.url ?? ''))) errors.push(`${t} sources need a URL starting with http:// or https://`);
        if (t === 'firecrawl-search' && !String(s.query ?? '').trim()) errors.push('firecrawl-search sources need a query');
        if (t === 'repo') { out.paths = toLines(s.paths); if (!(out.paths as string[]).length) errors.push('repo sources need at least one file glob'); }
        if (t === 'text' && !String(s.text ?? '').trim()) errors.push('text sources need text');
        if (t === 'mcp-resource' && !s.uri) errors.push('mcp-resource sources need the resource uri');
        if (t === 'mcp-tool' && !s.tool) errors.push('mcp-tool sources need the tool name');
        if (s.tokenEnv !== undefined) out.tokenEnv = str(s.tokenEnv, AGENT_LIMITS.name);
        if (s.include !== undefined) out.include = toLines(s.include);
        return out;
      });
      const sched = String(item.schedule || 'manual');
      if (!(TRAINING_SCHEDULES as readonly string[]).includes(sched)) errors.push('schedule is manual, hourly, daily or weekly');
      item.schedule = sched;
      const cs = Number(item.chunkSize ?? TRAINING_DEFAULTS.chunkSize);
      item.chunkSize = Math.max(TRAINING_DEFAULTS.chunkMin, Math.min(Number.isFinite(cs) && cs > 0 ? Math.floor(cs) : TRAINING_DEFAULTS.chunkSize, TRAINING_DEFAULTS.chunkMax));
      const ov = Number(item.overlap ?? TRAINING_DEFAULTS.overlap);
      item.overlap = Math.max(0, Math.min(Number.isFinite(ov) && ov >= 0 ? Math.floor(ov) : TRAINING_DEFAULTS.overlap, TRAINING_DEFAULTS.overlapMax));
      item.replace = item.replace !== false;
      if (item.autoRun !== undefined) item.autoRun = item.autoRun === true;
      break;
    }
  }
  return { ok: errors.length === 0, errors, warnings, item };
}

/* ---------------------------------------------------------------- memory config + text engine */

export function resolveMemory(agent: { id?: string; memory?: AgentMemoryConfig | null }, defaults: Partial<typeof MEMORY_DEFAULTS> = {}): ResolvedMemory {
  const d = { ...MEMORY_DEFAULTS, ...defaults };
  const m = agent.memory ?? {};
  const num = (v: unknown, fb: number) => { const n = Number(v); return v === undefined || v === null || v === '' || !Number.isFinite(n) || n <= 0 ? fb : Math.floor(n); };
  return {
    type: (m.type || d.type) as MemoryType, scope: m.scope || agent.id || '', topK: num(m.topK, d.topK), window: num(m.window, d.window), maxItems: num(m.maxItems, d.maxItems),
    record: m.record || d.record, decayDays: m.decayDays && Number(m.decayDays) > 0 ? Math.floor(Number(m.decayDays)) : d.decayDays, embedProfile: m.embedProfile || '',
    minScore: m.minScore && Number(m.minScore) > 0 ? Number(m.minScore) : d.minScore,
  };
}

const WORD = /[a-z0-9][a-z0-9_.+#-]*/g;
const STOP = new Set('a an the and or but if then else of to in on at for with by from is are was were be been being it its this that these those i you he she we they me my your our their as not no do does did have has had can could will would should may might just so than too very what which who whom how when where why all any some such own same other into over under again further once here there about out up down off'.split(' '));
/** Lower-case word tokens without stop words or single characters (same on every port). */
export function memoryTokens(text: string): string[] {
  return (text.toLowerCase().match(WORD) ?? []).filter((w) => !STOP.has(w) && w.length > 1);
}

/** BM25 ranking of memory items for a query: [score, index] pairs, best first, zero scores dropped. Rounded to 6 decimals. */
export function bm25Rank(query: string, docs: { text: string; tags?: string[] }[], k1 = 1.4, b = 0.75): [number, number][] {
  const q = memoryTokens(query);
  if (!q.length || !docs.length) return [];
  const toks = docs.map((d) => memoryTokens(`${d.text} ${(d.tags ?? []).join(' ')}`));
  const avg = toks.reduce((s, t) => s + t.length, 0) / Math.max(1, toks.length);
  const df = new Map<string, number>();
  for (const t of toks) for (const w of new Set(t)) df.set(w, (df.get(w) ?? 0) + 1);
  const n = docs.length;
  const out: [number, number][] = [];
  toks.forEach((t, i) => {
    const tf = new Map<string, number>();
    for (const w of t) tf.set(w, (tf.get(w) ?? 0) + 1);
    let s = 0;
    for (const w of q) {
      const f = tf.get(w);
      if (!f) continue;
      const d = df.get(w) ?? 0;
      const idf = Math.log(1 + (n - d + 0.5) / (d + 0.5));
      s += idf * f * (k1 + 1) / (f + k1 * (1 - b + b * t.length / Math.max(1, avg)));
    }
    if (s > 0) out.push([Math.round(s * 1e6) / 1e6, i]);
  });
  return out.sort((x, y) => y[0] - x[0] || x[1] - y[1]);
}

/** Split text on headings/paragraphs into ~size-character chunks with a little overlap. */
export function chunkText(text: string, size = TRAINING_DEFAULTS.chunkSize, overlap = TRAINING_DEFAULTS.overlap): string[] {
  const t = text.trim().replace(/\n{3,}/g, '\n\n');
  if (t.length <= size) return t ? [t] : [];
  const paras = t.split(/\n(?=#{1,6} )|\n\n/);
  const out: string[] = [];
  let cur = '';
  for (let p of paras) {
    if (cur.length + p.length + 2 <= size) { cur = cur ? `${cur}\n\n${p}` : p; continue; }
    if (cur) out.push(cur);
    while (p.length > size) { out.push(p.slice(0, size)); p = p.slice(size - overlap); }
    cur = (out.length && overlap ? out[out.length - 1]!.slice(-overlap) + '\n' : '') + p;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/** Which items to forget first when a store is over `maxItems`: episodes, then the least used, then the oldest. */
export function trimMemory<T extends { kind: string; hits?: number; createdAt: number }>(items: T[], maxItems: number): T[] {
  if (items.length <= maxItems) return items;
  const sorted = [...items].sort((a, b) => Number(a.kind !== 'episode') - Number(b.kind !== 'episode') || (a.hits ?? 0) - (b.hits ?? 0) || a.createdAt - b.createdAt);
  return sorted.slice(sorted.length - maxItems);
}

/* ---------------------------------------------------------------- system prompt */

export interface ComposeInput {
  agent: { id: string; name?: string; description?: string; instructions?: string };
  persona?: PersonaDef | null;
  skills?: SkillDef[];
  lingo?: LingoDef[];
  /** extra sections a host adds (container guide, safety notes), after the instructions */
  extras?: string[];
  /** the agent's memory is on → the memory section (and the host attaches the memory tools) */
  memory?: boolean;
  /** final tool names the model sees (after safety filtering, including memory and delegate tools) */
  tools?: string[];
}

/** The system prompt every port builds for an agent, section by section. */
export function composeSystemPrompt(input: ComposeInput): string {
  const a = input.agent;
  const parts: string[] = [`You are ${a.name || a.id}.` + (a.description ? ` ${a.description}` : '')];
  const p = input.persona;
  if (p) {
    const bits = [p.role ? `Role: ${p.role}` : '', p.voice ? `Voice: ${p.voice}` : '', p.tone ? `Tone: ${p.tone}` : ''];
    if (p.traits?.length) bits.push('Traits: ' + p.traits.join(', '));
    let txt = '## Persona\n' + bits.filter(Boolean).join('\n');
    if (p.rules?.length) txt += '\nRules:\n' + p.rules.map((r) => `- ${r}`).join('\n');
    if (p.samples?.length) txt += '\nSample replies (match this way of talking, not their content):\n' + p.samples.slice(0, 5).map((x) => `- ${x}`).join('\n');
    parts.push(txt);
  }
  if (input.skills?.length) {
    let txt = '## Skills';
    for (const s of input.skills) {
      txt += `\n\n### ${s.name ?? ''}\n${(s.instructions ?? '').trim()}`;
      if (s.triggers?.length) txt += `\nUse when: ${s.triggers.join(', ')}`;
      for (const ex of (s.examples ?? []).slice(0, 3)) if (ex.input) txt += `\nExample — input: ${ex.input.slice(0, 400)}\n          output: ${(ex.output ?? '').slice(0, 600)}`;
    }
    parts.push(txt);
  }
  if (input.lingo?.length) {
    let txt = '## Lingo';
    for (const L of input.lingo) {
      if (L.style) txt += `\nStyle: ${L.style}`;
      if (L.glossary?.length) txt += '\nGlossary (use these terms exactly):\n' + L.glossary.slice(0, 80).map((g) => `- ${g.term}: ${g.meaning}`).join('\n');
      if (L.phrases?.length) txt += '\nPreferred phrasing: ' + L.phrases.slice(0, 30).join('; ');
      if (L.avoid?.length) txt += '\nAvoid: ' + L.avoid.slice(0, 30).join('; ');
    }
    parts.push(txt);
  }
  if ((a.instructions ?? '').trim()) parts.push(`## Instructions\n${a.instructions!.trim()}`);
  for (const e of input.extras ?? []) if (e.trim()) parts.push(e.trim());
  if (input.memory) parts.push(MEMORY_SECTION);
  if (input.tools?.length) parts.push(TOOLS_SECTION_PREFIX + input.tools.join(', '));
  return parts.join('\n\n');
}

/* ---------------------------------------------------------------- workflows */

/** Fill `{{input}}`, `{{previous}}` and `{{steps.<id>}}` in a step prompt. */
export function fillWorkflowTemplate(tpl: string, input: string, steps: Record<string, string>, previous: string): string {
  return tpl.replace(/\{\{input\}\}/g, input).replace(/\{\{previous\}\}/g, previous).replace(/\{\{\s*steps\.([a-zA-Z0-9_-]+)\s*\}\}/g, (_m, id: string) => steps[id] ?? '');
}

/** The step ids a router agent picked (`{"steps": [...]}` anywhere in its reply), limited to real steps; empty when unreadable. */
export function parseRouterPick(reply: string, stepIds: string[]): string[] {
  const m = /\{[\s\S]*\}/.exec(reply);
  if (!m) return [];
  try {
    const j = JSON.parse(m[0]) as { steps?: unknown };
    const picked = Array.isArray(j.steps) ? j.steps.map(String) : [];
    return stepIds.filter((id) => picked.includes(id));
  } catch { return []; }
}

/** Fill a tool template `{{arg}}` from arguments; non-strings are JSON, URL mode percent-encodes. */
export function fillToolTemplate(template: string, args: Record<string, unknown>, url = false): string {
  return template.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (_m, k: string) => {
    const v = args[k];
    const s = v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v);
    return url ? encodeURIComponent(s) : s;
  });
}

/* ---------------------------------------------------------------- add-ons + library items */

export function validateAddon(raw: unknown): { ok: boolean; errors: string[]; bundle: AddonBundle | null } {
  const errors: string[] = [];
  if (!isObj(raw)) return { ok: false, errors: ['an add-on must be a JSON object'], bundle: null };
  if (raw.$axf !== AGENT_ADDON_TAG) errors.push(`not an agent add-on (expected "$axf": "${AGENT_ADDON_TAG}")`);
  if (!addonIdRe.test(String(raw.id ?? ''))) errors.push('add-on id must be lowercase letters, digits and dashes (2–48 characters)');
  if (!isObj(raw.provides)) errors.push('add-on has nothing in provides');
  else {
    for (const [k, v] of Object.entries(raw.provides)) {
      if (k === 'memory') { if (!isObj(v)) errors.push('provides.memory maps agent ids to lists of items'); continue; }
      if (!(ADDON_SECTIONS as readonly string[]).includes(k)) errors.push(`unknown section provides.${k}`);
      else if (!Array.isArray(v)) errors.push(`provides.${k} must be a list`);
      else for (const it of v) if (!isObj(it) || !it.id || !idRe.test(String(it.id))) errors.push(`every item in provides.${k} needs a valid id`);
    }
  }
  return { ok: errors.length === 0, errors, bundle: errors.length ? null : (raw as unknown as AddonBundle) };
}

/** What a tool record could do with the host's secrets or private network. */
export function toolRisks(tool: Record<string, unknown>, label = ''): string[] {
  const out: string[] = [];
  const cfg = isObj(tool.config) ? tool.config : {};
  const who = label ? `${label}: ` : '';
  for (const [k, v] of Object.entries(isObj(cfg.headers) ? cfg.headers : {})) if (typeof v === 'string' && v.startsWith('env:')) out.push(`${who}header ${k} reads environment variable ${v.slice(4)}`);
  if (cfg.allowPrivate) out.push(`${who}may call private/internal addresses`);
  if (cfg.tokenEnv) out.push(`${who}sends environment variable ${String(cfg.tokenEnv)} to ${String(cfg.url ?? 'its server')}`);
  return out;
}

export function addonRisks(bundle: AddonBundle): string[] {
  const out: string[] = [];
  for (const t of bundle.provides.tools ?? []) out.push(...toolRisks(t, `tool ${String(t.name ?? t.id)}`));
  for (const j of bundle.provides.training ?? []) for (const s of (Array.isArray(j.sources) ? j.sources : []) as Record<string, unknown>[]) if (s.tokenEnv) out.push(`training ${String(j.id)}: sends environment variable ${String(s.tokenEnv)} to ${String(s.url ?? '')}`);
  return out;
}

/** The same record without env-var headers, private access and MCP tokens (what an untrusted import keeps). */
export function stripToolRisks(tool: Record<string, unknown>): Record<string, unknown> {
  const t = JSON.parse(JSON.stringify(tool)) as Record<string, unknown>;
  const cfg = isObj(t.config) ? t.config : {};
  cfg.headers = Object.fromEntries(Object.entries(isObj(cfg.headers) ? cfg.headers : {}).filter(([, v]) => !(typeof v === 'string' && v.startsWith('env:'))));
  delete cfg.allowPrivate; delete cfg.tokenEnv;
  t.config = cfg;
  return t;
}

export function stripAddonRisks(bundle: AddonBundle): AddonBundle {
  const b = JSON.parse(JSON.stringify(bundle)) as AddonBundle;
  b.provides.tools = (b.provides.tools ?? []).map(stripToolRisks);
  for (const j of b.provides.training ?? []) for (const s of (Array.isArray(j.sources) ? j.sources : []) as Record<string, unknown>[]) delete s.tokenEnv;
  return b;
}

/** Everything an agent uses, as an add-on bundle ready to share or re-import. */
export function agentToAddon(agent: AgentDef & { id: string }, parts: { personas: PersonaDef[]; lingo: LingoDef[]; skills: SkillDef[]; tools: ToolDef[] }, memory: MemoryItem[] = []): AddonBundle {
  const clean = <T extends object>(x: T) => Object.fromEntries(Object.entries(x).filter(([k]) => !['createdAt', 'updatedAt', 'origin'].includes(k))) as Record<string, unknown>;
  return {
    $axf: AGENT_ADDON_TAG, id: `${agent.id}-export`.replace(/\./g, '-').slice(0, 48), name: agent.name ?? agent.id, version: '1.0.0', description: agent.description ?? '',
    provides: {
      personas: parts.personas.map(clean), lingo: parts.lingo.map(clean), skills: parts.skills.map(clean), tools: parts.tools.map(clean), agents: [clean(agent)],
      memory: { [agent.id]: memory.filter((d) => ['fact', 'knowledge', 'note'].includes(d.kind)).slice(0, 2000).map((d) => ({ kind: d.kind, text: d.text, tags: d.tags ?? [], source: d.source ?? '' })) },
    },
  };
}

/* ---------------------------------------------------------------- runtime contract (hosts implement it) */

/** What a chat host needs from an agent runtime; the console's `axf.agents@1` service has these exact methods. */
export interface AgentRuntime {
  listAgents(): Promise<{ id: string; name: string; icon?: string; description?: string; origin?: string; dangerous?: boolean }[]>;
  getAgent(id: string): Promise<ResolvedAgent | null>;
  memoryContext(id: string, query: string): Promise<string>;
  runTool(id: string, name: string, args: Record<string, unknown>, ctx?: Record<string, unknown>): Promise<string>;
  recordTurn(id: string, userText: string, reply: string, meta?: Record<string, unknown>): Promise<void>;
}
export interface ResolvedAgent {
  id: string; name?: string; icon?: string; description?: string; system_prompt: string; model: AgentModel;
  tools: { name: string; description: string; parameters: Record<string, unknown> }[]; memory: { type: string }; voice?: AgentVoice | null;
  writeMode?: { containers: string[]; snapshots: boolean } | null;
}

/** Kernel default until a module provides agents: lists nothing, never pretends to run anything. */
export const placeholderAgentRuntime: AgentRuntime = {
  listAgents: async () => [],
  getAgent: async () => null,
  memoryContext: async () => '',
  runTool: async (_id, name) => { throw new Error(`no agent runtime provides ${AGENTS_CAPABILITY}: cannot run ${name}`); },
  recordTurn: async () => undefined,
};
