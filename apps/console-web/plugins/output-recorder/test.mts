// @ts-nocheck: a Node test, not part of the console's build
/**
 * Audio Output Recorder self-test: the pure rules (settings, ids, hub paths, parts under 64 KB, base64, the index
 * check), the recorder state machine, a fake axHub data server (list, download with checksum, delete = stubs) and the
 * controller against a fake native bridge. Plus static checks on the native side: the mic only as an opt-in second
 * track (left = mic, right = playback), released on stop, no second listener; one consent flow.
 *   node --experimental-strip-types apps/console-web/plugins/output-recorder/test.mts   (or npx -y tsx …)
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import {
  DEFAULTS, HUB_DOC_MAX, K, PART_BYTES, REC_IDLE, HubRecordings, byDay, byGroup, cleanSession, sessionPartName, capHours, chunkBytes, chunkName, cleanProject, dataUrl, fromBase64, hubHours, hubOf,
  idDate, idOfIndex, indexPath, isChunkId, normalizeIndex, partCount, partPath, readSettings, recReduce, splitParts, toBase64,
  TRACKS, busySpans, micLine,
} from './web/core.ts';
import { createController } from './web/store.ts';

let n = 0;
const t = async (name: string, f: () => void | Promise<void>) => {
  try { await f(); n++; } catch (e) { console.error(`✗ ${name}`); throw e; }
};
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 20; i++) await tick(); };

/* ---------------------------------------------------------------- pure rules */

await t('sessions from axHub: part names (twin of RecorderControl.partName), groups', () => {
  const at = new Date(2026, 10, 1, 9, 5); // local time, like the phone
  assert.equal(sessionPartName('axHub build', at, 1), 'axHub build - 2026-11-01 09-05 - part1');
  assert.equal(sessionPartName('axHub build', at, 3), 'axHub build - 2026-11-01 09-05 - part3');
  assert.equal(sessionPartName('a/b:c', at, 0), 'a b c - 2026-11-01 09-05 - part1');
  assert.equal(cleanSession('  '), 'Session');
  assert.equal(cleanSession('x'.repeat(200)).length, 80);
  const rec = (id: string, group = '') => ({ id, name: id, startedAt: '', endedAt: '', durationMs: 0, bytes: 0, mime: 'audio/mp4', kbps: 32, channels: 1, device: '', parts: 0, sha256: '', uploadedAt: '', deleted: false, group, session: group, note: '' });
  const g = byGroup([rec('20261101-090500-aaaa', 'Build'), rec('20261101-093500-bbbb', 'Build'), rec('20261101-120000-cccc'), rec('20261031-100000-dddd')]);
  assert.deepEqual(g.map((x) => x.label), ['2026-11-01', 'Build', '2026-10-31']);
  assert.deepEqual(g[1]!.items.map((r) => r.id), ['20261101-090500-aaaa', '20261101-093500-bbbb']); // part1 first
  assert.equal(g[1]!.group, true);
});


await t('settings: defaults, bounds, bad values', () => {
  assert.deepEqual(readSettings(() => undefined), DEFAULTS);
  const s = readSettings((k) => ({ [K.kbps]: '64', [K.channels]: 2, [K.chunkMin]: 999, [K.capMb]: 1, [K.whenFull]: 'drop-oldest', [K.skipSilent]: false, [K.project]: 'My-Recs' } as Record<string, unknown>)[k]);
  assert.deepEqual(s, { kbps: 64, channels: 2, chunkMin: 60, capMb: 50, whenFull: 'drop-oldest', skipSilent: false, project: 'my-recs', mic: false });
  assert.equal(readSettings((k) => (k === K.kbps ? 33 : undefined)).kbps, 32);
  assert.equal(cleanProject('../etc'), 'amberx-recordings');
  assert.equal(cleanProject('amberx-axf'), 'amberx-axf');
  assert.equal(cleanProject(''), 'amberx-recordings');
});

await t('mic: "Record my mic too" is off by default, on only when explicitly true', () => {
  assert.equal(DEFAULTS.mic, false);
  assert.equal(readSettings(() => undefined).mic, false);
  for (const v of ['true', 1, 'on', null, {}]) assert.equal(readSettings((k) => (k === K.mic ? v : undefined)).mic, false, String(v));
  assert.equal(readSettings((k) => (k === K.mic ? true : undefined)).mic, true);
  assert.equal(K.mic, 'output-recorder.mic');
  assert.deepEqual(TRACKS, { left: 'mic', right: 'playback' });
  assert.equal(micLine(false, false), 'mic off');
  assert.equal(micLine(true, false), 'playback + mic');
  assert.equal(micLine(true, true), 'mic busy: playback only');
});

await t('mic: busy and back, stop mic, stop releases it (state)', () => {
  let s = recReduce(REC_IDLE, { type: 'native', e: { state: 'recording', startedAt: '2026-11-01T09:00:00.000Z', mic: true } });
  assert.equal(s.mic, true);
  assert.equal(s.micBusy, '');
  s = recReduce(s, { type: 'native', e: { state: 'micBusy', reason: 'silenced', message: 'another app is using the mic' } });
  assert.equal(s.running, true); // the recording goes on
  assert.equal(s.micBusy, 'silenced');
  assert.match(s.note, /playback only/);
  s = recReduce(s, { type: 'native', e: { state: 'micBack' } });
  assert.equal(s.micBusy, '');
  s = recReduce(s, { type: 'native', e: { state: 'micBusy', reason: 'stopped' } });
  assert.equal(s.mic, false); // Stop mic from the notification
  assert.equal(s.running, true);
  s = recReduce(s, { type: 'native', e: { state: 'stopped' } });
  assert.equal(s.mic, false);
  assert.equal(s.micBusy, '');
  // a recording started before the page opened
  s = recReduce(REC_IDLE, { type: 'status', status: { running: true, startedAt: 'x', mic: true, micBusy: 'unavailable' } });
  assert.deepEqual([s.mic, s.micBusy], [true, 'unavailable']);
  s = recReduce(s, { type: 'status', status: { running: false } });
  assert.deepEqual([s.mic, s.micBusy], [false, '']);
  // a playback-only recording never shows a mic
  assert.equal(recReduce(REC_IDLE, { type: 'native', e: { state: 'recording', startedAt: 'x' } }).mic, false);
});

await t('mic: the index of a two-track chunk (tracks, busy spans checked)', () => {
  const id = '20261101-090000-abcd';
  const base = { $axf: 'audio-recording@1', id, bytes: 10, parts: 1 };
  const r = normalizeIndex({ ...base, mic: true, tracks: { left: 'mic', right: 'playback' }, micBusy: [{ fromMs: 0, toMs: 4000, reason: 'unavailable' }, { fromMs: 9000, toMs: 8000, reason: 'x' }, { fromMs: 10_000, toMs: 12_000, reason: 'odd' }] }, id)!;
  assert.equal(r.mic, true);
  assert.deepEqual(r.micBusy, [{ fromMs: 0, toMs: 4000, reason: 'unavailable' }, { fromMs: 10_000, toMs: 12_000, reason: 'unavailable' }]);
  const plain = normalizeIndex(base, id)!;
  assert.equal(plain.mic, false);
  assert.deepEqual(plain.micBusy, []);
  assert.equal(busySpans(Array.from({ length: 500 }, (_, i) => ({ fromMs: i, toMs: i + 1, reason: 'silenced' }))).length, 100);
});

await t('sizes: chunk, cap hours, hub hours', () => {
  assert.equal(Math.round(chunkBytes({ kbps: 32, chunkMin: 30 }) / 1e6 * 10) / 10, 7.3); // 30 min at 32 kbps ≈ 7.3 MB
  assert.ok(capHours({ kbps: 32, capMb: 200 }) > 14);
  assert.ok(hubHours(32) > 5 && hubHours(32) < 6);
});

await t('chunk ids and names', () => {
  assert.ok(isChunkId('20261030-101500-k3x9'));
  for (const bad of ['20261030-101500', '../20261030-101500-k3x9', '20261030-101500-K3X9', 20261030]) assert.ok(!isChunkId(bad));
  assert.equal(chunkName('20261030-101500-k3x9'), 'Phone audio 2026-10-30 10:15');
  assert.equal(idDate('20261030-101500-k3x9')?.getHours(), 10);
  assert.equal(idDate('nope'), null);
});

await t('hub paths', () => {
  assert.equal(partPath('20261030-101500-k3x9', 7), 'output-recorder/parts/20261030-101500-k3x9/0007.json');
  assert.equal(indexPath('20261030-101500-k3x9'), 'output-recorder/recordings/20261030-101500-k3x9.json');
  assert.equal(idOfIndex('output-recorder/recordings/20261030-101500-k3x9.json'), '20261030-101500-k3x9');
  assert.equal(idOfIndex('output-recorder/recordings/evil.json'), null);
  assert.equal(idOfIndex('amberx-notes/items/head.json'), null);
  assert.equal(dataUrl('https://axhub.amberxai.com', 'amberx-recordings', indexPath('20261030-101500-k3x9')), 'https://axhub.amberxai.com/data/amberx-recordings/output-recorder/recordings/20261030-101500-k3x9.json');
  assert.throws(() => dataUrl('https://h', 'amberx-recordings', 'a/../b.json'));
  assert.throws(() => dataUrl('https://h', '../x'));
  assert.equal(hubOf('http://evil.example'), 'https://axhub.amberxai.com');
  assert.equal(hubOf('https://user:pw@axhub.amberxai.com'), 'https://axhub.amberxai.com');
  assert.equal(hubOf('http://localhost:7000'), 'http://localhost:7000');
});

await t('base64 round trip (every tail length) and Node agreement', () => {
  for (const len of [0, 1, 2, 3, 4, 5, 255, 1000]) {
    const b = Uint8Array.from({ length: len }, (_, i) => (i * 37 + 11) & 255);
    const s = toBase64(b);
    assert.equal(s, Buffer.from(b).toString('base64'));
    assert.deepEqual(fromBase64(s), b);
  }
});

await t('parts: count, order, each under the data server’s 64 KB', () => {
  const bytes = Uint8Array.from({ length: PART_BYTES * 2 + 123 }, (_, i) => i & 255);
  const parts = splitParts('20261030-101500-k3x9', bytes);
  assert.equal(parts.length, 3);
  assert.equal(partCount(bytes.length), 3);
  assert.equal(partCount(PART_BYTES), 1);
  assert.equal(partCount(0), 0);
  for (const p of parts) assert.ok(Buffer.byteLength(p.body) < HUB_DOC_MAX, `${p.path} is ${Buffer.byteLength(p.body)} bytes`);
  // a full part is the worst case: it still fits with room to spare
  assert.ok(Buffer.byteLength(parts[0].body) < HUB_DOC_MAX - 4000);
  assert.equal(JSON.parse(parts[2].body).n, 2);
});

const idx = (id: string, bytes: Uint8Array, extra: Record<string, unknown> = {}) => ({
  $axf: 'audio-recording@1', id, name: chunkName(id), startedAt: '2026-10-30T10:15:00.000Z', endedAt: '2026-10-30T10:45:00.000Z', durationMs: 1_800_000,
  bytes: bytes.length, mime: 'audio/mp4', kbps: 32, channels: 1, device: 'samsung SM-S948', parts: partCount(bytes.length),
  sha256: createHash('sha256').update(bytes).digest('hex'), uploadedAt: '2026-10-30T10:46:00.000Z', deleted: false, ...extra,
});

await t('index check', () => {
  const b = new Uint8Array(100_000);
  const id = '20261030-101500-k3x9';
  const r = normalizeIndex(idx(id, b), id);
  assert.equal(r?.parts, 3);
  assert.equal(normalizeIndex(idx(id, b), '20261030-101500-zzzz'), null); // the id must be the file's
  assert.equal(normalizeIndex({ ...idx(id, b), parts: 9 }, id), null); // parts don't match bytes
  assert.equal(normalizeIndex({ ...idx(id, b), $axf: 'other@1' }, id), null);
  assert.equal(normalizeIndex(null, id), null);
  assert.equal(normalizeIndex({ ...idx(id, b), sha256: 'nothex' }, id)?.sha256, '');
});

await t('by day, newest first, deleted out', () => {
  const b = new Uint8Array(10);
  const list = ['20261030-101500-aaaa', '20261031-090000-bbbb', '20261030-120000-cccc', '20261029-080000-dddd']
    .map((id, i) => normalizeIndex(idx(id, b, { deleted: i === 3 }), id));
  const days = byDay(list);
  assert.deepEqual(days.map((d) => d.day), ['2026-10-31', '2026-10-30']);
  assert.deepEqual(days[1].items.map((r) => r.id), ['20261030-120000-cccc', '20261030-101500-aaaa']);
});

/* ---------------------------------------------------------------- recorder state machine */

await t('recorder states', () => {
  let s = recReduce(REC_IDLE, { type: 'start' });
  assert.equal(s.starting, true);
  s = recReduce(s, { type: 'native', e: { state: 'recording', startedAt: '2026-10-31T01:00:00.000Z' } });
  assert.deepEqual([s.running, s.starting, s.startedAt], [true, false, '2026-10-31T01:00:00.000Z']);
  s = recReduce(s, { type: 'native', e: { state: 'queue', upload: 'offline', waiting: 2, waitingBytes: 14e6, capBytes: 200 * 1024 * 1024, message: 'axHub can’t be reached', nextTryAt: 'x' } });
  assert.deepEqual([s.upload, s.waiting, s.running], ['offline', 2, true]);
  s = recReduce(s, { type: 'native', e: { state: 'queue', upload: 'bogus' } });
  assert.equal(s.upload, 'idle');
  s = recReduce(s, { type: 'native', e: { state: 'stopped', reason: 'Android ended the capture.' } });
  assert.deepEqual([s.running, s.startedAt, s.note], [false, null, 'Android ended the capture.']);
  s = recReduce(recReduce(s, { type: 'start' }), { type: 'native', e: { state: 'cancelled', message: 'Capture wasn’t allowed, so nothing is being recorded.' } });
  assert.deepEqual([s.running, s.starting], [false, false]);
  assert.match(s.note, /wasn’t allowed/);
  s = recReduce(s, { type: 'status', status: { running: true, startedAt: '2026-10-31T02:00:00.000Z', waiting: 1 } });
  assert.deepEqual([s.running, s.startedAt, s.waiting], [true, '2026-10-31T02:00:00.000Z', 1]);
  s = recReduce(s, { type: 'native', e: { state: 'chunk', id: 'x' } });
  assert.equal(s.running, true);
});

/* ---------------------------------------------------------------- a fake axHub data server */

function fakeHub(project = 'amberx-recordings') {
  const docs = new Map<string, string>();
  const calls: string[] = [];
  let signedOut = false;
  const fetchImpl = async (url: string, init: RequestInit = {}) => {
    const m = /^https:\/\/axhub\.amberxai\.com\/data\/([^/]+)(?:\/(.*))?$/.exec(url);
    assert.ok(m, `unexpected url ${url}`);
    assert.equal(init.credentials, 'include');
    const [, proj, path] = m;
    calls.push(`${init.method ?? 'GET'} ${proj}/${path ?? ''}`);
    if (signedOut) return new Response('{}', { status: 401 });
    if (proj !== project) return new Response('{}', { status: 404 });
    if (init.method === 'PUT') {
      const body = String(init.body);
      if (Buffer.byteLength(body) > HUB_DOC_MAX) return new Response('{"error":{"message":"too big"}}', { status: 413 });
      docs.set(path, body);
      return new Response('{"saved":{}}', { status: 200 });
    }
    if (!path) return new Response(JSON.stringify({ project, files: [...docs.keys()].map((p) => ({ path: p, size: docs.get(p).length })) }), { status: 200 });
    const d = docs.get(path);
    return d === undefined ? new Response('{}', { status: 404 }) : new Response(d, { status: 200 });
  };
  /** what the phone writes for one chunk (OutputRecordUploader's layout) */
  const upload = (id: string, bytes: Uint8Array, extra = {}) => {
    for (const p of splitParts(id, bytes)) docs.set(p.path, p.body);
    docs.set(indexPath(id), JSON.stringify(idx(id, bytes, extra)));
  };
  return { docs, calls, fetchImpl, upload, signOut: () => { signedOut = true; } };
}

const audio = (len: number, seed = 1) => Uint8Array.from({ length: len }, (_, i) => (i * seed + 7) & 255);

await t('hub: list, download with checksum, delete = stubs', async () => {
  const hub = fakeHub();
  const a = audio(PART_BYTES * 2 + 500, 3);
  hub.upload('20261030-101500-aaaa', a);
  hub.upload('20261030-110000-bbbb', audio(1000, 5));
  hub.docs.set('output-recorder/recordings/notes.json', '{}'); // not ours: ignored
  const c = new HubRecordings({ hub: 'https://axhub.amberxai.com', project: 'amberx-recordings', fetchImpl: hub.fetchImpl });
  const list = await c.list();
  assert.deepEqual(list.map((r) => r.id), ['20261030-110000-bbbb', '20261030-101500-aaaa']);
  const got = await c.download(list[1]);
  assert.deepEqual(got, a);
  // a damaged part is caught by the checksum
  const p1 = JSON.parse(hub.docs.get(partPath('20261030-101500-aaaa', 1)));
  const bad = fromBase64(p1.b64); bad[0] ^= 1;
  hub.docs.set(partPath('20261030-101500-aaaa', 1), JSON.stringify({ ...p1, b64: toBase64(bad) }));
  await assert.rejects(c.download(list[1]), /checksum/);
  // delete: index marked, every part stubbed (space back), gone from the list
  await c.remove(list[1]);
  assert.equal(JSON.parse(hub.docs.get(indexPath('20261030-101500-aaaa'))).deleted, true);
  for (let i = 0; i < 3; i++) assert.equal(JSON.parse(hub.docs.get(partPath('20261030-101500-aaaa', i))).gone, true);
  assert.deepEqual((await c.list()).map((r) => r.id), ['20261030-110000-bbbb']);
  await assert.rejects(c.download(list[1]), /deleted|damaged/);
});

await t('hub: no project yet = empty; signed out = a plain message', async () => {
  const hub = fakeHub('somewhere-else');
  const c = new HubRecordings({ hub: 'https://axhub.amberxai.com', project: 'amberx-recordings', fetchImpl: hub.fetchImpl });
  assert.deepEqual(await c.list(), []);
  hub.signOut();
  await assert.rejects(c.list(), /Sign in to axHub/);
});

/* ---------------------------------------------------------------- the controller with a fake native bridge */

function fakeBridge() {
  const calls: { m: string; o?: unknown }[] = [];
  const listeners = new Set<(e: unknown) => void>();
  let running = false;
  const queue = [{ id: '20261031-010000-qqqq', startedAt: 'x', durationMs: 1_800_000, bytes: 7e6, uploadedParts: 40, parts: 166 }];
  const b = {
    async status() { calls.push({ m: 'status' }); return { running, startedAt: running ? '2026-10-31T01:00:00.000Z' : null, upload: 'offline', message: 'axHub can’t be reached', waiting: 1, waitingBytes: 7e6, capBytes: 209715200, nextTryAt: '', lastUploadAt: '', settings: DEFAULTS }; },
    async start() { calls.push({ m: 'start' }); },
    micGrant: true,
    async micPermission() { calls.push({ m: 'micPermission' }); return { granted: b.micGrant }; },
    async stop() { calls.push({ m: 'stop' }); },
    async configure(o) { calls.push({ m: 'configure', o }); return { settings: o }; },
    async queue() { calls.push({ m: 'queue' }); return { chunks: queue }; },
    async retry() { calls.push({ m: 'retry' }); },
    async discard(o) { calls.push({ m: 'discard', o }); queue.splice(0, 1); },
    async fetch(o) { calls.push({ m: 'fetch', o }); return { uri: `content://media/external/audio/media/${o.id}` }; },
    async play(o) { calls.push({ m: 'play', o }); },
    async share(o) { calls.push({ m: 'share', o }); },
    async toExtract(o) { calls.push({ m: 'toExtract', o }); },
    async addListener(_ev, fn) { listeners.add(fn); return { remove: () => { listeners.delete(fn); } }; },
  };
  return { b, calls, emit: (e) => listeners.forEach((f) => f(e)), setRunning: (v) => { running = v; } };
}

await t('controller: attach, switch on → Android → recording → stopped, queue, retry, discard', async () => {
  const f = fakeBridge();
  const toasts: string[] = [];
  const hub = fakeHub();
  const c = createController(f.b, { settings: () => ({ ...DEFAULTS, kbps: 48 }), hub: () => 'https://axhub.amberxai.com', toast: (x) => toasts.push(x), fetchImpl: hub.fetchImpl });
  await c.attach();
  assert.equal(c.get().rec.upload, 'offline');
  assert.equal(c.get().queue.length, 1);
  assert.equal(f.calls.find((x) => x.m === 'configure').o.kbps, 48); // the phone gets the page's settings
  await c.toggle(true);
  assert.equal(c.get().rec.starting, true);
  assert.ok(f.calls.some((x) => x.m === 'start'));
  f.emit({ state: 'recording', startedAt: '2026-10-31T01:00:00.000Z' });
  assert.equal(c.get().rec.running, true);
  await c.toggle(true); // already on: nothing new
  assert.equal(f.calls.filter((x) => x.m === 'start').length, 1);
  await c.toggle(false);
  assert.ok(f.calls.some((x) => x.m === 'stop'));
  f.emit({ state: 'stopped', reason: 'Android ended the capture.' });
  assert.equal(c.get().rec.running, false);
  assert.deepEqual(toasts, ['Android ended the capture.']);
  await c.retry();
  assert.ok(f.calls.some((x) => x.m === 'retry'));
  await c.discard('20261031-010000-qqqq');
  assert.equal(c.get().queue.length, 0);
  f.emit({ state: 'error', message: 'Android’s audio permission is needed' });
  assert.match(toasts.at(-1), /permission/);
  await c.detach();
});

await t('controller: list from axHub, play, share, send to Audio Extract, delete', async () => {
  const f = fakeBridge();
  const hub = fakeHub();
  const a = audio(PART_BYTES + 10, 9);
  hub.upload('20261030-101500-aaaa', a);
  const urls: { bytes: Uint8Array; url: string }[] = [];
  const revoked: string[] = [];
  const c = createController(f.b, {
    settings: () => DEFAULTS, hub: () => 'https://axhub.amberxai.com', fetchImpl: hub.fetchImpl,
    objectUrl: (bytes) => { const url = `blob:${urls.length}`; urls.push({ bytes, url }); return url; }, revokeUrl: (u) => revoked.push(u),
  });
  await c.refreshHub();
  const [r] = c.get().hub.items;
  assert.equal(r.id, '20261030-101500-aaaa');
  await c.play(r);
  assert.deepEqual(urls[0].bytes, a);
  assert.deepEqual(c.get().playing, { id: r.id, url: 'blob:0' });
  await c.share(r);
  assert.deepEqual(f.calls.filter((x) => x.m === 'fetch' || x.m === 'share').map((x) => x.m), ['fetch', 'share']);
  await c.toExtract(r);
  assert.deepEqual(f.calls.at(-1), { m: 'toExtract', o: { uri: 'content://media/external/audio/media/20261030-101500-aaaa' } });
  await c.remove(r);
  assert.deepEqual(revoked, ['blob:0']); // the playing copy is let go first
  assert.equal(c.get().hub.items.length, 0);
  assert.deepEqual(c.get().busy, {});
});

await t('controller: mic permission asked only when the toggle is turned on; refused = stays off', async () => {
  const f = fakeBridge();
  const toasts: string[] = [];
  const c = createController(f.b, { settings: () => DEFAULTS, hub: () => 'https://axhub.amberxai.com', toast: (x) => toasts.push(x) });
  await c.attach();
  assert.ok(!f.calls.some((x) => x.m === 'micPermission')); // attaching never asks
  assert.equal(await c.micToggled(false), true);
  assert.ok(!f.calls.some((x) => x.m === 'micPermission')); // turning it off never asks
  assert.equal(await c.micToggled(true), true);
  assert.equal(f.calls.filter((x) => x.m === 'micPermission').length, 1);
  f.b.micGrant = false;
  assert.equal(await c.micToggled(true), false);
  assert.match(toasts.at(-1)!, /stays off/);
  assert.equal(await createController(null, { settings: () => DEFAULTS, hub: () => 'x' }).micToggled(true), true); // console: nothing to ask
});

await t('controller without the native side (the console): list only, start refuses politely', async () => {
  const hub = fakeHub();
  hub.upload('20261030-101500-aaaa', audio(10));
  const toasts: string[] = [];
  const c = createController(null, { settings: () => DEFAULTS, hub: () => 'https://axhub.amberxai.com', toast: (x) => toasts.push(x), fetchImpl: hub.fetchImpl });
  assert.equal(c.native(), false);
  await c.attach();
  await c.start();
  assert.match(toasts[0], /AmberX app on Android/);
  await c.refreshHub();
  assert.equal(c.get().hub.items.length, 1);
  await settle();
});

/* ---------------------------------------------------------------- the native side, statically */

const root = new URL('../../../../', import.meta.url);
const java = (f: string) => readFileSync(new URL(`apps/amberx-droid/android/app/src/main/java/ai/amberx/droid/${f}`, root), 'utf8');

const code = (f: string) => java(f).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ''); // code only, not the comments

await t('native: the mic only in the recorder service, only opt-in, VOICE_RECOGNITION (never a privacy-sensitive source)', () => {
  for (const f of ['OutputRecordStartActivity.java', 'OutputRecorderPlugin.java', 'OutputRecordUploader.java', 'OutputRecordQueue.java', 'OutputRecordTile.java', 'TwoTrack.java', 'RecorderControl.java']) {
    assert.ok(!/setAudioSource|AudioSource\.|MediaRecorder|SpeechRecognizer|new AudioRecord/.test(code(f)), `${f} must not open the microphone`);
  }
  const svc = code('OutputRecordService.java');
  assert.match(svc, /setAudioPlaybackCaptureConfig\(cfg\)/);
  assert.match(svc, /FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION/);
  assert.equal((svc.match(/setAudioSource\(/g) ?? []).length, 1, 'one mic AudioRecord');
  assert.match(svc, /setAudioSource\(android\.media\.MediaRecorder\.AudioSource\.VOICE_RECOGNITION\)/);
  assert.ok(!/VOICE_COMMUNICATION|CAMCORDER/.test(svc), 'never a privacy-sensitive source (it would take the mic from a call / the Claude app)');
  assert.ok(!/SpeechRecognizer/.test(svc), 'a plain capture: no recognizer');
  // opened only when the setting / the approved start asks for it
  // opt-in only, and never while AmberX's Mic off switch is on (MicGuard, Nov 1 2026)
  assert.match(svc, /boolean wantMic = OutputRecordQueue\.micWanted\(this\)( && MicGuard\.mayOpen\(this\))?;/);
  assert.match(svc, /if \(micOn\) \{\s*if \(!micAllowed\)[^\n]*\n\s*else openMic\(\);/);
  assert.match(code('OutputRecordQueue.java'), /boolean mic = false;/);
  assert.match(code('OutputRecordQueue.java'), /s\.mic = p\.getBoolean\("mic", false\);/);
  const mf = readFileSync(new URL('apps/amberx-droid/android/app/src/main/AndroidManifest.xml', root), 'utf8');
  assert.match(mf, /\.OutputRecordService"[\s\S]*?mediaProjection\|microphone/);
});

await t('native: two tracks (left = mic, right = playback), mic busy = playback only + marked, release on stop', () => {
  const svc = code('OutputRecordService.java');
  const tt = code('TwoTrack.java');
  assert.match(tt, /LEFT = "mic"/);
  assert.match(tt, /RIGHT = "playback"/);
  assert.match(svc, /channels = micOn \? 2 : s\.channels;/);
  assert.match(svc, /TwoTrack\.mixBlock\(micRing, playRing, micClock,/);
  assert.match(svc, /meta\.put\("tracks", TwoTrack\.tracks\(\)\)/);
  assert.match(svc, /meta\.put\("micBusy", spans\)/);
  assert.match(code('OutputRecordUploader.java'), /index\.put\("micBusy"/);
  // busy: refused, silenced (reported by Android), stopped delivering → marked + notification, never a failure
  assert.match(svc, /isClientSilenced\(\)/);
  assert.match(svc, /micBusy\(TwoTrack\.BUSY_UNAVAILABLE/);
  assert.match(svc, /micBusy\(TwoTrack\.BUSY_SILENCED/);
  assert.match(svc, /"Mic busy: recording playback only"/);
  assert.ok(!/fail\([^)]*mic/i.test(svc), 'a busy mic never fails the recording');
  // privacy: the notification says so, Stop mic is on it, the mic goes the moment the recording stops
  assert.match(svc, /"Recording: playback \+ mic"/);
  assert.match(svc, /"Stop mic", stopMic/);
  assert.match(svc, /ACTION_STOP_MIC\.equals\(a\)\) stopMic\(\)/);
  assert.match(svc, /private void release\(\) \{\s*micStop = true;\s*releaseMic\(\);/);
  assert.match(svc, /m\.release\(\)/);
});

await t('native: no second listener (one recorder event listener, set only by the plugin)', () => {
  for (const f of ['OutputRecordService.java', 'AxppLink.java', 'OutputRecordStartActivity.java', 'OutputRecordTile.java', 'OutputRecordUploader.java', 'TwoTrack.java']) {
    assert.ok(!/OutputRecordService\.listener\s*=|\blistener\s*=\s*[^=]/.test(code(f).replace(/static volatile Listener listener;/, '')), `${f} must not add a recorder listener`);
    assert.ok(!/notifyListeners|addListener|registerAudioRecordingCallback/.test(code(f)), `${f} must not subscribe to anything new`);
  }
  assert.equal((code('OutputRecorderPlugin.java').match(/OutputRecordService\.listener = e ->/g) ?? []).length, 1);
});

await t('native: one consent flow (switch and tile), manifest, part size twin', () => {
  assert.match(java('OutputRecorderPlugin.java'), /OutputRecordStartActivity\.intent/);
  assert.match(java('OutputRecordTile.java'), /OutputRecordStartActivity\.intent/);
  assert.match(java('OutputRecordStartActivity.java'), /createScreenCaptureIntent/);
  assert.match(java('OutputRecordUploader.java'), new RegExp(`PART_BYTES = ${PART_BYTES.toLocaleString('en').replace(/,/g, '_')};`));
  assert.match(java('OutputRecordUploader.java'), /output-recorder\/parts\//);
  assert.match(java('OutputRecordUploader.java'), /output-recorder\/recordings\//);
  assert.match(java('OutputRecordQueue.java'), /kbps = 32;[\s\S]*channels = 1;[\s\S]*chunkMin = 30;[\s\S]*capMb = 200;[\s\S]*"amberx-recordings"/);
  const mf = readFileSync(new URL('apps/amberx-droid/android/app/src/main/AndroidManifest.xml', root), 'utf8');
  assert.match(mf, /\.OutputRecordService"[\s\S]*?mediaProjection/);
  assert.match(mf, /\.OutputRecordTile"[\s\S]*?BIND_QUICK_SETTINGS_TILE[\s\S]*?QS_TILE/);
  assert.match(java('MainActivity.java'), /registerPlugin\(OutputRecorderPlugin\.class\)/);
  assert.match(java('AudioExtractPlugin.java'), /void offer\(List<Uri> uris\)/);
  assert.ok(existsSync(new URL('apps/console-web/plugins/output-recorder/README.md', root)));
});

await t('sessions from axHub: native side names parts, groups them, mic as asked, never auto-approved', () => {
  assert.match(java('OutputRecordService.java'), /RecorderControl\.partName\(/);
  assert.match(java('OutputRecordUploader.java'), /"group", "session", "note"/);
  assert.match(java('RecorderControl.java'), /" - part" \+/);
  assert.match(java('AxppLink.java'), /\.put\("mic", OutputRecordService\.running && OutputRecordService\.micOn\)/);
  assert.match(java('AxppLink.java'), /\.put\("micDefault", OutputRecordQueue\.settings\(c\)\.mic\)/);
  assert.match(java('RecorderControl.java'), /static boolean micFor\(Boolean sessionMic, boolean setting\)/);
  assert.match(java('HubRules.java'), /NEVER_AUTO = Set\.of\("amberx\.recorder_start"\)/);
});

console.log(`output-recorder: ${n} tests passed`);
