/* Agent manager — web API layer and shared types. */
import { pluginFetch } from '@console/plugins';

export const FOLDER = 'agent-manager';
export const ID = 'ai.amberx.axf.console.agent-manager';

export type Coll = 'agents' | 'skills' | 'personas' | 'lingo' | 'tools' | 'workflows' | 'training';
interface Base { id: string; name: string; origin?: string; createdAt?: number; updatedAt?: number; tags?: string[]; forkedFrom?: string }
export interface MemoryCfg { type?: string; record?: string; topK?: number; window?: number; maxItems?: number; decayDays?: number; scope?: string; embedProfile?: string }
export interface ModelCfg { profile?: string; model?: string; temperature?: number; max_tokens?: number }
export interface Voice { provider?: string; voiceId?: string; hint?: string }
export interface Agent extends Base { voice?: Voice | null; icon?: string; description?: string; enabled?: boolean; personaId?: string; lingoIds?: string[]; skillIds?: string[]; toolIds?: string[]; delegates?: string[]; instructions?: string; model?: ModelCfg; memory?: MemoryCfg }
export interface Skill extends Base { description?: string; instructions?: string; triggers?: string[]; examples?: { input: string; output: string }[]; toolIds?: string[] }
export interface Persona extends Base { role?: string; voice?: string; tone?: string; traits?: string[]; rules?: string[]; samples?: string[]; voiceSlot?: Voice | null }
export interface Lingo extends Base { description?: string; style?: string; glossary?: { term: string; meaning: string }[]; phrases?: string[]; avoid?: string[] }
export interface JsonSchema { type?: string; properties?: Record<string, { type?: string; description?: string; enum?: string[]; items?: { type?: string } }>; required?: string[] }
export interface Tool extends Base { dangerous?: boolean; description?: string; kind: string; config: Record<string, unknown>; parameters?: JsonSchema; enabled?: boolean }
export interface Step { id: string; agentId: string; prompt?: string; label?: string; when?: string; memory?: boolean }
export interface Workflow extends Base { description?: string; mode: string; steps: Step[]; routerAgentId?: string; synthAgentId?: string; maxLoops?: number }
export interface Source { type: string; url?: string; query?: string; limit?: number; include?: string[]; paths?: string[]; title?: string; text?: string; tokenEnv?: string; uri?: string; tool?: string; args?: Record<string, unknown> }
export interface Training extends Base { agentId: string; sources: Source[]; chunkSize?: number; overlap?: number; replace?: boolean; schedule?: string; tags?: string[]; status?: string; lastRun?: number; lastAdded?: number; nextRun?: number | null; log?: string[]; autoRun?: boolean }
export interface MemItem { id: string; kind: string; text: string; tags?: string[]; source?: string; createdAt: number; hits?: number; score?: number }
export interface MemStats { scope: string; items: number; byKind: Record<string, number>; summary: boolean; vectors: number; bytes: number }
export interface Status {
  version: string; contract: string; counts: Record<Coll, number>; assistant: boolean; firecrawl: boolean; trainingRunning: string[]; schedulerTick: number;
  llm: { source: 'assistant' | 'own'; profiles: { id: string; label: string; defaultModel: string; ready?: boolean }[]; kind?: string; model?: string; ready?: boolean };
  addons: { available: number; installed: number }; memoryTypes: string[]; memoryKinds: string[]; toolKinds: string[]; builtins: Record<string, string>; dangerousBuiltins: string[];
  sourceTypes: string[]; workflowModes: string[]; services: { containers: boolean; snapshots: boolean }; safety: { dangerousAgents: string[] };
}
export interface Addon { id: string; name: string; version: string; description: string; author?: string; icon?: string; source: string; provides: Record<string, number>; installed: boolean; installedVersion?: string; updateAvailable?: boolean; risks?: string[]; agents?: { id: string; name: string }[] }
export interface Validation<T = Record<string, unknown>> { ok: boolean; errors: string[]; warnings: string[]; item: T }
export interface MemScope extends MemStats { agents: string[]; orphan: boolean }
export interface Run { id: string; at: number; kind: string; name?: string; agentId?: string; workflowId?: string; input?: string; output?: string; status?: string; added?: number; trace?: { step: string; agent: string; output: string; chosen?: string[] }[]; log?: string[]; tools?: { tool: string; ok: boolean; preview: string }[] }
export interface Settings {
  llm: { kind: string; baseUrl: string; keyEnv: string; model: string; embedModel: string; hasKey: boolean; envPresent: boolean };
  firecrawl: { baseUrl: string; version: string; keyEnv: string; hasKey: boolean; envPresent: boolean };
  defaults: { memoryType: string; topK: number; window: number; maxItems: number }; preferAssistant: boolean; scheduler: boolean;
  safety: { dangerousAgents: string[] };
}

export async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await pluginFetch(FOLDER, path, init);
  const j = (await r.json().catch(() => ({}))) as T & { detail?: unknown };
  if (r.status === 401) throw new Error('Console token required (Settings → Account & security).');
  if (r.status === 404 && !j.detail) throw new Error('The agent manager plugin is disabled or its server part is not running.');
  if (!r.ok) throw new Error(typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail ?? r.statusText));
  return j;
}
export const post = <T,>(path: string, body: unknown = {}) => call<T>(path, { method: 'POST', body: JSON.stringify(body) });
export const put = <T,>(path: string, body: unknown) => call<T>(path, { method: 'PUT', body: JSON.stringify(body) });
export const del = <T,>(path: string) => call<T>(path, { method: 'DELETE' });

export const list = <T,>(c: Coll) => call<{ items: T[] }>(`c/${c}`).then((r) => r.items);
export const save = <T,>(c: Coll, item: unknown) => post<{ item: T }>(`c/${c}`, item).then((r) => r.item);
export const remove = (c: Coll, id: string) => del(`c/${c}/${id}`);
/** Dry run through the contract validator (agent-definition@1): errors, warnings and the normalised item; nothing saved. */
export const validate = <T,>(c: Coll, item: unknown) => post<Validation<T>>(`validate/${c}`, item);
export const isDangerousTool = (t: { dangerous?: boolean; kind?: string; config?: Record<string, unknown> }, status?: Status) =>
  !!t.dangerous || (t.kind === 'builtin' && (status?.dangerousBuiltins ?? []).includes(String(t.config?.builtin ?? ''))) || String(t.config?.builtin ?? '').startsWith('container_');

/** Streams a workflow run (SSE): step / step_done while it works, then done or error. Returns a stop function. */
export function streamWorkflow(id: string, input: string, on: (event: string, data: Record<string, unknown>) => void): () => void {
  const ac = new AbortController();
  void (async () => {
    try {
      const r = await pluginFetch(FOLDER, `workflows/${id}/run/stream`, { method: 'POST', body: JSON.stringify({ input }), signal: ac.signal });
      if (!r.ok || !r.body) { on('error', { error: r.status === 404 ? 'workflow not found' : `HTTP ${r.status}` }); return; }
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          const ev = /^event: (.+)$/m.exec(block)?.[1] ?? 'message';
          const dl = block.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('\n');
          try { on(ev, JSON.parse(dl || '{}') as Record<string, unknown>); } catch { on(ev, { raw: dl }); }
        }
      }
    } catch (e) { if (!ac.signal.aborted) on('error', { error: (e as Error).message }); }
  })();
  return () => ac.abort();
}

/* A small cache of every collection, refreshed after writes, shared by all views and wizards. */
export interface Cache { agents: Agent[]; skills: Skill[]; personas: Persona[]; lingo: Lingo[]; tools: Tool[]; workflows: Workflow[]; training: Training[] }
let cache: Cache | undefined;
let status: Status | undefined;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
export const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export const getCache = () => cache;
export const getStatus = () => status;
export async function refresh(): Promise<void> {
  const [agents, skills, personas, lingo, tools, workflows, training, st] = await Promise.all([
    list<Agent>('agents'), list<Skill>('skills'), list<Persona>('personas'), list<Lingo>('lingo'), list<Tool>('tools'), list<Workflow>('workflows'), list<Training>('training'), call<Status>('status'),
  ]);
  cache = { agents, skills, personas, lingo, tools, workflows, training };
  status = st;
  emit();
}

export const fmtTime = (ms?: number | null) => (ms ? new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
export const lines = (v?: string[]) => (v ?? []).join('\n');
export const unlines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);
export const originLabel = (o?: string) => (!o || o === 'user' ? '' : o.startsWith('addon:') ? `add-on ${o.slice(6)}` : o);

export function download(name: string, data: unknown) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export const MEMORY_HELP: Record<string, string> = {
  none: 'No memory: every conversation starts fresh.',
  buffer: 'Recalls the last few exchanges in order.',
  summary: 'Keeps one rolling summary the model rewrites after each exchange.',
  keyword: 'Searches every stored item by keywords (BM25) and recalls the best matches.',
  vector: 'Semantic search with embeddings (needs an embedding model; falls back to keywords).',
  hybrid: 'Summary + best search matches + the last few exchanges. Recommended.',
};
export const RECORD_HELP: Record<string, string> = { both: 'exchanges + extracted facts', episodes: 'exchanges only', facts: 'extracted facts only', off: 'record nothing (read-only memory)' };
export const SOURCE_HELP: Record<string, string> = {
  'firecrawl-scrape': 'One web page → clean Markdown (Firecrawl)', 'firecrawl-crawl': 'A whole site section (Firecrawl)', 'firecrawl-search': 'Web search results (Firecrawl)',
  url: 'A public page (plain fetch, no Firecrawl)', repo: 'Files from the AXF repo (globs)', text: 'Pasted text', 'mcp-resource': 'A resource from an MCP server', 'mcp-tool': 'Output of an MCP tool call',
};
export const KIND_HELP: Record<string, string> = {
  builtin: 'A ready-made tool (repo, web, memory, Firecrawl, time, calculator)', http: 'Call an HTTP API', mcp: 'Call a tool on an MCP server',
  prompt: 'A sub-prompt run on a model', agent: 'Delegate to another agent', workflow: 'Run a workflow',
};
