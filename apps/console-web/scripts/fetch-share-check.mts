// src/fetchShare.ts (urgent-console-perf, Nov 4 2026): identical in-flight /api GETs share one request, a hidden tab
// sends nothing until visible, a 5xx backs off exponentially, everything else passes through.
//   npx tsx scripts/fetch-share-check.mts
import assert from 'node:assert/strict';
import { createFetchShare } from '../src/fetchShare.ts';

let n = 0;
const t = async (name: string, fn: () => Promise<void> | void) => { try { await fn(); n += 1; console.log(`  ✓ ${name}`); } catch (e) { console.error(`✗ ${name}`); throw e; } };
const ORIGIN = 'https://console.example';

function harness(status = 200) {
  const calls: string[] = [];
  let code = status;
  let release: (() => void) | null = null;
  let gate: Promise<void> = Promise.resolve();
  const base = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${String(input)}`);
    await gate;
    return new Response(JSON.stringify({ ok: code < 400, n: calls.length }), { status: code, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const listeners = new Set<() => void>();
  const doc = {
    visibilityState: 'visible' as DocumentVisibilityState,
    addEventListener: (_: string, f: () => void) => { listeners.add(f); },
    removeEventListener: (_: string, f: () => void) => { listeners.delete(f); },
  } as unknown as Document;
  let clock = 1_000_000;
  const fs = createFetchShare(base, doc, ORIGIN, () => clock);
  return {
    fs, calls, doc,
    hold() { gate = new Promise((r) => { release = r; }); },
    release() { release?.(); },
    setStatus(s: number) { code = s; },
    advance(ms: number) { clock += ms; },
    show() { (doc as { visibilityState: string }).visibilityState = 'visible'; for (const f of [...listeners]) f(); },
    hide() { (doc as { visibilityState: string }).visibilityState = 'hidden'; },
  };
}

await t('identical GETs in flight send one request; each caller reads its own copy', async () => {
  const h = harness(); h.hold();
  const ps = Array.from({ length: 6 }, () => h.fs.fetch('/api/build-queue', { cache: 'no-store' }));
  h.release();
  const bodies = await Promise.all(ps.map(async (p) => (await p).json()));
  assert.equal(h.calls.length, 1); assert.equal(bodies.length, 6); assert.ok(bodies.every((b) => b.ok));
  assert.equal(h.fs.stats.shared, 5);
});
await t('once answered, the next poll sends a new request (no stale client cache)', async () => {
  const h = harness();
  await (await h.fs.fetch('/api/plan')).json(); await (await h.fs.fetch('/api/plan')).json();
  assert.equal(h.calls.length, 2);
});
await t('different URLs, tokens or a caller with its own abort signal are not shared', async () => {
  const h = harness(); h.hold();
  const ps = [h.fs.fetch('/api/a'), h.fs.fetch('/api/b'), h.fs.fetch('/api/a', { headers: { authorization: 'Bearer x' } }), h.fs.fetch('/api/a', { signal: new AbortController().signal })];
  h.release(); await Promise.all(ps);
  assert.equal(h.calls.length, 4);
});
await t('POST, other origins, non-/api paths, /api/events and x-axf-fetch: direct pass straight through', async () => {
  const h = harness(); h.hold();
  const ps = [h.fs.fetch('/api/a', { method: 'POST', body: '{}' }), h.fs.fetch('/api/a', { method: 'POST', body: '{}' }), h.fs.fetch('https://other.example/api/a'), h.fs.fetch('https://other.example/api/a'),
    h.fs.fetch('/data/plan.json'), h.fs.fetch('/data/plan.json'), h.fs.fetch('/api/events'), h.fs.fetch('/api/events'), h.fs.fetch('/api/x', { headers: { 'x-axf-fetch': 'direct' } }), h.fs.fetch('/api/x', { headers: { 'x-axf-fetch': 'direct' } })];
  h.release(); await Promise.all(ps);
  assert.equal(h.calls.length, 10);
});
await t('a hidden tab sends nothing until it is visible; pollers sharing a URL share the waiting request', async () => {
  const h = harness(); h.hide();
  const ps = [h.fs.fetch('/api/pending'), h.fs.fetch('/api/pending'), h.fs.fetch('/api/pending')];
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(h.calls.length, 0);
  h.show(); await Promise.all(ps);
  assert.equal(h.calls.length, 1);
});
await t('aborting a request held by a hidden tab rejects it and sends nothing', async () => {
  const h = harness(); h.hide();
  const ac = new AbortController(); const p = h.fs.fetch('/api/x', { signal: ac.signal });
  ac.abort(); await assert.rejects(p);
  h.show(); assert.equal(h.calls.length, 0);
});
await t('a 5xx backs the URL off 1 s, 2 s, 4 s … (503 at once, no request), a success resets it', async () => {
  const h = harness(500);
  assert.equal((await h.fs.fetch('/api/build-queue')).status, 500); assert.equal(h.calls.length, 1);
  const held = await h.fs.fetch('/api/build-queue');
  assert.equal(held.status, 503); assert.equal(held.headers.get('x-axf-backoff'), '1'); assert.equal(h.calls.length, 1);
  h.advance(1_001); await h.fs.fetch('/api/build-queue'); assert.equal(h.calls.length, 2);
  h.advance(1_500); await h.fs.fetch('/api/build-queue'); assert.equal(h.calls.length, 2, 'second failure waits 2 s');
  h.advance(600); await h.fs.fetch('/api/build-queue'); assert.equal(h.calls.length, 3);
  h.advance(4_001); h.setStatus(200); assert.equal((await h.fs.fetch('/api/build-queue')).status, 200);
  assert.equal((await h.fs.fetch('/api/build-queue')).status, 200); assert.equal(h.calls.length, 5);
  assert.equal((await h.fs.fetch('/api/other')).status, 200, 'other URLs never backed off');
});
await t('the backoff never exceeds 60 s', async () => {
  const h = harness(503);
  for (let i = 0; i < 12; i += 1) { await h.fs.fetch('/api/x'); h.advance(60_001); }
  assert.equal(h.calls.length, 12);
});

console.log(`fetch-share: ${n} checks passed`);
