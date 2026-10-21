/**
 * CI: the web client layer harvested Oct 2026 — SSE (core/sse.ts), the API client library (libs/apiclient) and the typed
 * catalog models (core/catalog.ts). Run: npx -y tsx framework/spec/check-web-client.mts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { followSse, parseSseText, readSse, sseBackoffMs, sseJson, SseHttpError, type SseFrame } from '../core/sse';
import { frameToEvent, parseSseText as assistantParse } from '../core/assistant';
import { ApiError, createApiClient, createTokenStore, dispositionName, errorMessage, STANDARD_MESSAGES } from '../libs/apiclient/client';
import { libraryCards, paramDefaultText, paramError, paramToJson, parseBoilerplate, parseBoilerplateIndex, parseCatalog, parseLibrariesIndex, parseLibrary, parseStatusMap, parseTracker } from '../core/catalog';

const root = new URL('..', import.meta.url).pathname;
const repo = join(root, '..');
let n = 0;
const fail = (m: string): never => { console.error(`FAIL: ${m}`); process.exit(1); };
const ok = (c: unknown, m: string) => { if (!c) fail(m); n++; };
const eq = (a: unknown, b: unknown, m: string) => { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) fail(`${m}\n  got  ${x}\n  want ${y}`); n++; };
const json = (f: string) => JSON.parse(readFileSync(f, 'utf8'));
const enc = new TextEncoder();
const stream = (chunks: string[]) => new ReadableStream<Uint8Array>({ start(c) { for (const x of chunks) c.enqueue(enc.encode(x)); c.close(); } });
const response = (chunks: string[], status = 200, headers: Record<string, string> = {}) => new Response(stream(chunks), { status, headers });

/* ---------------- SSE: the assistant@1 fixture still holds through the shared parser ---------------- */
{
  const a = json(join(root, 'spec/fixtures/assistant.json'));
  const got = parseSseText(a.sse.text);
  eq(got.frames, a.sse.frames, 'assistant fixture frames'); eq(got.rest, a.sse.rest, 'assistant fixture rest');
  eq(got.frames.map(frameToEvent), a.sse.events, 'assistant fixture events');
  eq(assistantParse(a.sse.text), got, 'assistant re-exports the same parser');
}
{
  const frames: SseFrame[] = [];
  // a frame split across chunks (and a multi-byte character split across chunks), comments, CRLF, multi-line data
  const euro = enc.encode('€');
  const s = new ReadableStream<Uint8Array>({ start(c) {
    c.enqueue(enc.encode(': hi\r\n\r\nid: 4\r\nevent: step\r\ndata: {"a":')); c.enqueue(enc.encode('1}\r\n\r\ndata: x')); c.enqueue(euro.slice(0, 1)); c.enqueue(euro.slice(1));
    c.enqueue(enc.encode('\ndata: y\n\ndata: tail-without-end')); c.close();
  } });
  await readSse(s, (f) => frames.push(f));
  eq(frames, [{ event: 'step', data: '{"a":1}', id: 4 }, { event: 'message', data: 'x€\ny' }], 'readSse: chunks, CRLF, comments, multi-line data; unfinished tail dropped');
  eq(sseJson(frames[0]!), { a: 1 }, 'sseJson'); eq(sseJson(frames[1]!), undefined, 'sseJson on text');
}
{
  let err: unknown;
  try { await readSse(new Response(JSON.stringify({ detail: 'batch not found' }), { status: 404 }), () => {}); } catch (e) { err = e; }
  ok(err instanceof SseHttpError && err.message === 'batch not found' && err.status === 404, 'refused stream → detail');
  try { await readSse(new Response('nope', { status: 502 }), () => {}); } catch (e) { err = e; }
  ok(err instanceof SseHttpError && err.message === 'request failed (502)', 'refused stream without JSON → request failed (502)');
}
{
  // abort mid-stream returns quietly
  const ac = new AbortController();
  let pull = 0;
  const s = new ReadableStream<Uint8Array>({ pull(c) { pull++; if (pull === 1) c.enqueue(enc.encode('data: 1\n\n')); else return new Promise(() => {}); } });
  const got: string[] = [];
  const p = readSse(s, (f) => { got.push(f.data); ac.abort(); }, ac.signal);
  await Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('abort did not end the read')), 2000))]);
  eq(got, ['1'], 'abort ends the read');
}
{
  eq([1, 2, 3, 6, 7, 10].map((k) => sseBackoffMs(k)), [2000, 4000, 8000, 60000, 60000, 60000], 'back-off 2 s doubling, capped at 60 s');
  // followSse: two drops then a stream, reconnecting with back-off; stop() ends it
  const waits: number[] = []; const frames: string[] = []; let opens = 0;
  let stop: () => void = () => {};
  const done = new Promise<void>((resolve) => {
    stop = followSse(async () => {
      opens++;
      if (opens === 1) throw new Error('offline');
      if (opens === 2) return new Response('x', { status: 503 });
      if (opens === 3) return response(['data: {"alerts":[1]}\n\n']);
      resolve(); return new Promise<Response>(() => {});
    }, (f) => frames.push(f.data), { sleep: async (ms) => { waits.push(ms); } });
  });
  await done; stop();
  eq(frames, ['{"alerts":[1]}'], 'followSse hands frames over'); eq(waits, [2000, 4000, 2000], 'followSse backs off, resets after an open stream');
}

/* ---------------- token store ---------------- */
{
  const mem = new Map<string, string>();
  const events: string[] = [];
  const g = globalThis as unknown as Record<string, unknown>;
  // a browser window is an EventTarget; Node's globalThis isn't, so lend it one for the test
  const et = new EventTarget();
  g.addEventListener = et.addEventListener.bind(et); g.removeEventListener = et.removeEventListener.bind(et); g.dispatchEvent = et.dispatchEvent.bind(et);
  g.localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); } };
  const t = createTokenStore({ key: 'axf-console:token', event: 'axf:token-changed' });
  const off = t.subscribe(() => events.push('changed'));
  t.set('abc'); eq([t.get(), mem.get('axf-console:token')], ['abc', 'abc'], 'token saved under its key');
  t.set(''); eq([t.get(), mem.has('axf-console:token')], ['', false], 'empty clears');
  off(); t.set('z');
  eq(events, ['changed', 'changed'], 'change event fires on set/clear, unsubscribe stops it');
  eq(createTokenStore({ key: 'k' }).event, 'k:changed', 'default event name');
  g.localStorage = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } };
  const b = createTokenStore({ key: 'x' });
  b.set('q'); eq(b.get(), '', 'blocked storage reads as no token and never throws');
  g.localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); } };
}

/* ---------------- API client: the standard messages, exactly as the console's copies had them ---------------- */
{
  const tokens = createTokenStore({ key: 'axf-console:token' });
  tokens.set('tok');
  const seen: { url: string; init: RequestInit }[] = [];
  const reply = { status: 200, body: '{}' as string, headers: {} as Record<string, string> };
  const api = createApiClient({
    url: (p) => `/api/plugins/x/${p.replace(/^\/+/, '')}`, tokens,
    fetch: async (url, init) => { seen.push({ url, init }); return new Response(reply.body, { status: reply.status, headers: reply.headers }); },
    messages: { unauthorized: STANDARD_MESSAGES.unauthorized('Settings → Account & security'), unavailable: STANDARD_MESSAGES.unavailable('The agent manager plugin') },
  });
  reply.body = '{"items":[1]}';
  eq(await api.call('/c/agents'), { items: [1] }, 'call returns the JSON');
  const h = new Headers(seen[0]!.init.headers);
  eq([seen[0]!.url, h.get('authorization'), h.get('content-type'), seen[0]!.init.cache], ['/api/plugins/x/c/agents', 'Bearer tok', null, 'no-store'], 'Bearer token, no content type on GET, no-store');
  await api.post('save', { a: 1 });
  const h2 = new Headers(seen[1]!.init.headers);
  eq([seen[1]!.init.method, seen[1]!.init.body, h2.get('content-type')], ['POST', '{"a":1}', 'application/json'], 'post sends JSON');
  const fails: [number, string, string][] = [
    [401, '{"detail":"bad token"}', 'Console token required (Settings → Account & security).'],
    [404, '{}', 'The agent manager plugin is disabled or its server part is not running.'],
    [404, '{"detail":"agent not found"}', 'agent not found'],
    [400, '{"detail":[{"msg":"x"}]}', '[{"msg":"x"}]'],
    [500, 'not json', '""'],
  ];
  for (const [status, body, msg] of fails) {
    reply.status = status; reply.body = body;
    let e: unknown; try { await api.call('x'); } catch (x) { e = x; }
    ok(e instanceof ApiError && e.status === status, `ApiError with status ${status}`);
    eq((e as Error).message, msg, `message for ${status} ${body}`);
  }
  eq(errorMessage(500, 'Internal Server Error', {}, { messages: {} }), '"Internal Server Error"', 'no detail → JSON of statusText (as the old copies)');
  eq(errorMessage(401, '', { detail: 'expired' }, { messages: { unauthorized: 'Sign in.' }, preferDetail: true }), 'expired', 'preferDetail lets the server word a 401');
  eq(STANDARD_MESSAGES.unavailable('Snapshot Manager'), 'Snapshot Manager is disabled or its server part is not running.', 'standard 404 sentence');
  eq(dispositionName('attachment; filename="app-debug.apk"', 'x'), 'app-debug.apk', 'download name'); eq(dispositionName('attachment; filename="../x"', 'f.bin'), 'f.bin', 'no paths in download names');
  // unreachable
  const down = createApiClient({ url: (p) => p, tokens, fetch: async () => { throw new TypeError('fetch failed'); }, messages: { unreachable: 'The Build Pilot server is not reachable.' } });
  let e: unknown; try { await down.call('x'); } catch (x) { e = x; }
  ok(e instanceof ApiError && e.status === 0 && e.message === 'The Build Pilot server is not reachable.', 'unreachable → ApiError 0');
  reply.status = 200; reply.body = 'PNG'; reply.headers = { 'content-type': 'text/plain' };
  try { await api.blob('img', undefined, /^image\//); e = null; } catch (x) { e = x; }
  ok(e instanceof ApiError && e.status === 415, 'blob refuses an unexpected type');
}

/* ---------------- catalog: fixture replay + the real files ---------------- */
{
  const f = json(join(root, 'spec/fixtures/catalog.json'));
  const s = f.inputs;
  eq(parseCatalog(s.catalog), f.catalog, 'catalog'); eq(parseStatusMap(s.status), f.status, 'status'); eq(parseTracker(s.tracker), f.tracker, 'tracker');
  eq(parseLibrariesIndex(s.libraries), f.libraries, 'libraries'); eq(s.boilerplates.map(parseBoilerplate), f.boilerplates, 'boilerplates');
  eq(parseBoilerplateIndex(s.boilerplateIndex), f.boilerplateIndex, 'boilerplate index'); eq(parseLibrary(s.lenient.library), f.lenient.library, 'lenient library');
  for (const c of f.params) {
    eq(paramDefaultText(c.param), c.defaultText, `default text ${c.param.key}`);
    for (const a of c.answers) { eq(paramToJson(c.param, a.text) ?? null, a.json, `${c.param.key} <- ${a.text}`); eq(paramError(c.param, a.text), a.error, `${c.param.key} error ${a.text}`); }
  }
  eq(libraryCards(f.catalog, f.libraries.items, f.tracker), f.libraryCards, 'library cards');
}
{
  // The real files: every library the old hard-coded lists named is still there, and the new ones appear by themselves.
  const catalog = parseCatalog(json(join(root, 'catalog/catalog.json')));
  const libs = parseLibrariesIndex(json(join(root, 'catalog/libraries.json'))).items;
  const tracker = parseTracker(json(join(repo, 'tracker.json')));
  const cards = libraryCards(catalog, libs, tracker);
  const old = ['settings', 'logging', 'admin', 'accounts', 'profile', 'billing', 'browser', 'media', 'location', 'editor', 'ai', 'vps', 'github', 'work', 'notifications', 'sensors', 'files', 'charts', 'plugins'];
  eq(cards.slice(0, old.length).map((c) => c.id), old, 'the 19 libraries of the old lists come first, in the same order');
  for (const id of ['voice', 'lock', 'mcp', 'browser']) ok(cards.some((c) => c.id === id && c.installable), `lib-${id} appears and is installable`);
  ok(new Set(cards.map((c) => c.id)).size === cards.length, 'no duplicate cards');
  const boilerplates = parseBoilerplateIndex(json(join(root, 'boilerplates/index.json')));
  ok(boilerplates.items.length > 10 && boilerplates.items.every((b) => b.id && b.name), 'boilerplate index parses');
  for (const b of boilerplates.items) ok(parseBoilerplate(json(join(root, 'boilerplates', b.id, 'boilerplate.json'))).id === b.id, `boilerplate ${b.id} parses`);
  ok(libs.some((l) => l.id === 'ai.amberx.axf.apiclient' && l.ports?.web?.dir === 'libs/apiclient'), 'the API client library is registered');
}

console.log(`web client (sse, apiclient, catalog): ${n} checks passed`);
