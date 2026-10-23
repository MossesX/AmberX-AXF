/**
 * MCP protocol client over Streamable HTTP — the web reference implementation of the client contract
 * (`mcp-client@1`). The Kotlin `McpClient` (lib-mcp) and the Python `axf_libs.mcp.McpClient` do the same things
 * in the same order; the pure parts live in `core/engines/mcp.ts` and are pinned by `spec/fixtures/mcp-client.json`.
 *
 * The client never sees a token: it asks an `McpTransport` to perform each HTTP request, and the transport (which the
 * host app implements, e.g. `fetchTransport(credentials)`) adds the credentials. UI code only ever holds a client.
 */
import {
  MCP_DEFAULT_TIMEOUT_MS, MCP_PROTOCOL_VERSION, MCP_SESSION_HEADER, MCP_WIRE, SseParser, classifyResponse, errorFromHttp, errorFromRpc,
  errorFromTransport, initializeParams, mcpHeaders, mergePages, negotiate, offers, pageParams, parseMessages, rpcNotification, rpcRequest,
  wire, type JsonRpcId, type McpContent, type McpToolAnnotations, type McpWireError, type ParsedMessage,
} from '../../core/engines/mcp';

/* ================================================================== transport (the host app implements this) */

export interface McpTransportRequest {
  /** the server record's id; the transport looks up its credentials by it */
  serverId: string;
  url: string;
  method: 'POST' | 'GET' | 'DELETE';
  /** protocol headers (accept, content-type, session, version); the transport adds Authorization and the like */
  headers: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}
export interface McpTransportResponse {
  status: number;
  statusText?: string;
  /** lowercase header names */
  headers: Record<string, string>;
  /** the whole body (JSON responses) */
  text(): Promise<string>;
  /** the body as it arrives (SSE responses); may fall back to one chunk */
  chunks(): AsyncIterable<string>;
}
export interface McpTransport { request(req: McpTransportRequest): Promise<McpTransportResponse> }

/** Where a server's credentials come from. Only the transport calls it; UI code never does. */
export interface McpCredentialProvider {
  /** the Authorization header value for a server (e.g. `Bearer …`), or null for no auth */
  authorization(serverId: string): Promise<string | null>;
}

/** The default transport: `fetch` plus the credentials a provider supplies. */
export function fetchTransport(credentials: McpCredentialProvider, fetchFn: typeof fetch = (...a) => fetch(...a)): McpTransport {
  return {
    async request(req) {
      const headers: Record<string, string> = { ...req.headers };
      const auth = await credentials.authorization(req.serverId);
      if (auth) headers.authorization = auth;
      const r = await fetchFn(req.url, { method: req.method, headers, body: req.body, signal: req.signal, cache: 'no-store', redirect: 'manual' });
      const h: Record<string, string> = {};
      r.headers.forEach((v, k) => { h[k.toLowerCase()] = v; });
      return {
        status: r.status, statusText: r.statusText, headers: h,
        text: () => r.text(),
        async *chunks() {
          if (!r.body) { yield await r.text(); return; }
          const reader = r.body.getReader();
          const dec = new TextDecoder();
          for (;;) { const { value, done } = await reader.read(); if (done) break; yield dec.decode(value, { stream: true }); }
          const tail = dec.decode(); if (tail) yield tail;
        },
      };
    },
  };
}

/* ================================================================== typed results */

export interface McpServerInfo { name: string; version: string; title?: string }
export interface McpTool { name: string; title?: string; description?: string; inputSchema?: Record<string, unknown>; outputSchema?: Record<string, unknown>; annotations?: McpToolAnnotations }
export interface McpResource { uri: string; name?: string; title?: string; description?: string; mimeType?: string; size?: number }
export interface McpResourceTemplate { uriTemplate: string; name?: string; title?: string; description?: string; mimeType?: string }
export interface McpPromptArgument { name: string; description?: string; required?: boolean }
export interface McpPrompt { name: string; title?: string; description?: string; arguments?: McpPromptArgument[] }
export interface McpCallResult { isError: boolean; content: McpContent[]; structured?: unknown }
export interface McpResourceContents { uri: string; text?: string; blob?: string; mimeType?: string }
export interface McpPromptMessage { role: string; content: McpContent }
export interface McpPromptResult { description?: string; messages: McpPromptMessage[] }
export interface McpListResult<T> { items: T[]; truncated: boolean }

export interface McpSessionInfo {
  protocolVersion: string;
  sessionId: string | null;
  capabilities: Record<string, unknown>;
  serverInfo: McpServerInfo | null;
  instructions: string;
}

/** Thrown by every client method; `error` is the wire error (stable codes). */
export class McpError extends Error {
  constructor(public readonly error: McpWireError) { super(error.message); this.name = 'McpError'; }
  get code() { return this.error.code; }
}

/* ================================================================== the client */

export interface McpClientOptions {
  serverId: string;
  url: string;
  transport: McpTransport;
  timeoutMs?: number;
  /** server notifications the session receives (logging, list_changed, progress); optional */
  onNotification?: (method: string, params: Record<string, unknown>) => void;
  /** every request's outcome, for call logs */
  onCall?: (op: string, ok: boolean, ms: number, detail?: string) => void;
  now?: () => number;
}

/**
 * One session with one server. `initialize()` once (lazily by the first call), then list / call / read / get.
 * Each request is one POST; a response may come back as JSON or as an SSE stream (the response is the event whose
 * id matches). A 404 on a session the server forgot re-initializes once and retries. `cancel(id)` sends
 * `notifications/cancelled` and aborts the request; `close()` deletes the session where the server supports it.
 */
export class McpClient {
  readonly serverId: string;
  readonly url: string;
  private readonly transport: McpTransport;
  private readonly timeoutMs: number;
  private readonly onNotification?: McpClientOptions['onNotification'];
  private readonly onCall?: McpClientOptions['onCall'];
  private readonly now: () => number;
  private nextId = 1;
  private sessionId: string | null = null;
  private protocolVersion: string | null = null;
  private info: McpSessionInfo | null = null;
  private initializing: Promise<McpSessionInfo> | null = null;
  private inflight = new Map<JsonRpcId, AbortController>();

  constructor(o: McpClientOptions) {
    this.serverId = o.serverId; this.url = o.url; this.transport = o.transport;
    this.timeoutMs = o.timeoutMs ?? MCP_DEFAULT_TIMEOUT_MS;
    this.onNotification = o.onNotification; this.onCall = o.onCall; this.now = o.now ?? (() => Date.now());
  }

  get session(): McpSessionInfo | null { return this.info; }
  get connected(): boolean { return this.info !== null; }

  /* ---------- lifecycle ---------- */

  async initialize(signal?: AbortSignal): Promise<McpSessionInfo> {
    if (this.info) return this.info;
    if (!this.initializing) {
      this.initializing = (async () => {
        this.sessionId = null; this.protocolVersion = null;
        const r = await this.exchange('initialize', initializeParams(), signal, false);
        const n = negotiate(r.result);
        if (!n.ok) throw new McpError(n.error);
        this.protocolVersion = n.protocolVersion;
        this.sessionId = r.sessionId;
        this.info = { protocolVersion: n.protocolVersion, sessionId: this.sessionId, capabilities: n.capabilities, serverInfo: n.serverInfo, instructions: n.instructions };
        await this.notify('notifications/initialized', undefined, signal);
        return this.info;
      })().finally(() => { this.initializing = null; });
    }
    return this.initializing;
  }

  /** End the session: abort in-flight requests and DELETE the session when the server gave one. */
  async close(): Promise<void> {
    for (const c of this.inflight.values()) c.abort();
    this.inflight.clear();
    const sid = this.sessionId;
    this.info = null; this.sessionId = null; this.protocolVersion = null;
    if (!sid) return;
    try { await this.transport.request({ serverId: this.serverId, url: this.url, method: 'DELETE', headers: mcpHeaders({ sessionId: sid, protocolVersion: this.protocolVersion ?? MCP_PROTOCOL_VERSION, method: 'DELETE' }) }); }
    catch { /* a server that doesn't support DELETE answers 405; either way the session is gone for us */ }
  }

  /** Cancel a request in flight (its promise rejects with `cancelled`). */
  async cancel(id: JsonRpcId, reason = 'cancelled by the user'): Promise<void> {
    const c = this.inflight.get(id);
    if (!c) return;
    c.abort();
    await this.notify('notifications/cancelled', { requestId: id, reason }).catch(() => undefined);
  }

  /* ---------- the MCP methods ---------- */

  async listTools(signal?: AbortSignal): Promise<McpListResult<McpTool>> { return this.listAll<McpTool>('tools/list', 'tools', signal); }
  async listResources(signal?: AbortSignal): Promise<McpListResult<McpResource>> { return this.listAll<McpResource>('resources/list', 'resources', signal); }
  async listResourceTemplates(signal?: AbortSignal): Promise<McpListResult<McpResourceTemplate>> { return this.listAll<McpResourceTemplate>('resources/templates/list', 'resourceTemplates', signal); }
  async listPrompts(signal?: AbortSignal): Promise<McpListResult<McpPrompt>> { return this.listAll<McpPrompt>('prompts/list', 'prompts', signal); }

  async callTool(name: string, args: Record<string, unknown> = {}, signal?: AbortSignal): Promise<McpCallResult> {
    const r = await this.request('tools/call', { name, arguments: args }, signal, `call ${name}`);
    const o = asObj(r);
    const content = Array.isArray(o.content) ? (o.content as McpContent[]) : [];
    const out: McpCallResult = { isError: o.isError === true, content };
    if (o.structuredContent !== undefined) out.structured = o.structuredContent;
    return out;
  }

  async readResource(uri: string, signal?: AbortSignal): Promise<McpResourceContents[]> {
    const r = await this.request('resources/read', { uri }, signal, `read ${uri}`);
    const o = asObj(r);
    return Array.isArray(o.contents) ? (o.contents as McpResourceContents[]) : [];
  }

  async getPrompt(name: string, args: Record<string, string> = {}, signal?: AbortSignal): Promise<McpPromptResult> {
    const r = await this.request('prompts/get', { name, arguments: args }, signal, `prompt ${name}`);
    const o = asObj(r);
    return { ...(typeof o.description === 'string' ? { description: o.description } : {}), messages: Array.isArray(o.messages) ? (o.messages as McpPromptMessage[]) : [] };
  }

  async ping(signal?: AbortSignal): Promise<void> { await this.request('ping', undefined, signal, 'ping'); }

  /** initialize + every list the server offers, in one go (what a "Connect" button needs). */
  async connect(signal?: AbortSignal): Promise<McpConnected> {
    const s = await this.initialize(signal);
    const out: McpConnected = { ...s, tools: [], resources: [], resourceTemplates: [], prompts: [] };
    if (offers(s.capabilities, 'tools')) out.tools = (await this.listTools(signal)).items;
    if (offers(s.capabilities, 'resources')) {
      try { out.resources = (await this.listResources(signal)).items; } catch (e) { out.resourcesError = describe(e); }
      try { out.resourceTemplates = (await this.listResourceTemplates(signal)).items; } catch { /* optional */ }
    }
    if (offers(s.capabilities, 'prompts')) { try { out.prompts = (await this.listPrompts(signal)).items; } catch (e) { out.promptsError = describe(e); } }
    return out;
  }

  /* ---------- plumbing ---------- */

  private async listAll<T>(method: string, key: string, signal?: AbortSignal): Promise<McpListResult<T>> {
    const pages: { items: T[]; nextCursor?: string | null }[] = [];
    let cursor: string | null = null;
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const r = asObj(await this.request(method, pageParams(cursor), signal, method));
      const items = Array.isArray(r[key]) ? (r[key] as T[]) : [];
      const next = typeof r.nextCursor === 'string' && r.nextCursor ? r.nextCursor : null;
      pages.push({ items, nextCursor: next });
      if (!next || seen.has(next)) break;
      seen.add(next); cursor = next;
    }
    const m = mergePages(pages);
    return { items: m.items, truncated: m.truncated || m.loop };
  }

  /** A request after initialize (lazy). A forgotten session (404) initializes again once and retries. */
  private async request(method: string, params: Record<string, unknown> | undefined, signal: AbortSignal | undefined, op: string): Promise<unknown> {
    await this.initialize(signal);
    try { return (await this.exchange(method, params, signal, true, op)).result; }
    catch (e) {
      if (e instanceof McpError && e.error.details?.session === 'expired') {
        this.info = null; this.sessionId = null;
        await this.initialize(signal);
        return (await this.exchange(method, params, signal, true, op)).result;
      }
      throw e;
    }
  }

  private async notify(method: string, params: Record<string, unknown> | undefined, signal?: AbortSignal): Promise<void> {
    const res = await this.transport.request({ serverId: this.serverId, url: this.url, method: 'POST', headers: this.headers(), body: JSON.stringify(rpcNotification(method, params)), signal });
    const kind = classifyResponse(res.status, res.headers['content-type'], !!this.sessionId);
    if (kind === 'error') throw new McpError(errorFromHttp(res.status, res.statusText));
  }

  private headers() { return mcpHeaders({ sessionId: this.sessionId, protocolVersion: this.protocolVersion }); }

  /** One JSON-RPC request → its result (or a McpError), whatever the response shape. */
  private async exchange(method: string, params: Record<string, unknown> | undefined, signal: AbortSignal | undefined, withSession: boolean, op = method): Promise<{ result: unknown; sessionId: string | null }> {
    const id = this.nextId++;
    const ctl = new AbortController();
    const onAbort = () => ctl.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => ctl.abort(new Error('timeout')), this.timeoutMs);
    this.inflight.set(id, ctl);
    const started = this.now();
    const done = (ok: boolean, detail?: string) => { this.onCall?.(op, ok, Math.max(0, this.now() - started), detail); };
    try {
      let res: McpTransportResponse;
      try {
        res = await this.transport.request({ serverId: this.serverId, url: this.url, method: 'POST', headers: withSession ? this.headers() : mcpHeaders({ protocolVersion: null }), body: JSON.stringify(rpcRequest(id, method, params)), signal: ctl.signal });
      } catch (e) {
        if (ctl.signal.aborted) throw new McpError(errorFromTransport(signal?.aborted ? 'cancelled' : 'timeout', signal?.aborted ? 'cancelled' : `no answer within ${this.timeoutMs} ms`));
        throw new McpError(errorFromTransport('network', describe(e)));
      }
      const kind = classifyResponse(res.status, res.headers['content-type'], withSession && !!this.sessionId);
      if (kind === 'expired') throw new McpError(wire(MCP_WIRE.NOT_FOUND, 'the server forgot this session', { session: 'expired' }));
      if (kind === 'error') throw new McpError(res.status >= 200 && res.status < 300 ? wire(MCP_WIRE.INVALID, `unexpected content type ${res.headers['content-type'] ?? '(none)'} from the server`) : errorFromHttp(res.status, res.statusText));
      if (kind === 'accepted') throw new McpError(wire(MCP_WIRE.INVALID, 'the server accepted the request but sent no response'));
      const sessionId = res.headers[MCP_SESSION_HEADER] ?? this.sessionId;
      const messages = kind === 'json' ? parseMessages(await res.text()) : await this.readSse(res, id, ctl.signal);
      const hit = this.pick(messages, id);
      if (!hit) throw new McpError(wire(MCP_WIRE.INVALID, 'no response to the request in the server\'s reply'));
      if (hit.kind === 'error') throw new McpError(errorFromRpc(hit.error));
      done(true);
      return { result: hit.result, sessionId };
    } catch (e) {
      if (e instanceof McpError) { done(false, e.message); throw e; }
      if (ctl.signal.aborted) { const err = new McpError(errorFromTransport(signal?.aborted ? 'cancelled' : 'timeout', signal?.aborted ? 'cancelled' : `no answer within ${this.timeoutMs} ms`)); done(false, err.message); throw err; }
      const err = new McpError(errorFromTransport('network', describe(e))); done(false, err.message); throw err;
    } finally {
      clearTimeout(timer); signal?.removeEventListener('abort', onAbort); this.inflight.delete(id);
    }
  }

  /** Read an SSE response until the message answering `id` arrives; notifications are forwarded on the way. */
  private async readSse(res: McpTransportResponse, id: JsonRpcId, signal: AbortSignal): Promise<ParsedMessage[]> {
    const parser = new SseParser();
    const out: ParsedMessage[] = [];
    const take = (events: { event: string; data: string }[]) => {
      for (const ev of events) {
        if (ev.event !== 'message') continue;
        for (const m of parseMessages(ev.data)) {
          if (m.kind === 'notification') this.onNotification?.(m.method, m.params);
          else if (m.kind === 'request') { /* server→client requests (sampling, elicitation) are not supported: ignored */ }
          else out.push(m);
          if ((m.kind === 'result' || m.kind === 'error') && m.id === id) return true;
        }
      }
      return false;
    };
    for await (const chunk of res.chunks()) {
      if (signal.aborted) break;
      if (take(parser.feed(chunk))) return out;
    }
    take(parser.end());
    return out;
  }

  private pick(messages: ParsedMessage[], id: JsonRpcId) {
    for (const m of messages) {
      if (m.kind === 'notification') this.onNotification?.(m.method, m.params);
      if ((m.kind === 'result' || m.kind === 'error') && (m.id === id || (m.kind === 'error' && m.id === null))) return m;
    }
    return null;
  }
}

export interface McpConnected extends McpSessionInfo {
  tools: McpTool[]; resources: McpResource[]; resourceTemplates: McpResourceTemplate[]; prompts: McpPrompt[];
  resourcesError?: string; promptsError?: string;
}

const asObj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
export const describe = (e: unknown): string => (e instanceof Error ? e.message : String(e)) || 'unknown error';
