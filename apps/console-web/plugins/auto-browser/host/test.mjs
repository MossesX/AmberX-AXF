#!/usr/bin/env node
/**
 * Browser host self-test: netguard rules, then a real headless Chromium driven over REST and the live websocket
 * against a local test page. Run: node --experimental-websocket host/test.mjs
 * (AXF_PLAYWRIGHT=<path to playwright-core/index.mjs> when playwright-core isn't installed next to the host).
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { blockedReason, normaliseUrl } from './netguard.mjs';
import { startHost } from './host.mjs';

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); pass++; console.log(`ok   ${name}`); }
  catch (e) { fail++; console.log(`FAIL ${name}\n     ${e.stack?.split('\n').slice(0, 3).join('\n     ')}`); }
}

// ---- netguard ----------------------------------------------------------------------------------------------------
delete process.env.AXF_BROWSER_ALLOW_PRIVATE;
await t('normalise: bare host gets https', () => assert.equal(normaliseUrl('example.com/x'), 'https://example.com/x'));
await t('normalise: host:port', () => assert.equal(normaliseUrl('example.com:8080'), 'https://example.com:8080/'));
await t('normalise: words become a search', () => assert.match(normaliseUrl('best pizza'), /duckduckgo\.com\/\?q=best%20pizza/));
await t('normalise: about:blank kept', () => assert.equal(normaliseUrl(''), 'about:blank'));
await t('guard: public https allowed', () => assert.equal(blockedReason('https://books.toscrape.com/'), ''));
for (const u of ['http://127.0.0.1:7090/', 'http://localhost/', 'http://10.0.0.5/', 'http://192.168.1.1/', 'http://172.20.0.3/', 'http://169.254.169.254/latest', 'http://[::1]/', 'http://axf-console:7090/', 'http://printer.local/', 'file:///etc/passwd', 'chrome://settings', 'javascript:alert(1)']) {
  await t(`guard: blocks ${u}`, () => assert.notEqual(blockedReason(u), ''));
}
await t('guard: private allowed when switched on', () => { process.env.AXF_BROWSER_ALLOW_PRIVATE = '1'; try { assert.equal(blockedReason('http://127.0.0.1/'), ''); } finally { delete process.env.AXF_BROWSER_ALLOW_PRIVATE; } });

// ---- live browser ------------------------------------------------------------------------------------------------
const PAGE = `<!doctype html><title>Test shop</title>
<h1 id="h">Products</h1>
<form onsubmit="event.preventDefault(); document.getElementById('out').textContent = 'hi ' + document.getElementById('user').value">
  <input id="user" name="user"><input id="pw" type="password"><select id="size"><option>S</option><option>M</option></select>
  <button id="go">Log in</button></form>
<p id="out"></p>
<ul><li class="p">Book A <b class="price">£10.00</b></li><li class="p">Book B <b class="price">£12.50</b></li></ul>
<table id="t"><tr><th>Name</th><th>Price</th></tr><tr><td>A</td><td>10</td></tr></table>
<a id="dl" href="/file.txt" download>get</a>
<button id="clicky" style="position:absolute;left:10px;top:400px;width:200px;height:60px" onclick="this.textContent='clicked'">click me</button>`;
const site = createServer((req, res) => {
  if (req.url === '/file.txt') { res.writeHead(200, { 'content-type': 'text/plain', 'content-disposition': 'attachment; filename="file.txt"' }); return res.end('hello file'); }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(PAGE);
});
await new Promise((ok) => site.listen(0, '127.0.0.1', ok));
const siteUrl = `http://127.0.0.1:${site.address().port}/`;

const data = mkdtempSync(join(tmpdir(), 'axf-browser-'));
process.env.AXF_BROWSER_ALLOW_PRIVATE = '1'; // the test page is on 127.0.0.1
const host = await startHost({ port: 0, host: '127.0.0.1', token: 'test-token', dataDir: data, log: () => {} });
const base = `http://127.0.0.1:${host.port}`;
const H = { authorization: 'Bearer test-token', 'content-type': 'application/json' };
const api = async (method, path, b) => {
  const r = await fetch(base + path, { method, headers: H, body: b ? JSON.stringify(b) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(`${r.status} ${j.detail}`), { status: r.status });
  return j;
};
const cmd = (c, a = {}) => api('POST', `/sessions/qa/${c}`, a);

try {
  await t('health answers without a token', async () => { const j = await (await fetch(`${base}/health`)).json(); assert.equal(j.ok, true); assert.ok(j.commands.includes('navigate')); });
  await t('token required', async () => { const r = await fetch(`${base}/sessions`); assert.equal(r.status, 401); });
  await t('bad workspace refused', async () => { await assert.rejects(api('POST', '/sessions', { workspace: '../etc' }), /400/); });
  await t('open a workspace browser', async () => { const j = await api('POST', '/sessions', { workspace: 'qa', url: siteUrl }); assert.equal(j.session.id, 'qa'); assert.equal(j.state.tabs.length, 1); });
  await t('navigate + title', async () => { const j = await cmd('navigate', { url: siteUrl }); assert.equal(j.title, 'Test shop'); assert.equal(j.status, 200); });
  await t('fill, select, click by selector', async () => {
    await cmd('fill', { selector: '#user', value: 'brett' });
    await cmd('fill', { selector: '#pw', value: 'hunter2' });
    await cmd('select', { selector: '#size', value: 'M' });
    await cmd('click', { selector: '#go' });
    assert.equal((await cmd('extract', { selector: '#out' })).value, 'hi brett');
  });
  await t('extract list, attribute, table, count', async () => {
    assert.deepEqual((await cmd('extract', { selector: '.price', all: true })).value, ['£10.00', '£12.50']);
    assert.equal((await cmd('extract', { selector: '#dl', kind: 'attr', attr: 'href' })).value, '/file.txt');
    assert.deepEqual((await cmd('extract', { selector: '#t', kind: 'table' })).value, [['Name', 'Price'], ['A', '10']]);
    assert.equal((await cmd('extract', { selector: 'li.p', kind: 'count' })).value, 2);
  });
  await t('screenshot is a PNG', async () => {
    const j = await cmd('screenshot');
    assert.equal(Buffer.from(j.data, 'base64').subarray(1, 4).toString(), 'PNG');
    const r = await fetch(`${base}/sessions/qa/screenshot.png`, { headers: H });
    assert.equal(r.headers.get('content-type'), 'image/png');
  });
  await t('typed passwords are not echoed to listeners', async () => {
    const s = host.sessions.get('qa'); const seen = [];
    const off = s.subscribe((m) => { if (m.t === 'command') seen.push(m); });
    await cmd('fill', { selector: '#pw', value: 'topsecret' }); off();
    assert.ok(!JSON.stringify(seen).includes('topsecret'));
  });
  await t('tabs: new, activate, close', async () => {
    const { tab } = await cmd('newTab', { url: siteUrl });
    let st = await cmd('state'); assert.equal(st.tabs.length, 2); assert.equal(st.active, tab);
    await cmd('activate', { tab: 't1' }); st = await cmd('state'); assert.equal(st.active, 't1');
    await cmd('closeTab', { tab }); st = await cmd('state'); assert.equal(st.tabs.length, 1);
  });
  await t('device switch to phone and back', async () => {
    assert.equal((await cmd('device', { preset: 'phone' })).device, 'phone');
    const w = (await cmd('extract', { selector: 'html', kind: 'count' })) && (await host.sessions.get('qa').page().evaluate(() => innerWidth));
    assert.equal(w, 390);
    await cmd('device', { preset: 'desktop' });
  });
  await t('back / forward / reload', async () => { await cmd('navigate', { url: siteUrl + '?2' }); await cmd('back'); assert.equal((await cmd('state')).url, siteUrl); await cmd('forward'); await cmd('reload'); assert.equal((await cmd('state')).url, siteUrl + '?2'); });
  await t('download saved and listed', async () => {
    await cmd('click', { selector: '#dl' });
    let items = [];
    for (let i = 0; i < 40 && !items.length; i++) { await new Promise((r) => setTimeout(r, 100)); items = (await api('GET', '/sessions/qa/downloads')).items; }
    assert.equal(items[0]?.name, 'file.txt');
    const r = await fetch(`${base}/sessions/qa/downloads/file.txt`, { headers: H }); assert.equal(await r.text(), 'hello file');
  });
  await t('unknown command refused', async () => { await assert.rejects(cmd('rm-rf'), /400/); });
  await t('private address refused when the guard is on', async () => {
    delete process.env.AXF_BROWSER_ALLOW_PRIVATE;
    try { await assert.rejects(cmd('navigate', { url: 'http://10.1.2.3/' }), /403/); } finally { process.env.AXF_BROWSER_ALLOW_PRIVATE = '1'; }
  });
  await t('live view: hello, frames, state, input by coordinates', async () => {
    assert.ok(globalThis.WebSocket, 'run with --experimental-websocket on Node 20');
    await cmd('navigate', { url: siteUrl });
    const ws = new WebSocket(`ws://127.0.0.1:${host.port}/sessions/qa/live?token=test-token`);
    const got = { hello: 0, frame: 0, state: 0 }; const results = {};
    ws.onmessage = (e) => { const m = JSON.parse(e.data); got[m.t] = (got[m.t] || 0) + 1; if (m.t === 'result' || m.t === 'error') results[m.id] = m; };
    await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no; });
    for (let i = 0; i < 50 && !got.frame; i++) await new Promise((r) => setTimeout(r, 100));
    assert.ok(got.hello >= 1 && got.frame >= 1, `hello ${got.hello}, frames ${got.frame}`);
    ws.send(JSON.stringify({ t: 'mouse', action: 'click', x: 100, y: 430, id: 'c1' }));
    ws.send(JSON.stringify({ t: 'cmd', cmd: 'extract', args: { selector: '#clicky' }, id: 'x1' }));
    for (let i = 0; i < 50 && !results.x1; i++) await new Promise((r) => setTimeout(r, 100));
    assert.equal(results.x1?.result?.value, 'clicked');
    ws.send(JSON.stringify({ t: 'cmd', cmd: 'nope', id: 'bad' }));
    for (let i = 0; i < 30 && !results.bad; i++) await new Promise((r) => setTimeout(r, 100));
    assert.equal(results.bad?.t, 'error');
    ws.close();
  });
  await t('live view needs the token', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${host.port}/sessions/qa/live`);
    const r = await new Promise((ok) => { ws.onopen = () => ok('open'); ws.onerror = () => ok('refused'); });
    assert.equal(r, 'refused');
  });
  await t('profile persists cookies across close/open', async () => {
    await host.sessions.get('qa').page().evaluate(() => { document.cookie = 'axf=1; max-age=3600'; });
    await api('DELETE', '/sessions/qa');
    await api('POST', '/sessions', { workspace: 'qa', url: siteUrl });
    assert.match(await host.sessions.get('qa').page().evaluate(() => document.cookie), /axf=1/);
  });
  await t('max sessions enforced', async () => {
    host.sessions.max = 1;
    await assert.rejects(api('POST', '/sessions', { workspace: 'other' }), /429/);
    host.sessions.max = 3;
  });
} finally {
  await host.stop();
  site.close();
  rmSync(data, { recursive: true, force: true });
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
