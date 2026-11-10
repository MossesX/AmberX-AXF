// Self-test: node apps/console-web/plugins/build-orchestrator/api-jobs.test.mjs
// API jobs core (prompt caching, batch routing, cost and savings) + api-jobs.mjs against a local stub of the API.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as AJ from './api-jobs-core.mjs';
import * as P from './pipeline-core.mjs';
import { costUsd } from '../../../../framework/cli/model-pricing.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
let n = 0; const t = async (name, fn) => { try { await fn(); } catch (e) { console.error(`✗ ${name}`); throw e; } n += 1; };
const price = (m, tk) => costUsd(m, tk);

await t('messageRequest: cache breakpoints on system, last tool and stable context; prompt uncached', () => {
  const b = AJ.messageRequest({ model: 'claude-opus-5-5', system: 'sys', tools: [{ name: 'a' }, { name: 'b' }], stable: 'rules', prompt: 'this build' });
  assert.deepEqual(b.system, [{ type: 'text', text: 'sys', cache_control: { type: 'ephemeral' } }]);
  assert.equal(b.tools[0].cache_control, undefined); assert.deepEqual(b.tools[1].cache_control, { type: 'ephemeral' });
  assert.deepEqual(b.messages[0].content.map((c) => [c.text, !!c.cache_control]), [['rules', true], ['this build', false]]);
  assert.equal(AJ.cacheBreakpoints(b), 3);
  const off = AJ.messageRequest({ model: 'm', system: 'sys', stable: 'rules', prompt: 'p', cache: false });
  assert.equal(AJ.cacheBreakpoints(off), 0);
  assert.equal(AJ.messageRequest({ model: 'm', prompt: 'p' }).system, undefined);
});
await t('split parts: the stable rules are the same for every build; the joined prompt keeps the old text', () => {
  const a = P.splitParts({ id: 'a', title: 'A' }); const b = P.splitParts({ id: 'b', title: 'B', detail: 'x' });
  assert.equal(a.stable, b.stable); assert.equal(a.system, b.system); assert.notEqual(a.prompt, b.prompt);
  assert.match(P.splitPrompt({ id: 'a', title: 'A' }), /^You are the AmberX AXF build orchestrator[\s\S]*Rules:[\s\S]*Build id: a\nTitle: A$/);
});
await t('pathFor: non-urgent → batch, urgent (P0/P1, job.urgent, batch off) → messages', () => {
  const s = P.normSettings({});
  assert.equal(s.apiBatch, true); assert.equal(s.apiCache, true); assert.equal(s.apiDirect, true);
  assert.equal(AJ.pathFor({ priority: 'P2' }, s), 'batch'); assert.equal(AJ.pathFor({ priority: 'P1' }, s), 'messages');
  assert.equal(AJ.pathFor({ priority: 'P3', urgent: true }, s), 'messages'); assert.equal(AJ.pathFor({ priority: 'P0', urgent: false }, s), 'batch');
  assert.equal(AJ.pathFor({ priority: 'P2' }, P.normSettings({ apiBatch: false })), 'messages');
  assert.equal(AJ.pathFor({ priority: 'P1' }, P.normSettings({ apiUrgent: 'P0' })), 'batch');
});
await t('batchRequest / batchResult / customId', () => {
  assert.equal(AJ.customId('split', 'a.b c'), 'split-a-b-c'); assert.ok(AJ.customId('split', 'x'.repeat(100)).length <= 64);
  assert.deepEqual(AJ.batchRequest([{ customId: 'split-a', body: { model: 'm' } }, { customId: '' }]), { requests: [{ custom_id: 'split-a', params: { model: 'm' } }] });
  const ok = AJ.batchResult({ custom_id: 'split-a', result: { type: 'succeeded', message: { model: 'claude-opus-5-5', content: [{ type: 'text', text: '{"steps":[]}' }], usage: { input_tokens: 5 } } } });
  assert.deepEqual([ok.ok, ok.text, ok.usage.input_tokens], [true, '{"steps":[]}', 5]);
  const bad = AJ.batchResult({ custom_id: 'split-b', result: { type: 'errored', error: { error: { message: 'overloaded' } } } });
  assert.deepEqual([bad.ok, bad.error], [false, 'overloaded']);
  assert.equal(AJ.batchResult({ custom_id: 'x', result: { type: 'expired' } }).error, 'expired');
});
await t('jobCost: cache read saves 90% of its input, batch halves the bill', () => {
  // opus: input 4, output 20, cacheRead 0.2, cacheWrite 5 per M tokens (model-pricing@1)
  const u = { input_tokens: 1000, output_tokens: 1000, cache_read_input_tokens: 10000, cache_creation_input_tokens: 0 };
  const d = AJ.jobCost('claude-opus-5-5', u, { price });
  assert.equal(d.fullUsd, (11000 * 4 + 1000 * 20) / 1e6); assert.equal(d.usd, (1000 * 4 + 10000 * 0.2 + 1000 * 20) / 1e6);
  assert.equal(d.cacheSaved, Math.round((d.fullUsd - d.usd) * 1e6) / 1e6); assert.equal(d.batchSaved, 0); assert.equal(d.cacheHit, true);
  const b = AJ.jobCost('claude-opus-5-5', u, { batch: true, price });
  assert.equal(b.usd, d.usd / 2); assert.equal(b.batchSaved, d.usd / 2);
  const miss = AJ.jobCost('claude-opus-5-5', { input_tokens: 10, cache_creation_input_tokens: 1000 }, { price });
  assert.equal(miss.cacheHit, false); assert.ok(miss.cacheSaved < 0, 'a cache write costs more than plain input');
  assert.equal(AJ.jobCost('mystery', u, { price }).usd, null);
});
await t('ledger + summarize: totals, hit rate, savings, since', () => {
  const rows = [
    AJ.ledgerEntry({ at: '2026-11-09T10:00:00Z', kind: 'split', id: 'a', account: 'k', model: 'claude-opus-5-5', path: 'messages', usage: { input_tokens: 100, cache_creation_input_tokens: 2000, output_tokens: 500 }, price }),
    AJ.ledgerEntry({ at: '2026-11-10T10:00:00Z', kind: 'split', id: 'b', account: 'k', model: 'claude-opus-5-5', path: 'batch', batchId: 'msgbatch_1', usage: { input_tokens: 100, cache_read_input_tokens: 2000, output_tokens: 500 }, price }),
    AJ.ledgerEntry({ at: '2026-11-10T11:00:00Z', kind: 'split', id: 'c', account: 'k', model: 'claude-opus-5-5', path: 'batch', usage: {}, price, error: 'expired' }),
  ];
  assert.equal(rows[0].$axf, 'api-usage@1'); assert.equal(rows[1].path, 'batch');
  const s = AJ.summarize(rows);
  assert.deepEqual([s.jobs, s.batch, s.messages, s.errors, s.cacheHits, s.cacheRead, s.cacheWrite], [3, 2, 1, 1, 1, 2000, 2000]);
  assert.ok(s.batchSaved > 0); assert.equal(s.saved, Math.round((s.cacheSaved + s.batchSaved) * 1e6) / 1e6);
  assert.equal(AJ.summarize(rows, { since: '2026-11-10' }).jobs, 2);
  assert.match(AJ.usageLine(s), /^3 jobs \(2 batch, 1 direct\) · \$\d+\.\d{4} · saved .* cache hits 1\/3 · 1 failed$/);
});

// ---------------- api-jobs.mjs against a stub API
const seen = [];
const server = createServer((req, res) => {
  let body = ''; req.on('data', (c) => { body += c; }); req.on('end', () => {
    seen.push({ method: req.method, url: req.url, key: req.headers['x-api-key'], version: req.headers['anthropic-version'], body: body ? JSON.parse(body) : null });
    const send = (code, v, type = 'application/json') => { res.writeHead(code, { 'content-type': type }); res.end(typeof v === 'string' ? v : JSON.stringify(v)); };
    if (req.url === '/v1/messages') return send(200, { model: 'claude-opus-5-5', content: [{ type: 'text', text: 'hi' }], usage: { input_tokens: 3, output_tokens: 1, cache_read_input_tokens: 9 } });
    if (req.url === '/v1/messages/batches') return send(200, { id: 'msgbatch_1', processing_status: 'in_progress' });
    if (req.url === '/v1/messages/batches/msgbatch_1') return send(200, { id: 'msgbatch_1', processing_status: 'ended' });
    if (req.url === '/v1/messages/batches/msgbatch_1/results') return send(200, `${JSON.stringify({ custom_id: 'split-a', result: { type: 'succeeded', message: { content: [{ type: 'text', text: 'ok' }], usage: {} } } })}\n`, 'application/x-jsonl');
    return send(404, { error: { message: 'not found' } });
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;
const run = (args, input, key = 'sk-test') => new Promise((done) => {
  const c = spawn(process.execPath, [join(HERE, 'api-jobs.mjs'), ...args], { env: { ...process.env, AXF_ANTHROPIC_BASE: BASE, ANTHROPIC_API_KEY: key } });
  let out = ''; c.stdout.on('data', (d) => { out += d; }); c.on('close', (code) => done({ code, j: JSON.parse(out || '{}') }));
  c.stdin.end(input ? JSON.stringify(input) : '');
});
await t('send: key and version headers, the cached body as built', async () => {
  const body = AJ.messageRequest({ model: 'claude-opus-5-5', system: 's', stable: 'r', prompt: 'p' });
  const r = await run(['send'], body);
  assert.equal(r.code, 0); assert.equal(AJ.messageText(r.j.message), 'hi');
  const req = seen.at(-1); assert.deepEqual([req.method, req.key, req.version], ['POST', 'sk-test', AJ.API_VERSION]); assert.equal(AJ.cacheBreakpoints(req.body), 2);
});
await t('batch create / get / results', async () => {
  const c = await run(['batch-create'], AJ.batchRequest([{ customId: 'split-a', body: { model: 'm' } }]));
  assert.equal(c.j.batch.id, 'msgbatch_1'); assert.equal(seen.at(-1).body.requests[0].custom_id, 'split-a');
  assert.equal((await run(['batch-get', 'msgbatch_1'])).j.batch.processing_status, 'ended');
  const res = await run(['batch-results', 'msgbatch_1']);
  assert.equal(AJ.batchResult(res.j.results[0]).text, 'ok');
});
await t('errors: HTTP error message, no key, usage', async () => {
  const e = await run(['batch-get', 'nope']); assert.equal(e.code, 1); assert.match(e.j.error, /HTTP 404: not found/);
  const k = await run(['send'], { model: 'm' }, ''); assert.equal(k.code, 1); assert.match(k.j.error, /no API key/);
  const u = await new Promise((done) => spawn(process.execPath, [join(HERE, 'api-jobs.mjs')], { stdio: 'ignore' }).on('close', done)); assert.equal(u, 2);
});
server.close();
console.log(`api-jobs: ${n} checks passed`);
