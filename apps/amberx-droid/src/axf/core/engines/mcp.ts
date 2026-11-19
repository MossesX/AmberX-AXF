/**
 * MCP client engine — the protocol-level, transport-free part of the MCP client library (`ai.amberx.axf.mcp`).
 *
 * Everything here is pure: JSON-RPC framing, Streamable HTTP headers and session rules, SSE parsing, pagination,
 * error mapping onto the kernel's wire codes, tool effects (read / write / destructive) and the call gate that applies
 * the interop exposure rules to outbound calls. The Kotlin kernel (`ai.amberx.axf.kernel.mcp.McpEngine`) and the
 * Python library (`axf_libs.mcp.engine`) mirror it function for function; `spec/fixtures/mcp-client.json` pins all
 * three. The transport (fetch / OkHttp / urllib) and the credential provider live in the libraries, never here, so
 * UI code never sees a token.
 *
 * Spec: Model Context Protocol, Streamable HTTP transport (2025-03-26 and later).
 */

/* ================================================================== constants */

export const MCP_PROTOCOL_VERSION = '2025-06-18';
/** Versions this client speaks, newest first. A server answering with another version is refused (`invalid`). */
export const MCP_SUPPORTED_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const;
export const MCP_SESSION_HEADER = 'mcp-session-id';
export const MCP_VERSION_HEADER = 'mcp-protocol-version';
export const MCP_CLIENT_INFO = { name: 'amberx-axf', version: '0.2.0', title: 'AmberX AXF MCP client' } as const;
export const MCP_DEFAULT_TIMEOUT_MS = 30_000;

/** Permissions the library checks before a tool call (UAC grammar; apps grant them in their uac-policy). */
export const MCP_PERMISSIONS = {
  /** add, edit, remove servers and their credentials */
  MANAGE: 'mcp.servers.manage',
  /** call read-only tools, read resources, get prompts */
  CALL: 'mcp.call',
  /** call tools that change something */
  WRITE: 'mcp.call.write',
  /** call tools the server marks destructive (always confirmed first) */
  DESTRUCTIVE: 'mcp.call.destructive',
} as const;

/** The kernel's wire error codes (INTEROP.md). Codes never change meaning. */
export const MCP_WIRE = {
  INVALID: 'invalid', NOT_IMPLEMENTED: 'not_implemented', DENIED: 'denied', NOT_FOUND: 'not_found', UNAVAILABLE: 'unavailable',
  VALIDATION: 'validation', UNEXPECTED: 'unexpected', CANCELLED: 'cancelled', TIMEOUT: 'timeout', CONFIRMATION_REQUIRED: 'confirmation_required',
} as const;
export type McpWireCode = (typeof MCP_WIRE)[keyof typeof MCP_WIRE];

/* ================================================================== JSON-RPC framing */

export type JsonRpcId = number | string;
export interface JsonRpcError { code: number; message: string; data?: unknown }
export interface JsonRpcRequest { jsonrpc: '2.0'; id: JsonRpcId; method: string; params?: Record<string, unknown> }
export interface JsonRpcNotification { jsonrpc: '2.0'; method: string; params?: Record<string, unknown> }
export interface JsonRpcResponse { jsonrpc: '2.0'; id: JsonRpcId; result?: unknown; error?: JsonRpcError }

export type ParsedMessage =
  | { kind: 'request'; id: JsonRpcId; method: string; params: Record<string, unknown> }
  | { kind: 'notification'; method: string; params: Record<string, unknown> }
  | { kind: 'result'; id: JsonRpcId; result: unknown }
  | { kind: 'error'; id: JsonRpcId | null; error: JsonRpcError }
  | { kind: 'invalid'; reason: string };

export function rpcRequest(id: JsonRpcId, method: string, params?: Record<string, unknown>): JsonRpcRequest {
  return params === undefined ? { jsonrpc: '2.0', id, method } : { jsonrpc: '2.0', id, method, params };
}
export function rpcNotification(method: string, params?: Record<string, unknown>): JsonRpcNotification {
  return params === undefined ? { jsonrpc: '2.0', method } : { jsonrpc: '2.0', method, params };
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isId = (v: unknown): v is JsonRpcId => typeof v === 'number' || typeof v === 'string';

/** Classify one already-parsed JSON value. Batches are split by `parseMessages`. */
export function parseMessage(raw: unknown): ParsedMessage {
  if (!isObj(raw)) return { kind: 'invalid', reason: 'not an object' };
  if (raw.jsonrpc !== '2.0') return { kind: 'invalid', reason: 'jsonrpc must be "2.0"' };
  const params = isObj(raw.params) ? raw.params : {};
  if (typeof raw.method === 'string') {
    if ('id' in raw && raw.id !== null) return isId(raw.id) ? { kind: 'request', id: raw.id, method: raw.method, params } : { kind: 'invalid', reason: 'id must be a string or number' };
    return { kind: 'notification', method: raw.method, params };
  }
  if ('error' in raw) {
    const e = raw.error;
    if (!isObj(e) || typeof e.code !== 'number' || typeof e.message !== 'string') return { kind: 'invalid', reason: 'error needs a numeric code and a message' };
    const id = isId(raw.id) ? raw.id : null;
    return { kind: 'error', id, error: 'data' in e ? { code: e.code, message: e.message, data: e.data } : { code: e.code, message: e.message } };
  }
  if ('result' in raw) return isId(raw.id) ? { kind: 'result', id: raw.id, result: raw.result } : { kind: 'invalid', reason: 'result needs an id' };
  return { kind: 'invalid', reason: 'neither a request, a notification nor a response' };
}

/** Parse one JSON body: a single message or a batch. Invalid JSON gives one `invalid` message. */
export function parseMessages(text: string): ParsedMessage[] {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return [{ kind: 'invalid', reason: 'not valid JSON' }]; }
  if (Array.isArray(raw)) return raw.length ? raw.map(parseMessage) : [{ kind: 'invalid', reason: 'empty batch' }];
  return [parseMessage(raw)];
}

/* ================================================================== Server-Sent Events */

export interface SseEvent { event: string; data: string; id?: string; retry?: number }

/**
 * Incremental SSE parser (the subset MCP uses): `event:`, `data:` (joined with \n), `id:`, `retry:`, comments,
 * CRLF / CR / LF line endings, a blank line dispatches. `end()` flushes a trailing event without a blank line.
 */
export class SseParser {
  private buf = '';
  private event = '';
  private data: string[] = [];
  private id: string | undefined;
  private retry: number | undefined;

  feed(chunk: string): SseEvent[] {
    this.buf += chunk;
    const out: SseEvent[] = [];
    for (;;) {
      const m = /\r\n|\r|\n/.exec(this.buf);
      if (!m) break;
      const line = this.buf.slice(0, m.index);
      this.buf = this.buf.slice(m.index + m[0].length);
      const ev = this.line(line);
      if (ev) out.push(ev);
    }
    return out;
  }

  end(): SseEvent[] {
    const out: SseEvent[] = [];
    if (this.buf) { const ev = this.line(this.buf); this.buf = ''; if (ev) out.push(ev); }
    const last = this.dispatch();
    if (last) out.push(last);
    return out;
  }

  private line(line: string): SseEvent | null {
    if (line === '') return this.dispatch();
    if (line.startsWith(':')) return null;
    const i = line.indexOf(':');
    const field = i < 0 ? line : line.slice(0, i);
    let value = i < 0 ? '' : line.slice(i + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') this.event = value;
    else if (field === 'data') this.data.push(value);
    else if (field === 'id') { if (!value.includes('\0')) this.id = value; }
    else if (field === 'retry') { if (/^\d+$/.test(value)) this.retry = Number(value); }
    return null;
  }

  private dispatch(): SseEvent | null {
    if (this.data.length === 0) { this.event = ''; return null; }
    const ev: SseEvent = { event: this.event || 'message', data: this.data.join('\n') };
    if (this.id !== undefined) ev.id = this.id;
    if (this.retry !== undefined) ev.retry = this.retry;
    this.event = ''; this.data = []; this.retry = undefined;
    return ev;
  }
}

/** Parse a whole SSE body at once. */
export function parseSse(text: string): SseEvent[] {
  const p = new SseParser();
  return [...p.feed(text), ...p.end()];
}

/* ================================================================== Streamable HTTP rules */

export interface McpHeaderOptions { sessionId?: string | null; protocolVersion?: string | null; method?: 'POST' | 'GET' | 'DELETE' }

/** Request headers for one Streamable HTTP call (lowercase names; credentials are added by the transport). */
export function mcpHeaders(o: McpHeaderOptions = {}): Record<string, string> {
  const method = o.method ?? 'POST';
  const h: Record<string, string> = { accept: method === 'GET' ? 'text/event-stream' : 'application/json, text/event-stream' };
  if (method === 'POST') h['content-type'] = 'application/json';
  if (o.sessionId) h[MCP_SESSION_HEADER] = o.sessionId;
  if (o.protocolVersion) h[MCP_VERSION_HEADER] = o.protocolVersion;
  return h;
}

/** Params of the `initialize` request. */
export function initializeParams(client: { name: string; version: string; title?: string } = MCP_CLIENT_INFO, protocolVersion: string = MCP_PROTOCOL_VERSION): Record<string, unknown> {
  const info: Record<string, unknown> = { name: client.name, version: client.version };
  if (client.title) info.title = client.title;
  return { protocolVersion, capabilities: {}, clientInfo: info };
}

/** The server's `initialize` result → what the session keeps; `invalid` when the version is one we don't speak. */
export function negotiate(result: unknown): { ok: true; protocolVersion: string; capabilities: Record<string, unknown>; serverInfo: { name: string; version: string; title?: string } | null; instructions: string } | { ok: false; error: McpWireError } {
  if (!isObj(result)) return { ok: false, error: wire(MCP_WIRE.INVALID, 'initialize returned no result object') };
  const v = typeof result.protocolVersion === 'string' ? result.protocolVersion : '';
  if (!(MCP_SUPPORTED_VERSIONS as readonly string[]).includes(v)) return { ok: false, error: wire(MCP_WIRE.INVALID, `server protocol version ${v || '(none)'} is not supported (client speaks ${MCP_SUPPORTED_VERSIONS.join(', ')})`) };
  const si = isObj(result.serverInfo) ? result.serverInfo : null;
  const serverInfo = si && typeof si.name === 'string' ? { name: si.name, version: typeof si.version === 'string' ? si.version : '', ...(typeof si.title === 'string' ? { title: si.title } : {}) } : null;
  return { ok: true, protocolVersion: v, capabilities: isObj(result.capabilities) ? result.capabilities : {}, serverInfo, instructions: typeof result.instructions === 'string' ? result.instructions : '' };
}

/** Whether the server advertised a capability (`tools`, `resources`, `prompts`, `logging`). Unknown = not offered. */
export function offers(capabilities: Record<string, unknown> | null | undefined, cap: 'tools' | 'resources' | 'prompts' | 'logging' | 'completions'): boolean {
  return !!capabilities && cap in capabilities && capabilities[cap] !== null && capabilities[cap] !== false;
}

/**
 * What to do with one HTTP response to a POST, before its body is read:
 *   accepted   202 (a notification or response was accepted; nothing to read)
 *   json       one JSON message (or batch) in the body
 *   sse        an event stream carrying the response
 *   expired    404 while a session id was sent: the server dropped the session; initialize again, once
 *   error      anything else (mapped by errorFromHttp)
 */
export function classifyResponse(status: number, contentType: string | undefined, hadSession: boolean): 'accepted' | 'json' | 'sse' | 'expired' | 'error' {
  if (status === 202) return 'accepted';
  if (status === 404 && hadSession) return 'expired';
  if (status < 200 || status >= 300) return 'error';
  const ct = (contentType ?? '').toLowerCase();
  if (ct.startsWith('text/event-stream')) return 'sse';
  if (ct.startsWith('application/json') || ct === '') return 'json';
  return 'error';
}

/* ================================================================== pagination */

/** Params for a list request: the cursor from the previous page, if any. */
export function pageParams(cursor?: string | null): Record<string, unknown> | undefined {
  return cursor ? { cursor } : undefined;
}

/**
 * Merge list pages (`tools/list`, `resources/list`, `prompts/list`, `resources/templates/list`) and record which
 * cursors were followed. Stops at a missing `nextCursor`, a repeated cursor (a server loop) or `maxPages`.
 */
export function mergePages<T>(pages: { items: T[]; nextCursor?: string | null }[], maxPages = 100): { items: T[]; cursors: string[]; truncated: boolean; loop: boolean } {
  const items: T[] = [];
  const cursors: string[] = [];
  const seen = new Set<string>();
  let truncated = false;
  let loop = false;
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i]!;
    items.push(...p.items);
    const next = p.nextCursor ?? null;
    if (!next) break;
    if (seen.has(next)) { loop = true; break; }
    if (cursors.length + 1 >= maxPages) { truncated = true; break; }
    seen.add(next);
    cursors.push(next);
  }
  return { items, cursors, truncated, loop };
}

/* ================================================================== errors */

export interface McpWireError { code: McpWireCode; message: string; retryable: boolean; details?: Record<string, string> }

export function wire(code: McpWireCode, message: string, details?: Record<string, string>): McpWireError {
  const e: McpWireError = { code, message, retryable: code === MCP_WIRE.UNAVAILABLE };
  if (details && Object.keys(details).length) e.details = details;
  return e;
}

/** JSON-RPC error → wire error. Standard codes map by meaning; anything else is `unexpected` (message kept, it's the server's text). */
export function errorFromRpc(e: JsonRpcError): McpWireError {
  const msg = e.message || `JSON-RPC error ${e.code}`;
  const d = { rpc: String(e.code) };
  switch (e.code) {
    case -32700: return wire(MCP_WIRE.INVALID, msg, d);           // parse error
    case -32600: return wire(MCP_WIRE.INVALID, msg, d);           // invalid request
    case -32601: return wire(MCP_WIRE.NOT_FOUND, msg, d);         // method not found
    case -32602: return wire(MCP_WIRE.VALIDATION, msg, d);        // invalid params
    case -32603: return wire(MCP_WIRE.UNEXPECTED, msg, d);        // internal error
    case -32002: return wire(MCP_WIRE.NOT_FOUND, msg, d);         // resource not found (MCP)
    case -32001: return wire(MCP_WIRE.TIMEOUT, msg, d);           // request timeout (MCP SDKs)
    case -32800: return wire(MCP_WIRE.CANCELLED, msg, d);         // request cancelled (LSP-style, used by some servers)
    default: return wire(MCP_WIRE.UNEXPECTED, msg, d);
  }
}

/** HTTP status → wire error (for responses that carry no JSON-RPC error). */
export function errorFromHttp(status: number, statusText = ''): McpWireError {
  const d = { http: String(status) };
  const txt = statusText ? ` ${statusText}` : '';
  if (status === 401 || status === 403) return wire(MCP_WIRE.DENIED, `HTTP ${status}${txt}: the server refused the credentials`, d);
  if (status === 404) return wire(MCP_WIRE.NOT_FOUND, `HTTP 404${txt}: no MCP endpoint at that URL`, d);
  if (status === 405) return wire(MCP_WIRE.NOT_IMPLEMENTED, `HTTP 405${txt}: the server does not offer that transport method`, d);
  if (status === 408 || status === 504) return wire(MCP_WIRE.TIMEOUT, `HTTP ${status}${txt}`, d);
  if (status === 429 || status === 502 || status === 503) return wire(MCP_WIRE.UNAVAILABLE, `HTTP ${status}${txt}: try again later`, d);
  if (status >= 500) return wire(MCP_WIRE.UNAVAILABLE, `HTTP ${status}${txt}`, d);
  if (status >= 400) return wire(MCP_WIRE.INVALID, `HTTP ${status}${txt}`, d);
  if (status >= 300) return wire(MCP_WIRE.INVALID, `HTTP ${status}${txt}: redirects are not followed (a credential must never travel to another address)`, d);
  return wire(MCP_WIRE.UNEXPECTED, `HTTP ${status}${txt}`, d);
}

/** A transport failure (no HTTP status) → wire error. */
export function errorFromTransport(kind: 'timeout' | 'cancelled' | 'network' | 'protocol', message: string): McpWireError {
  if (kind === 'timeout') return wire(MCP_WIRE.TIMEOUT, message);
  if (kind === 'cancelled') return wire(MCP_WIRE.CANCELLED, message);
  if (kind === 'network') return wire(MCP_WIRE.UNAVAILABLE, message);
  return wire(MCP_WIRE.INVALID, message);
}

/* ================================================================== tools: effects and the call gate */

export type McpToolEffect = 'read' | 'write' | 'destructive';
export interface McpToolAnnotations { title?: string; readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean }

/**
 * What a tool does, from its annotations. `readOnlyHint` wins. Without annotations a tool is treated as `write`
 * (most servers omit them); `strict` applies the MCP default instead (`destructiveHint` defaults to true), so an
 * unannotated tool counts as destructive and is confirmed before every call.
 */
export function toolEffect(annotations: McpToolAnnotations | null | undefined, strict = false): McpToolEffect {
  if (annotations?.readOnlyHint === true) return 'read';
  if (annotations?.destructiveHint === true) return 'destructive';
  if (annotations?.destructiveHint === false) return 'write';
  return strict ? 'destructive' : 'write';
}

export interface McpCallGate { allowed: boolean; requires: string; confirm: boolean; effect: McpToolEffect; error?: McpWireError }

/** UAC permission check in the same grammar as the kernel (`*`, `ns.*`). */
export function mcpHasPermission(granted: Iterable<string>, perm: string): boolean {
  const g = granted instanceof Set ? granted : new Set(granted);
  if (g.has('*') || g.has(perm)) return true;
  const parts = perm.split('.');
  for (let i = parts.length - 1; i > 0; i--) if (g.has(parts.slice(0, i).join('.') + '.*')) return true;
  return false;
}

/**
 * The outbound gate (INTEROP.md applied to calls the app makes): the local role must hold the permission the
 * tool's effect needs, and a destructive tool is always confirmed by a person first. A call the role may not make
 * is `denied`, never silently downgraded. `perms` lets a host map the four permissions onto its own policy (the Dev
 * Console maps all four to `dev.tools`); the names and the gate's shape never change.
 */
export type McpPermissionSet = { MANAGE: string; CALL: string; WRITE: string; DESTRUCTIVE: string };

export function callGate(effect: McpToolEffect, granted: Iterable<string>, perms: McpPermissionSet = MCP_PERMISSIONS): McpCallGate {
  const requires = effect === 'read' ? perms.CALL : effect === 'write' ? perms.WRITE : perms.DESTRUCTIVE;
  const allowed = mcpHasPermission(granted, requires);
  const gate: McpCallGate = { allowed, requires, confirm: effect === 'destructive', effect };
  if (!allowed) gate.error = wire(MCP_WIRE.DENIED, `Your role can't call ${effect} tools (needs ${requires})`, { permission: requires });
  return gate;
}

/* ================================================================== tool results */

export interface McpContent { type: string; text?: string; mimeType?: string; data?: string; uri?: string; resource?: { uri?: string; text?: string; blob?: string; mimeType?: string } }

/** A plain-text rendering of tool-call content (what logs, Compose and terminals show). Never HTML. */
export function contentText(content: McpContent[] | null | undefined): string {
  return (content ?? []).map((c) => {
    if (c.type === 'text') return c.text ?? '';
    if (c.type === 'resource') return `${c.resource?.uri ?? ''}\n${c.resource?.text ?? (c.resource?.blob ? `(binary resource, ${c.resource.blob.length} base64 chars)` : '(binary resource)')}`;
    if (c.type === 'resource_link') return `${c.uri ?? ''}${c.mimeType ? ` (${c.mimeType})` : ''}`;
    return `${c.type}${c.mimeType ? ` (${c.mimeType})` : ''}${c.uri ? `: ${c.uri}` : ''}${c.data ? ` · ${c.data.length} base64 chars` : ''}`;
  }).join('\n\n');
}

/* ================================================================== server records */

export const MCP_SERVER_ID_RE = /^[a-z0-9][a-z0-9-]{0,47}$/;
export const MCP_ENV_NAME_RE = /^[A-Z_][A-Z0-9_]{0,63}$/;

/** The id a new server gets from its name (`axHub!` → `axhub`), unique against `taken`. */
export function serverIdFor(name: string, taken: Iterable<string> = []): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'server';
  const used = new Set(taken);
  let id = base;
  for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
  return id;
}

/** Problems with a server record a person typed; empty = fine. Same messages on every port. */
export function validateServerInput(s: { id?: string; name?: string; url?: string; tokenEnv?: string }): string[] {
  const out: string[] = [];
  const name = (s.name ?? '').trim();
  if (!name) out.push('name is required');
  else if (name.length > 80) out.push('name is too long (80 characters)');
  const url = (s.url ?? '').trim();
  const m = /^(https?):\/\/([^/?#\s]+)/i.exec(url);
  if (!url) out.push('url is required');
  else if (url.length > 500) out.push('url is too long (500 characters)');
  else if (!m) out.push('url must be an http(s) URL of a Streamable HTTP MCP endpoint, e.g. https://example.com/mcp');
  if (s.id && !MCP_SERVER_ID_RE.test(s.id)) out.push('id must be lowercase letters, digits and dashes');
  if (s.tokenEnv && !MCP_ENV_NAME_RE.test(s.tokenEnv)) out.push('tokenEnv must be an environment variable name like AXHUB_TOKEN');
  return out;
}

/** A starting argument object from a tool's input schema: defaults, else an empty value for each required field. */
export function argumentSkeleton(schema: { properties?: Record<string, { type?: string | string[]; default?: unknown; enum?: unknown[] }>; required?: string[] } | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, p] of Object.entries(schema?.properties ?? {})) {
    if (p.default !== undefined) out[k] = p.default;
    else if (schema?.required?.includes(k)) {
      const t = Array.isArray(p.type) ? p.type[0] : p.type;
      out[k] = p.enum?.length ? p.enum[0] : t === 'number' || t === 'integer' ? 0 : t === 'boolean' ? false : t === 'array' ? [] : t === 'object' ? {} : '';
    }
  }
  return out;
}
