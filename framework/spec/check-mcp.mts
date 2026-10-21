/**
 * Self-test for the MCP client on the web port (CI: npx -y tsx framework/spec/check-mcp.mts).
 *  1. replays spec/fixtures/mcp-client.json against core/engines/mcp.ts (the same file Kotlin and Python replay)
 *  2. drives libs/mcp/client.ts (McpClient) against a fake Streamable HTTP server: JSON and SSE replies, session id,
 *     version negotiation, pagination, a forgotten session (404 → re-initialize once), JSON-RPC errors, HTTP errors,
 *     timeouts, cancellation, DELETE on close
 *  3. the local host: registry validation, tokens kept out of records, the credential provider adds the header
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SseParser, argumentSkeleton, callGate, classifyResponse, contentText, errorFromHttp, errorFromRpc, errorFromTransport, initializeParams,
  mcpHeaders, mergePages, negotiate, offers, pageParams, parseMessages, parseSse, rpcNotification, rpcRequest, serverIdFor, toolEffect, validateServerInput,
  MCP_PERMISSIONS, MCP_PROTOCOL_VERSION, MCP_SESSION_HEADER, MCP_SUPPORTED_VERSIONS, MCP_VERSION_HEADER,
} from '../core/engines/mcp';
import { McpClient, McpError, fetchTransport, type McpTransport, type McpTransportRequest, type McpTransportResponse } from '../libs/mcp/client';
import { localHost, memorySecrets, secretCredentials } from '../libs/mcp/host';

const f = JSON.parse(readFileSync(new URL('./fixtures/mcp-client.json', import.meta.url), 'utf8'));
let checks = 0;
const norm = (v: unknown) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const eq = (a: unknown, b: unknown, what: string) => { assert.deepEqual(norm(a), norm(b), what); checks++; };

/* ---------- 1. fixture replay ---------- */
eq(MCP_PROTOCOL_VERSION, f.version, 'version');
eq(MCP_SUPPORTED_VERSIONS, f.supported, 'supported');
eq(MCP_SESSION_HEADER, f.sessionHeader, 'session header');
eq(MCP_VERSION_HEADER, f.versionHeader, 'version header');
eq(MCP_PERMISSIONS, f.permissions, 'permissions');
eq(initializeParams(), f.initialize, 'initialize params');
eq([rpcRequest(1, 'tools/list'), rpcRequest('x', 'tools/call', { name: 't', arguments: { a: 1 } }), rpcNotification('notifications/initialized'), rpcNotification('notifications/cancelled', { requestId: 3, reason: 'user' })], f.requests, 'requests');
for (const m of f.messages) eq(parseMessages(m.text), m.parsed, `parse ${m.text.slice(0, 40)}`);
for (const s of f.sse) eq(parseSse(s.text), s.events, `sse ${JSON.stringify(s.text).slice(0, 40)}`);
{ const p = new SseParser(); const ev = f.sseChunked.chunks.flatMap((c: string) => p.feed(c)); ev.push(...p.end()); eq(ev, f.sseChunked.events, 'sse chunked'); }
for (const h of f.headers) eq(mcpHeaders(h.options), h.headers, `headers ${JSON.stringify(h.options)}`);
for (const r of f.responses) eq(classifyResponse(r.status, r.contentType ?? undefined, r.hadSession), r.kind, `classify ${r.status} ${r.contentType}`);
for (const n of f.negotiate) eq(negotiate(n.result), n.outcome, `negotiate ${JSON.stringify(n.result).slice(0, 40)}`);
for (const o of f.offers) eq({ tools: offers(o.capabilities, 'tools'), resources: offers(o.capabilities, 'resources'), prompts: offers(o.capabilities, 'prompts'), logging: offers(o.capabilities, 'logging') }, { tools: o.tools, resources: o.resources, prompts: o.prompts, logging: o.logging }, `offers ${JSON.stringify(o.capabilities)}`);
for (const p of f.pageParams) eq(pageParams(p.cursor) ?? null, p.params, `pageParams ${p.cursor}`);
for (const p of f.pages) eq(mergePages(p.pages, p.maxPages), p.merged, `pages ${JSON.stringify(p.merged.cursors)}`);
for (const e of f.rpcErrors) eq(errorFromRpc(e.error), e.wire, `rpc error ${e.error.code}`);
for (const e of f.httpErrors) eq(errorFromHttp(e.status), e.wire, `http error ${e.status}`);
for (const e of f.transportErrors) eq(errorFromTransport(e.kind, e.message), e.wire, `transport error ${e.kind}`);
for (const e of f.effects) eq(toolEffect(e.annotations, e.strict), e.effect, `effect ${JSON.stringify(e.annotations)} strict=${e.strict}`);
for (const g of f.gates) eq(callGate(g.effect, g.granted), g.gate, `gate ${g.effect} ${JSON.stringify(g.granted)}`);
for (const g of f.mappedGates) eq(callGate(g.effect, g.granted, g.perms), g.gate, `mapped gate ${g.effect} ${JSON.stringify(g.granted)}`);
for (const c of f.contentText) eq(contentText(c.content), c.text, `contentText ${JSON.stringify(c.content).slice(0, 40)}`);
for (const s of f.serverIds) eq(serverIdFor(s.name, s.taken), s.id, `serverId ${s.name}`);
for (const v of f.validate) eq(validateServerInput(v.input), v.problems, `validate ${JSON.stringify(v.input).slice(0, 40)}`);
for (const s of f.skeletons) eq(argumentSkeleton(s.schema), s.args, `skeleton ${JSON.stringify(s.schema).slice(0, 40)}`);
console.log(`fixture replay: ${checks} checks`);

/* ---------- 2. the client against a fake server ---------- */

interface Reply { status?: number; headers?: Record<string, string>; body?: string; chunks?: string[]; delayMs?: number }
type Handler = (req: McpTransportRequest, msg: Record<string, unknown> | null) => Reply;

function fakeTransport(handler: Handler, seen: McpTransportRequest[] = []): McpTransport {
  return {
    async request(req) {
      seen.push(req);
      let msg: Record<string, unknown> | null = null;
      try { msg = req.body ? JSON.parse(req.body) : null; } catch { /* not json */ }
      const r = handler(req, msg);
      if (r.delayMs) await new Promise<void>((ok, no) => { const t = setTimeout(ok, r.delayMs); req.signal?.addEventListener('abort', () => { clearTimeout(t); no(new Error('aborted')); }); });
      const res: McpTransportResponse = {
        status: r.status ?? 200, headers: r.headers ?? { 'content-type': 'application/json' },
        text: async () => r.body ?? (r.chunks ?? []).join(''),
        async *chunks() { for (const c of r.chunks ?? [r.body ?? '']) yield c; },
      };
      return res;
    },
  };
}
const json = (o: unknown, headers: Record<string, string> = {}): Reply => ({ body: JSON.stringify(o), headers: { 'content-type': 'application/json', ...headers } });
const result = (id: unknown, result: unknown, headers?: Record<string, string>) => json({ jsonrpc: '2.0', id, result }, headers);
const init = (version = '2025-06-18', caps: Record<string, unknown> = { tools: {}, resources: {}, prompts: {} }) => ({ protocolVersion: version, capabilities: caps, serverInfo: { name: 'fake', version: '1' }, instructions: 'hi' });

// happy path: session id, protocol version header, lists with pagination, a tool call over SSE, close deletes the session
{
  const seen: McpTransportRequest[] = [];
  const notes: string[] = [];
  const log: string[] = [];
  const t = fakeTransport((req, m) => {
    if (req.method === 'DELETE') return { status: 200, body: '' };
    if (!m) return { status: 400 };
    if (m.method === 'initialize') return result(m.id, init(), { [MCP_SESSION_HEADER]: 'S1' });
    if (m.method === 'notifications/initialized') return { status: 202, body: '' };
    if (m.method === 'tools/list') { const c = (m.params as { cursor?: string } | undefined)?.cursor; return c ? result(m.id, { tools: [{ name: 'b', annotations: { destructiveHint: true } }] }) : result(m.id, { tools: [{ name: 'a', annotations: { readOnlyHint: true } }], nextCursor: 'p2' }); }
    if (m.method === 'resources/list') return result(m.id, { resources: [{ uri: 'file:///x', name: 'x' }] });
    if (m.method === 'resources/templates/list') return result(m.id, { resourceTemplates: [] });
    if (m.method === 'prompts/list') return result(m.id, { prompts: [{ name: 'p' }] });
    if (m.method === 'tools/call') return { headers: { 'content-type': 'text/event-stream' }, chunks: ['event: message\ndata: {"jsonrpc":"2.0","method":"notifications/progress","params":{"progress":0.5}}\n\n', `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'done' }], structuredContent: { ok: 1 } } })}\n\n`] };
    if (m.method === 'resources/read') return result(m.id, { contents: [{ uri: 'file:///x', text: 'body' }] });
    if (m.method === 'prompts/get') return result(m.id, { description: 'd', messages: [{ role: 'user', content: { type: 'text', text: 'hello' } }] });
    return json({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'nope' } });
  }, seen);
  const c = new McpClient({ serverId: 's', url: 'https://x/mcp', transport: t, onNotification: (m) => notes.push(m), onCall: (op, ok, ms) => log.push(`${op}:${ok}:${ms >= 0}`) });
  const conn = await c.connect();
  eq(conn.sessionId, 'S1', 'session id kept');
  eq(conn.protocolVersion, '2025-06-18', 'negotiated version');
  eq(conn.tools.map((x) => x.name), ['a', 'b'], 'tools paginated');
  eq(conn.resources.length, 1, 'resources listed');
  eq(conn.prompts.length, 1, 'prompts listed');
  eq(seen[0]!.headers['mcp-session-id'], undefined, 'initialize sends no session');
  eq(seen[1]!.headers['mcp-session-id'], 'S1', 'initialized notification carries the session');
  eq(seen[1]!.headers['mcp-protocol-version'], '2025-06-18', 'version header after initialize');
  eq(seen[1]!.headers.accept, 'application/json, text/event-stream', 'accept header');
  const r = await c.callTool('t', { a: 1 });
  eq(r, { isError: false, content: [{ type: 'text', text: 'done' }], structured: { ok: 1 } }, 'tool call over SSE');
  eq(notes, ['notifications/progress'], 'notification forwarded from the stream');
  eq((await c.readResource('file:///x'))[0]!.text, 'body', 'read resource');
  eq((await c.getPrompt('p')).messages.length, 1, 'get prompt');
  await assert.rejects(c.ping(), (e: McpError) => e instanceof McpError && e.code === 'not_found', 'rpc error maps');
  checks++;
  await c.close();
  eq(seen.at(-1)!.method, 'DELETE', 'close deletes the session');
  eq(seen.at(-1)!.headers['mcp-session-id'], 'S1', 'delete carries the session');
  eq(c.connected, false, 'closed');
  assert.ok(log.some((l) => l.startsWith('initialize:true')) && log.some((l) => l.startsWith('call t:true')) && log.some((l) => l.startsWith('ping:false')), 'call log rows');
  checks++;
}

// stateless server (no session header), batch reply, a forgotten session re-initializes once
{
  let inits = 0;
  let forget = true;
  const t = fakeTransport((req, m) => {
    if (!m) return { status: 400 };
    if (m.method === 'initialize') { inits++; return result(m.id, init('2025-03-26', { tools: {} }), inits === 1 ? { [MCP_SESSION_HEADER]: 'OLD' } : { [MCP_SESSION_HEADER]: 'NEW' }); }
    if (m.method === 'notifications/initialized') return { status: 202, body: '' };
    if (req.headers['mcp-session-id'] === 'OLD' && forget) return { status: 404, body: 'gone' };
    return { body: JSON.stringify([{ jsonrpc: '2.0', method: 'notifications/x' }, { jsonrpc: '2.0', id: m.id, result: { tools: [{ name: 'z' }] } }]), headers: { 'content-type': 'application/json' } };
  });
  const c = new McpClient({ serverId: 's', url: 'https://x/mcp', transport: t });
  await c.initialize();
  eq(c.session?.sessionId, 'OLD', 'first session');
  eq((await c.listTools()).items.map((x) => x.name), ['z'], 'retry after a forgotten session');
  eq(inits, 2, 'initialized exactly twice');
  eq(c.session?.sessionId, 'NEW', 'new session kept');
  forget = false;
  eq((await c.listTools()).items.length, 1, 'batch reply with a notification first');
  eq(inits, 2, 'no third initialize');
}

// refused version, HTTP errors, timeout, cancel, 202 to a request, unsupported content type
{
  const t = fakeTransport((_req, m) => result(m!.id, init('2030-01-01')));
  await assert.rejects(new McpClient({ serverId: 's', url: 'u', transport: t }).initialize(), (e: McpError) => e.code === 'invalid', 'unsupported version refused');
  checks++;
  for (const [status, code] of [[401, 'denied'], [404, 'not_found'], [503, 'unavailable'], [500, 'unavailable'], [418, 'invalid']] as const) {
    const t2 = fakeTransport(() => ({ status, body: '' }));
    await assert.rejects(new McpClient({ serverId: 's', url: 'u', transport: t2 }).initialize(), (e: McpError) => e.code === code, `http ${status} → ${code}`);
    checks++;
  }
  const slow = fakeTransport(() => ({ delayMs: 500 }));
  await assert.rejects(new McpClient({ serverId: 's', url: 'u', transport: slow, timeoutMs: 30 }).initialize(), (e: McpError) => e.code === 'timeout', 'timeout');
  checks++;
  const ctl = new AbortController();
  const p = new McpClient({ serverId: 's', url: 'u', transport: slow }).initialize(ctl.signal);
  setTimeout(() => ctl.abort(), 10);
  await assert.rejects(p, (e: McpError) => e.code === 'cancelled', 'cancelled by signal');
  checks++;
  const t3 = fakeTransport(() => ({ status: 202, body: '' }));
  await assert.rejects(new McpClient({ serverId: 's', url: 'u', transport: t3 }).initialize(), (e: McpError) => e.code === 'invalid', '202 to a request');
  checks++;
  const t4 = fakeTransport(() => ({ status: 200, headers: { 'content-type': 'text/html' }, body: '<html>' }));
  await assert.rejects(new McpClient({ serverId: 's', url: 'u', transport: t4 }).initialize(), (e: McpError) => e.code === 'invalid', 'html answer');
  checks++;
  const t5 = fakeTransport(() => { throw new Error('ECONNREFUSED'); });
  await assert.rejects(new McpClient({ serverId: 's', url: 'u', transport: t5 }).initialize(), (e: McpError) => e.code === 'unavailable' && e.error.retryable, 'network error is retryable');
  checks++;
}

// cancel(id) sends notifications/cancelled
{
  const seen: McpTransportRequest[] = [];
  const t = fakeTransport((_req, m) => {
    if (m?.method === 'initialize') return result(m.id, init());
    if (m?.method === 'notifications/initialized' || m?.method === 'notifications/cancelled') return { status: 202, body: '' };
    return { delayMs: 1000 };
  }, seen);
  const c = new McpClient({ serverId: 's', url: 'u', transport: t });
  await c.initialize();
  const p = c.callTool('slow');
  await new Promise((r) => setTimeout(r, 10));
  await c.cancel(2);
  await assert.rejects(p, (e: McpError) => e.code === 'timeout' || e.code === 'cancelled', 'cancelled call rejects');
  eq(seen.some((r) => r.body?.includes('notifications/cancelled') && r.body.includes('"requestId":2')), true, 'cancel notification sent');
}

/* ---------- 3. local host ---------- */
{
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } };
  const secrets = memorySecrets();
  const seen: McpTransportRequest[] = [];
  const h = localHost({ secrets, transport: fakeTransport((_req, m) => (m?.method === 'initialize' ? result(m.id, init('2025-06-18', {})) : { status: 202, body: '' }), seen) });
  const s = await h.registry.save({ name: 'axHub', url: 'https://hub/mcp', token: 'sEcReT-99' });
  eq(s.id, 'axhub', 'local id');
  eq(s.auth, 'token', 'auth kind');
  eq(store.get('axf:mcp-servers')!.includes('sEcReT-99'), false, 'token not in the record store');
  await assert.rejects(h.registry.save({ name: '', url: 'nope' }), (e: McpError) => e.code === 'validation', 'validation');
  checks++;
  const s2 = await h.registry.save({ id: 'axhub', name: 'axHub', url: 'https://hub/mcp' });
  eq(s2.auth, 'token', 'blank token keeps the stored one');
  const s3 = await h.registry.save({ id: 'axhub', name: 'axHub', url: 'https://hub/mcp', token: '' });
  eq(s3.auth, 'none', 'empty token clears it');
  await h.registry.save({ id: 'axhub', name: 'axHub', url: 'https://hub/mcp', token: 'again' });
  await h.open(s).connect();
  eq(seen[0]!.headers['authorization'], undefined, 'library headers carry no credential; the transport adds it');
  const ft = fetchTransport(secretCredentials(secrets), (async (_url: unknown, initReq: RequestInit) => new Response('{"jsonrpc":"2.0","id":1,"result":{}}', { status: 200, headers: { 'content-type': 'application/json', 'x-auth': String((initReq.headers as Record<string, string>).authorization ?? '') } })) as never);
  const res = await ft.request({ serverId: 'axhub', url: 'https://hub/mcp', method: 'POST', headers: mcpHeaders(), body: '{}' });
  eq(res.headers['x-auth'], 'Bearer again', 'fetch transport adds the bearer token');
  await h.registry.remove('axhub');
  eq(await secrets.get('axhub'), null, 'removing a server forgets its token');
  eq((await h.log.list()).length > 0, true, 'call log filled');
}

console.log(`mcp self-test ok: ${checks} checks`);
