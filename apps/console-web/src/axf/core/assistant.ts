/*
 * AI assistant — assistant@1 (kernel contract, web reference). Same design as the Kotlin kernel's
 * `ai.amberx.axf.kernel.assistant` (Assistant.kt) and the Python port `framework/python/axf/contracts/assistant.py`;
 * conformance fixtures: spec/fixtures/assistant.json (gen-fixtures.mts).
 *
 * What every AXF app shares when it ships an assistant (the Dev Console today, Build Pilot next, Android later):
 *   - the provider registry (framework/schemas/ai-providers.json): kinds, protocols, key env names, suggested models;
 *   - the canonical chat message + stream event shapes every provider protocol maps to;
 *   - the conversation record (ai-conversation@1) and its per-conversation settings;
 *   - the turn event stream a host emits (start/text/thinking/status/tool/batch/error/done) over a live session;
 *   - pure rules every port must apply the same way: secret redaction, the history window sent to a model,
 *     the provider fallback chain, what a non-admin may set and how their params are clamped, permission
 *     wildcards, batch titles and tool-argument summaries;
 *   - a transport-agnostic `AssistantClient` an app's UI talks to, plus `HttpAssistantClient` for any web app that
 *     reaches an assistant server over HTTP + SSE (the console plugin's routes are the reference API).
 *
 * The kernel ships the contract and the client; the chat engine (providers, tools, sessions) is a host
 * module/plugin — in the console, plugins/ai-assistant (capability `axf.llm@1`). Nothing here is console-specific.
 */
import providerRegistry from '../schemas/ai-providers.json';
import type { LiveReplay, LiveSessionInfo } from './live-session';
import { readSse, type SseFrame } from './sse';

/** SSE framing is shared (./sse); re-exported here so assistant@1 code keeps importing it from the contract. */
export { parseSseBlock, parseSseText, sseLine, type SseFrame } from './sse';

export const ASSISTANT_CONTRACT = 'assistant@1';
export const CONVERSATION_CONTRACT = 'ai-conversation@1';
/** Capability the chat engine registers under (the console plugin provides `axf.llm@1` to other plugins). */
export const LLM_CAPABILITY = 'axf.llm';

// ---------------------------------------------------------------- providers

/** Wire protocol a provider kind speaks; the set is open (a module may register another by name). */
export type ProviderProtocol = 'openai' | 'anthropic' | 'claude-cli' | (string & {});

export interface ProviderKind {
  kind: string;
  label: string;
  protocol: ProviderProtocol;
  baseUrl: string;
  keyEnv: string;
  /** how the key travels: bearer | x-api-key | api-key | oauth | none */
  auth: string;
  models: string[];
  keyUrl: string;
  vision?: boolean;
  tools?: boolean;
  local?: boolean;
  note?: string;
  noModelList?: boolean;
  noStreamUsage?: boolean;
  maxTokensField?: string;
  headers?: Record<string, string>;
  embedModel?: string;
}

export interface ProviderRegistry { $axf: 'ai-providers@1'; protocols: Record<string, string>; providers: ProviderKind[] }

/** The framework's registry (framework/schemas/ai-providers.json). Apps may merge their own kinds on top. */
export const PROVIDER_REGISTRY: ProviderRegistry = providerRegistry as ProviderRegistry;
export const PROVIDER_KINDS: ProviderKind[] = PROVIDER_REGISTRY.providers;

/** Framework kinds plus an app's own; a later kind with the same id replaces the earlier (open registry). */
export function mergeProviderKinds(...lists: ProviderKind[][]): ProviderKind[] {
  const out = new Map<string, ProviderKind>();
  for (const l of lists) for (const k of l) if (k && typeof k.kind === 'string' && k.kind) out.set(k.kind, k);
  return [...out.values()];
}

export function providerKind(kind: string, kinds: ProviderKind[] = PROVIDER_KINDS): ProviderKind | undefined {
  return kinds.find((k) => k.kind === kind);
}

/** A configured provider as the browser sees it: never the key itself. */
export interface ProviderProfile {
  id: string;
  kind: string;
  label: string;
  baseUrl: string;
  auth: string;
  keyEnv: string;
  hasKey: boolean;
  envPresent: boolean;
  keyReady: boolean;
  defaultModel: string;
  models: string[];
  embedModel: string;
  enabled: boolean;
  headers: Record<string, string>;
  lastTest?: { at: number; ok: boolean; ms?: number; reply?: string; error?: string; model?: string } | null;
  createdAt?: number;
}

// ---------------------------------------------------------------- canonical chat

export interface ChatImage { media_type: string; data: string; name?: string }
export interface ToolCall { id: string; name: string; arguments: Record<string, unknown> }
export interface ToolSpec { name: string; description: string; parameters?: Record<string, unknown> }

/** The one message shape every protocol maps to (and back). */
export interface WireMessage {
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  images?: ChatImage[];
  tool_calls?: ToolCall[];
  thinking_blocks?: Record<string, unknown>[];
  tool_call_id?: string;
  is_error?: boolean;
}

/** What a provider stream yields; the engine turns these into turn events. */
export type ProviderEvent =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'thinking_block'; block: Record<string, unknown> }
  | { type: 'tool_call'; id: string; name: string; arguments: Record<string, unknown> }
  | { type: 'tool_done'; id: string; name: string; arguments?: Record<string, unknown>; ok: boolean; result: string }
  | { type: 'usage'; input: number; output: number }
  | { type: 'status'; text: string }
  | { type: 'stop'; reason: string };

export interface ToolLogEntry { id: string; name: string; input: string; ok: boolean; preview: string }

/** A stored message (ai-conversation@1). `meta.step` marks an intermediate assistant round with tool calls. */
export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  createdAt: number;
  images?: ChatImage[];
  toolCalls?: ToolCall[];
  toolCallId?: string;
  isError?: boolean;
  thinkingBlocks?: Record<string, unknown>[];
  meta?: {
    step?: boolean; profile?: string; model?: string; latencyMs?: number; usage?: { input: number; output: number }; tools?: ToolLogEntry[];
    agentId?: string; agentName?: string; stopped?: boolean; interrupted?: boolean; thinking?: string; context?: ChatContext | null; batch?: string; lastRound?: string;
  };
}

/**
 * What the app attaches to a turn: the view it was sent from, its title, selected text, a note — plus `extra`, an
 * open bag for host-specific context (Build Pilot's `projectId`, …). Well-known keys live in `CHAT_CONTEXT_KEYS`; any
 * other key passes through untouched, so a host never needs a one-off field. `normalizeChatContext` is the rule every
 * port applies before storing or using a context (sizes capped, bad shapes dropped).
 */
export interface ChatContext { view?: string; title?: string; selection?: string; note?: string; extra?: Record<string, unknown> }

/** Well-known `extra` keys (documented in spec/ASSISTANT.md); hosts may add their own. */
export const CHAT_CONTEXT_KEYS = {
  /** id of the project the chat is about (Build Pilot); 1–64 chars */
  projectId: 'projectId',
  /** id of the app (`axf.manifest.json` name or project manifest name) the chat is about */
  appId: 'appId',
  /** path of the file the user is looking at, relative to the app */
  path: 'path',
  /** route/page id when `view` is not enough */
  route: 'route',
} as const;

/** Size limits for a context (the same on every port, so a context can't be abused as a payload channel). */
export const CHAT_CONTEXT_LIMITS = {
  view: 200, title: 300, selection: 4000, note: 2000,
  /** at most this many keys in `extra` */
  extraKeys: 32,
  /** each `extra` key: 1–64 characters, `[A-Za-z0-9_.-]` */
  extraKey: 64,
  /** a string value in `extra` is cut to this length */
  extraString: 2000,
  /** `extra` serialised as JSON may not exceed this many characters */
  extraJson: 16_000,
  /** nesting depth allowed inside an `extra` value (objects/arrays) */
  extraDepth: 4,
} as const;

const EXTRA_KEY = /^[A-Za-z0-9_.-]{1,64}$/;

function boundedValue(v: unknown, depth: number): unknown {
  if (v === null || typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string') return v.slice(0, CHAT_CONTEXT_LIMITS.extraString);
  if (depth >= CHAT_CONTEXT_LIMITS.extraDepth) return undefined;
  if (Array.isArray(v)) {
    const out: unknown[] = [];
    for (const x of v.slice(0, CHAT_CONTEXT_LIMITS.extraKeys)) { const b = boundedValue(x, depth + 1); if (b !== undefined) out.push(b); }
    return out;
  }
  if (typeof v === 'object') {
    const out: Record<string, unknown> = {};
    let n = 0;
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (!EXTRA_KEY.test(k)) continue;
      const b = boundedValue(x, depth + 1);
      if (b === undefined) continue;
      out[k] = b;
      if (++n >= CHAT_CONTEXT_LIMITS.extraKeys) break;
    }
    return out;
  }
  return undefined; // functions, symbols, bigints never travel
}

/**
 * The context a host stores and uses: known fields cut to their limits, `extra` kept as an open bag with every key it
 * came with (unknown keys preserved, in order) but bounded: key pattern, ≤ 32 keys, strings ≤ 2000, depth ≤ 4,
 * ≤ 16 000 JSON characters in all (an oversized `extra` is dropped whole, never truncated into a different meaning).
 * Returns null for anything that isn't an object or has nothing left.
 */
export function normalizeChatContext(raw: unknown): ChatContext | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const out: ChatContext = {};
  for (const k of ['view', 'title', 'selection', 'note'] as const) {
    const v = r[k];
    if (typeof v === 'string' && v) out[k] = v.slice(0, CHAT_CONTEXT_LIMITS[k]);
  }
  if (r.extra && typeof r.extra === 'object' && !Array.isArray(r.extra)) {
    const extra = boundedValue(r.extra, 0) as Record<string, unknown>;
    if (Object.keys(extra).length && JSON.stringify(extra).length <= CHAT_CONTEXT_LIMITS.extraJson) out.extra = extra;
  }
  return Object.keys(out).length ? out : null;
}

/** A well-known `extra` value as a string (empty when absent or not a string); what a host reads `projectId` with. */
export function contextExtra(ctx: ChatContext | null | undefined, key: string): string {
  const v = ctx?.extra?.[key];
  return typeof v === 'string' ? v : '';
}

export interface ConversationSettings {
  profileId?: string; model?: string; temperature?: number; max_tokens?: number; top_p?: number;
  systemPrompt?: string; agentId?: string; tools?: boolean; thinking?: boolean;
}
export const CONVERSATION_SETTING_KEYS: (keyof ConversationSettings)[] = ['profileId', 'model', 'temperature', 'max_tokens', 'top_p', 'systemPrompt', 'agentId', 'tools', 'thinking'];

export interface Conversation {
  $axf?: typeof CONVERSATION_CONTRACT;
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
  archived: boolean;
  tags: string[];
  settings: ConversationSettings;
  messages: Message[];
  /** a hub user's conversation; admins' have none */
  owner?: string;
}

export interface ConversationSummary {
  id: string; title: string; pinned: boolean; archived: boolean; tags: string[]; updatedAt: number; createdAt?: number;
  messages: number; agentId: string; owner?: string; preview: string;
}

export interface AgentRef { id: string; name: string; icon?: string; description?: string; origin?: string; dangerous?: boolean; writeMode?: WriteMode | null }
export interface WriteMode { containers: string[]; snapshots: boolean }

/** The events a host emits for one turn (owner kinds on the live session; never a reserved lifecycle kind). */
export type TurnEvent =
  | { event: 'start'; data: { turnId: string; agent: AgentRef | null } }
  | { event: 'text' | 'thinking' | 'status'; data: { text: string } }
  | { event: 'tool'; data: { phase: 'call' | 'result'; id: string; name: string; input?: string; ok?: boolean; preview?: string } }
  | { event: 'error'; data: { message: string } }
  | { event: 'batch'; data: { batch: unknown } }
  | { event: 'done'; data: { message: Message; title: string } };

/** Live-session framing around turn events (live-session@1); a chat view may ignore them. */
export type SessionFrame =
  | { event: 'replay'; data: LiveReplay & { state: string; lastSeq: number } }
  | { event: 'session'; data: { state: string; lastSeq: number } }
  | { event: 'session.open' | 'session.close' | 'turn.start' | 'turn.end' | 'wait' | 'resume' | 'interrupted'; data: unknown };
export type StreamEvent = (TurnEvent | SessionFrame) & { seq?: number };
export const TURN_EVENT_KINDS = ['start', 'text', 'thinking', 'status', 'tool', 'error', 'batch', 'done'] as const;

// ---------------------------------------------------------------- pure rules (fixture-checked on every port)

/** Keys and tokens that must never leave the app in a message (the same list on every port). */
export const SECRET_PATTERN = /\b(sk-(?:ant-|proj-)?[A-Za-z0-9_\-]{20,}|xai-[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_\-]{30,}|fc-[a-f0-9]{24,})\b/g;
export const REDACTED = '[redacted secret]';

export function redactSecrets(text: string, on = true): string {
  return on && text ? text.replace(SECRET_PATTERN, REDACTED) : text;
}

/**
 * The window of stored messages sent to a model: the last `limit` user turns with the assistant steps and tool
 * results between them, never starting on an orphaned tool result, in the canonical wire shape. A final
 * assistant message that follows tool results carries only its last round (`meta.lastRound`): the earlier
 * rounds' text already sits in the step messages.
 */
export function wireHistory(msgs: Message[], limit: number): WireMessage[] {
  const keep: Message[] = [];
  let turns = 0;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i]!;
    if (m.role === 'user') turns++;
    keep.push(m);
    if (turns >= limit) break;
  }
  keep.reverse();
  while (keep.length && keep[0]!.role === 'tool') keep.shift();
  return keep.map((m, i) => {
    let content = m.content ?? '';
    const prev = i ? keep[i - 1] : undefined;
    if (m.role === 'assistant' && !m.meta?.step && prev && prev.role === 'tool') content = m.meta?.lastRound ?? content;
    const w: WireMessage = { role: m.role, content };
    if (m.images?.length) w.images = m.images;
    if (m.toolCalls?.length) w.tool_calls = m.toolCalls;
    if (m.thinkingBlocks?.length) w.thinking_blocks = m.thinkingBlocks;
    if (m.role === 'tool') { w.tool_call_id = m.toolCallId ?? ''; w.is_error = !!m.isError; }
    return w;
  });
}

/** Provider profiles to try in order: the conversation's, else the agent's, else the default, then the fallbacks (no repeats). */
export function profileChain(settings: { profileId?: string } | undefined, agentProfile: string | undefined, defaultProfile: string, fallback: string[]): string[] {
  const chain = [settings?.profileId || agentProfile || defaultProfile || '', ...fallback].filter(Boolean);
  const out = [...new Set(chain)];
  return out.length ? out : [''];
}

/** Admins may set every conversation setting; users only what their hub permissions allow. */
export function settingsAllowedFor(admin: boolean, can: (perm: string) => boolean): (keyof ConversationSettings)[] {
  if (admin) return [...CONVERSATION_SETTING_KEYS];
  const keys: (keyof ConversationSettings)[] = ['temperature', 'top_p', 'systemPrompt', 'tools'];
  if (can('assistant.agents')) keys.push('agentId');
  if (can('assistant.models')) keys.push('profileId', 'model', 'max_tokens', 'thinking');
  return keys;
}

/** Permission check with `a.b.*` wildcards and `*`; admins always pass (the hub's rule, mirrored in the console's wall.py). */
export function permissionAllows(perms: Iterable<string>, perm: string, admin = false): boolean {
  if (admin) return true;
  const set = new Set(perms);
  if (set.has('*') || set.has(perm)) return true;
  const parts = perm.split('.');
  for (let i = 1; i < parts.length; i++) if (set.has(parts.slice(0, i).join('.') + '.*')) return true;
  return false;
}

export const USER_MAX_TOKENS = 4096;
export const USER_MAX_TOKENS_WITH_MODELS = 16384;

/** Non-admin callers: max_tokens clamped (256…4096, or …16384 with assistant.models) and thinking off without assistant.models. */
export function clampUserParams(params: Record<string, unknown>, admin: boolean, canModels: boolean): Record<string, unknown> {
  if (admin) return { ...params };
  const out = { ...params };
  const raw = Number(out.max_tokens ?? USER_MAX_TOKENS);
  const n = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : USER_MAX_TOKENS;
  out.max_tokens = Math.max(256, Math.min(n, canModels ? USER_MAX_TOKENS_WITH_MODELS : USER_MAX_TOKENS));
  if (!canModels) out.thinking = false;
  return out;
}

/** Title of a change batch proposed in a reply. */
export function batchTitle(userText: string, n: number): string {
  const t = (userText || '').replace(/\s+/g, ' ').trim();
  const count = `${n} change${n === 1 ? '' : 's'}`;
  return t ? `${count}: ${t.slice(0, 80)}${t.length > 80 ? '…' : ''}` : count;
}

const SUMMARY_KEYS = ['path', 'command', 'pattern', 'url', 'query', 'expression', 'dir', 'name', 'id', 'container'];
/** One line describing a tool call's arguments for the activity log (never the full content). */
export function summarizeArgs(args: Record<string, unknown>): string {
  for (const k of SUMMARY_KEYS) { const v = args[k]; if (typeof v === 'string' && v) return v.slice(0, 160); }
  const s = JSON.stringify(args).slice(0, 160);
  return s === '{}' ? '' : s;
}

/** A conversation's first title: its first user message, one line, 60 characters. */
export function titleFromText(text: string, max = 60): string {
  return (text || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Owner event kinds written to a live session must never pose as lifecycle kinds; hosts rename them `owner.<kind>`. */
export function ownerKind(kind: string, reserved: Iterable<string>): string {
  return new Set(reserved).has(kind) ? `owner.${kind}` : kind;
}

// ---------------------------------------------------------------- SSE (what a host streams, what a client parses)
// Framing (parseSseBlock / parseSseText / sseLine / SseFrame) lives in ./sse, shared by every AXF web app.

/** A frame → stream event (data parsed as JSON when it is JSON). */
export function frameToEvent(f: SseFrame): StreamEvent {
  let data: unknown = f.data;
  try { data = JSON.parse(f.data); } catch { /* plain text data */ }
  return { event: f.event, data, ...(f.id === undefined ? {} : { seq: f.id }) } as StreamEvent;
}

/** Read a streaming Response body as stream events until it ends (an aborted fetch rejects with AbortError). */
export async function readStreamEvents(body: ReadableStream<Uint8Array>, onEvent: (e: StreamEvent) => void): Promise<void> {
  await readSse(body, (f) => onEvent(frameToEvent(f)));
}

// ---------------------------------------------------------------- client (what an app's chat UI talks to)

export interface TurnInput { content?: string; images?: ChatImage[]; context?: ChatContext; editMessageId?: string; regenerate?: boolean }
export interface AssistantStatus {
  assistantName: string; setupComplete: boolean; needsSetup: boolean; defaultProfile: ProviderProfile | null; profiles: number; ready: number;
  cliInstalled: boolean; integrations: { agents: boolean; agentCount: number }; agents: AgentRef[]; defaultAgent: string; tokensToday: number; budget: number;
  suggestions: string[]; prompts: { id: string; title: string; shortcut: string; text: string }[]; showUsage: boolean; me?: { name: string; role: string; perms: string[] };
}

/**
 * Transport-agnostic assistant client. The console plugin's HTTP API is the reference; Build Pilot or an Android app
 * implement the same methods over their own transport (HTTP, AXPP, in-process). Replies are live sessions: `send`
 * only watches, `follow` reattaches by seq, and aborting a watch never stops the reply.
 */
export interface AssistantClient {
  status(): Promise<AssistantStatus>;
  listConversations(q?: string, archived?: boolean): Promise<ConversationSummary[]>;
  createConversation(settings?: ConversationSettings, title?: string): Promise<Conversation>;
  getConversation(id: string): Promise<Conversation>;
  patchConversation(id: string, patch: { title?: string; pinned?: boolean; archived?: boolean; tags?: string[]; settings?: Partial<ConversationSettings> }): Promise<Conversation>;
  deleteConversation(id: string): Promise<void>;
  fork(id: string, messageId?: string): Promise<Conversation>;
  deleteMessage(id: string, messageId: string): Promise<Conversation>;
  send(id: string, input: TurnInput, onEvent: (e: StreamEvent) => void, signal?: AbortSignal): Promise<void>;
  follow(id: string, since: number, onEvent: (e: StreamEvent) => void, signal?: AbortSignal): Promise<void>;
  session(id: string): Promise<LiveSessionInfo | null>;
  stop(id: string): Promise<boolean>;
  closeSession(id: string): Promise<boolean>;
}

export class AssistantHttpError extends Error {
  constructor(message: string, public readonly status: number) { super(message); this.name = 'AssistantHttpError'; }
}

export interface HttpClientOptions {
  /** base URL of the assistant API, e.g. `/api/plugins/ai-assistant` (no trailing slash) */
  base: string;
  /** fetch with the app's auth (the console's pluginFetch adds the console token); defaults to global fetch */
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  /** Message for a 401 (missing app token) and for a 404 without detail (assistant off); apps word these for their users. */
  messages?: { unauthorized?: string; unavailable?: string };
}

/** `AssistantClient` over the reference HTTP + SSE API (the console plugin's routes). */
export class HttpAssistantClient implements AssistantClient {
  private readonly f: (url: string, init?: RequestInit) => Promise<Response>;
  constructor(private readonly opt: HttpClientOptions) {
    this.f = opt.fetch ?? ((u, i) => fetch(u, i));
  }
  url(path: string) { return `${this.opt.base.replace(/\/$/, '')}/${path.replace(/^\//, '')}`; }

  async call<T>(path: string, init?: RequestInit): Promise<T> {
    const r = await this.f(this.url(path), { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
    const j = (await r.json().catch(() => ({}))) as T & { detail?: unknown };
    if (r.status === 401) throw new AssistantHttpError(this.opt.messages?.unauthorized ?? 'Sign-in or app token required.', 401);
    if (r.status === 404 && !j.detail) throw new AssistantHttpError(this.opt.messages?.unavailable ?? 'The assistant is disabled or its server is not running.', 404);
    if (!r.ok) throw new AssistantHttpError(typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail ?? r.statusText), r.status);
    return j;
  }
  post<T>(path: string, body: unknown) { return this.call<T>(path, { method: 'POST', body: JSON.stringify(body) }); }
  put<T>(path: string, body: unknown) { return this.call<T>(path, { method: 'PUT', body: JSON.stringify(body) }); }
  patch<T>(path: string, body: unknown) { return this.call<T>(path, { method: 'PATCH', body: JSON.stringify(body) }); }
  del<T>(path: string) { return this.call<T>(path, { method: 'DELETE' }); }

  private async stream(path: string, init: RequestInit, onEvent: (e: StreamEvent) => void, signal?: AbortSignal): Promise<void> {
    const r = await this.f(this.url(path), { ...init, signal, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) } });
    if (!r.ok || !r.body) {
      const j = (await r.json().catch(() => ({}))) as { detail?: string };
      throw new AssistantHttpError(j.detail ?? `request failed (${r.status})`, r.status);
    }
    await readStreamEvents(r.body, onEvent);
  }

  status() { return this.call<AssistantStatus>('status'); }
  listConversations(q = '', archived = false) { return this.call<{ items: ConversationSummary[] }>(`conversations?archived=${archived}&q=${encodeURIComponent(q)}`).then((r) => r.items); }
  createConversation(settings?: ConversationSettings, title?: string) { return this.post<{ conversation: Conversation }>('conversations', { settings, title }).then((r) => r.conversation); }
  getConversation(id: string) { return this.call<{ conversation: Conversation }>(`conversations/${encodeURIComponent(id)}`).then((r) => r.conversation); }
  patchConversation(id: string, patch: Parameters<AssistantClient['patchConversation']>[1]) { return this.patch<{ conversation: Conversation }>(`conversations/${encodeURIComponent(id)}`, patch).then((r) => r.conversation); }
  deleteConversation(id: string) { return this.del<unknown>(`conversations/${encodeURIComponent(id)}`).then(() => undefined); }
  fork(id: string, messageId?: string) { return this.post<{ conversation: Conversation }>(`conversations/${encodeURIComponent(id)}/fork`, { messageId }).then((r) => r.conversation); }
  deleteMessage(id: string, messageId: string) { return this.del<{ conversation: Conversation }>(`conversations/${encodeURIComponent(id)}/messages/${encodeURIComponent(messageId)}`).then((r) => r.conversation); }
  send(id: string, input: TurnInput, onEvent: (e: StreamEvent) => void, signal?: AbortSignal) { return this.stream(`conversations/${encodeURIComponent(id)}/messages`, { method: 'POST', body: JSON.stringify(input) }, onEvent, signal); }
  follow(id: string, since: number, onEvent: (e: StreamEvent) => void, signal?: AbortSignal) { return this.stream(`sessions/${encodeURIComponent(id)}/events?since=${Math.max(0, Math.floor(since))}`, { method: 'GET' }, onEvent, signal); }
  session(id: string) { return this.call<{ session: LiveSessionInfo | null }>(`sessions/${encodeURIComponent(id)}`).then((r) => r.session, () => null); }
  stop(id: string) { return this.post<{ stopped: boolean }>(`sessions/${encodeURIComponent(id)}/stop`, {}).then((r) => r.stopped, () => false); }
  closeSession(id: string) { return this.post<{ closed: boolean }>(`sessions/${encodeURIComponent(id)}/close`, {}).then((r) => r.closed, () => false); }
}

// ---------------------------------------------------------------- live reply (reattach + replay for any chat UI)

/** Rolling state of the reply being watched; a view renders it and nothing else. */
export interface LiveReply {
  turnId: string; text: string; status: string; thinking: string; error: string; agent: string;
  tools: { id: string; name: string; input?: string; ok?: boolean; preview?: string; done: boolean }[];
  /** newest seq seen, for reattaching */
  lastSeq: number;
  done: boolean;
}

export function emptyLiveReply(status = 'Connecting…', agent = ''): LiveReply {
  return { turnId: '', text: '', status, thinking: '', error: '', agent, tools: [], lastSeq: 0, done: false };
}

/** Fold one stream event into the live reply (pure; returns the same object). Lifecycle frames are honoured. */
export function applyStreamEvent(r: LiveReply, e: StreamEvent): LiveReply {
  if (e.seq) r.lastSeq = Math.max(r.lastSeq, e.seq);
  switch (e.event) {
    case 'start': r.turnId = e.data.turnId; if (e.data.agent) r.agent = e.data.agent.name; break;
    case 'text': r.text += e.data.text; break;
    case 'thinking': r.thinking += e.data.text; break;
    case 'status': r.status = e.data.text; break;
    case 'tool':
      if (e.data.phase === 'call') { if (r.text && !r.text.endsWith('\n')) r.text += '\n\n'; r.tools.push({ id: e.data.id, name: e.data.name, input: e.data.input, done: false }); }
      else { const t = r.tools.find((x) => x.id === e.data.id); if (t) Object.assign(t, { ok: e.data.ok, preview: e.data.preview, done: true }); }
      break;
    case 'error': r.error = e.data.message; break;
    case 'done': r.done = true; break;
    case 'interrupted': r.error = 'The host restarted while this reply was running.'; r.done = true; break;
    case 'turn.end': r.done = true; break;
    case 'replay': if (e.data.reset) r.lastSeq = 0; break;
    default: break;
  }
  return r;
}

/** Reconnect delay after the n-th failed attempt (1-based): 1 s, 2 s, 4 s … capped at 30 s. */
export function reconnectDelayMs(attempt: number, capMs = 30_000): number {
  return Math.min(capMs, 500 * 2 ** Math.max(1, Math.floor(attempt)));
}
export const RECONNECT_ATTEMPTS = 8;

/**
 * Watch a reply until it ends, reattaching after dropped connections. `first` is the call that starts it (send);
 * afterwards the client follows by seq. Aborting `signal` only detaches: the reply keeps running on its host.
 */
export async function watchReply(client: AssistantClient, id: string, reply: LiveReply, onChange: (r: LiveReply) => void,
                                 first: ((onEvent: (e: StreamEvent) => void, signal: AbortSignal) => Promise<void>) | null, signal: AbortSignal,
                                 sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): Promise<void> {
  let attempt = 0;
  let step = first;
  for (;;) {
    if (signal.aborted) return;
    try {
      await (step ?? ((on, sig) => client.follow(id, reply.lastSeq, on, sig)))((e) => { applyStreamEvent(reply, e); onChange(reply); }, signal);
      const info = await client.session(id);
      if (!info || info.state !== 'running') { reply.done = true; onChange(reply); return; }
      step = null;
    } catch (e) {
      if ((e as Error).name === 'AbortError' || signal.aborted) return;
      if (step && (e as { status?: number }).status) throw e; // the host refused the message itself
      if (++attempt > RECONNECT_ATTEMPTS) { reply.error = 'Lost the connection. The reply is still running on its host; reopen the conversation to follow it.'; reply.done = true; onChange(reply); return; }
      reply.status = 'Reconnecting…'; onChange(reply);
      await sleep(reconnectDelayMs(attempt));
      step = null;
    }
  }
}
