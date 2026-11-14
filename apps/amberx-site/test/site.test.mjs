import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bake } from '../bake.mjs';
import { createSite } from '../server.mjs';
import { createWaitlist } from '../lib/waitlist.mjs';
import { videoEmbed } from '../src/page.mjs';

let dir, server, base;
const TOKEN = 'test-token';
const req = async (method, path, body, auth = false) => {
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${TOKEN}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: r.status, json, text, type: r.headers.get('content-type') };
};

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'amberx-site-'));
  await bake();
  const site = createSite({ dataDir: join(dir, 'data'), adminToken: TOKEN, publicUrl: 'https://amberxai.test' });
  server = createServer(site.handle);
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server?.close(); rmSync(dir, { recursive: true, force: true }); });

test('landing page renders hook, demo slot, features, pricing and waitlist', async () => {
  const r = await req('GET', '/');
  assert.equal(r.status, 200);
  for (const s of ['Talk, and it builds your app.', 'id="demo"', 'id="features"', 'id="pricing"', 'id="waitlist"', '$30', '14-day free trial']) assert.ok(r.text.includes(s), s);
  assert.ok(r.text.includes('data-site-video="empty"'));
});

test('theme.css compiles the chosen themes to --fx-* tokens', async () => {
  const r = await req('GET', '/theme.css?color=fresh-light&style=swiss');
  assert.match(r.text, /color-scheme: light/);
  assert.match(r.text, /--fx-accent: /);
  assert.match(r.text, /--fx-type-scale-2xl: /);
  assert.match(r.text, /--fx-dens-gap-xl: /);
});

test('referrals move people up the line', async () => {
  const first = (await req('POST', '/api/waitlist', { email: 'First@Example.com' })).json;
  for (let i = 0; i < 8; i++) await req('POST', '/api/waitlist', { email: `p${i}@example.com` });
  const late = (await req('POST', '/api/waitlist', { email: 'late@example.com' })).json;
  assert.equal(late.position, 10);
  await req('POST', '/api/waitlist', { email: 'friend1@example.com', ref: late.code });
  const after1 = (await req('GET', `/api/waitlist/${late.code}`)).json;
  assert.equal(after1.referrals, 1);
  assert.equal(after1.position, 5, 'one referral = 5 places up');
  assert.equal(after1.link, `https://amberxai.test/?ref=${late.code}`);
  const again = await req('POST', '/api/waitlist', { email: 'first@example.com' });
  assert.equal(again.status, 200);
  assert.equal(again.json.code, first.code, 'same email returns the same entry');
});

test('bad email is refused', async () => {
  const r = await req('POST', '/api/waitlist', { email: 'not-an-email' });
  assert.equal(r.status, 400);
});

test('admin API needs the token; list, invite, export, settings', async () => {
  assert.equal((await req('GET', '/api/admin/waitlist')).status, 401);
  const list = (await req('GET', '/api/admin/waitlist', null, true)).json;
  assert.ok(list.entries.length >= 11);
  assert.equal(list.entries[0].position, 1);
  const top = list.entries[0].code;
  const inv = await req('PATCH', `/api/admin/waitlist/${top}`, { status: 'invited' }, true);
  assert.equal(inv.json.position, 0);
  const csv = await req('GET', '/api/admin/waitlist.csv', null, true);
  assert.match(csv.type, /text\/csv/);
  assert.match(csv.text.split('\n')[0], /^position,email,code,referrals/);
  const set = await req('PUT', '/api/admin/settings', { hook: 'Say it. Ship it.', videoUrl: 'https://youtu.be/dQw4w9WgXcQ', pricing: { checkoutUrl: 'https://buy.stripe.com/test' } }, true);
  assert.equal(set.status, 200);
  const page = (await req('GET', '/')).text;
  assert.ok(page.includes('Say it. Ship it.'));
  assert.ok(page.includes('youtube-nocookie.com/embed/dQw4w9WgXcQ'));
  assert.ok(page.includes('data-site-action="checkout"'));
  assert.equal((await req('PUT', '/api/admin/settings', { colorTheme: 'nope' }, true)).status, 400);
  assert.equal((await req('PUT', '/api/admin/settings', { bogus: 1 }, true)).status, 400);
  await req('POST', '/api/admin/settings/reset', null, true);
});

test('removing a referred entry takes the credit back', () => {
  const d = mkdtempSync(join(tmpdir(), 'amberx-wl-'));
  const wl = createWaitlist(d);
  const a = wl.join({ email: 'a@x.io' }).entry;
  const b = wl.join({ email: 'b@x.io', ref: a.code }).entry;
  assert.equal(wl.byCode(a.code).referrals, 1);
  wl.remove(b.code);
  assert.equal(wl.byCode(a.code).referrals, 0);
  rmSync(d, { recursive: true, force: true });
});

test('csv neutralises spreadsheet formulas', () => {
  const d = mkdtempSync(join(tmpdir(), 'amberx-wl-'));
  const wl = createWaitlist(d);
  wl.join({ email: '=cmd@x.io' });
  assert.match(wl.csv('https://s'), /'=cmd@x\.io/);
  rmSync(d, { recursive: true, force: true });
});

test('video links become embeds', () => {
  assert.equal(videoEmbed('https://vimeo.com/123456').kind, 'iframe');
  assert.equal(videoEmbed('https://cdn.example.com/demo.mp4').kind, 'video');
  assert.equal(videoEmbed(''), null);
});
