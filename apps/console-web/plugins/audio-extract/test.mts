// @ts-nocheck: a Node test, not part of the console's build
/**
 * Audio Extract self-test: the pure rules (names, trim, formats, screen-recording folders, settings), the batch queue
 * and the recorder state machine, run against a fake native bridge.
 *   node --experimental-strip-types apps/console-web/plugins/audio-extract/test.mts   (or npx -y tsx …)
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import {
  DEFAULTS, K, REC_IDLE, batchProgress, checkTrim, cleanFolder, createController, formatProblem, formatTime, isScreenRecording,
  jobReduce, newJob, nextJob, outputName, parseTime, readSettings, recActive, recReduce, renameTo, trackLabel,
} from './web/core.ts';
import { AAC, OPUS, fakeBridge, video } from './web/fake.ts';

let n = 0;
const t = async (name: string, f: () => void | Promise<void>) => {
  try { await f(); n++; } catch (e) { console.error(`✗ ${name}`); throw e; }
};
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 20; i++) await tick(); };

/* ---------------------------------------------------------------- pure rules */

await t('names', () => {
  assert.equal(outputName('Screen_Recording_20261030_101500_YouTube.mp4', 'm4a'), 'Screen_Recording_20261030_101500_YouTube.m4a');
  assert.equal(outputName('clip.mp4', 'wav', true), 'clip_trim.wav');
  assert.ok(!outputName('../../etc:pass?.mp4', 'm4a').includes('/'));
  assert.equal(outputName('.mp4', 'm4a'), 'Audio.m4a');
  assert.equal(renameTo('a.m4a', 'Song'), 'Song.m4a');
  assert.equal(renameTo('a.m4a', 'Song.m4a'), 'Song.m4a');
  assert.equal(renameTo('a.m4a', 'x/y'), 'x y.m4a');
  assert.equal(renameTo('a.m4a', '  '), null);
});

await t('time + trim', () => {
  assert.equal(parseTime('83'), 83000);
  assert.equal(parseTime('1:23'), 83000);
  assert.equal(parseTime('1:02:03.5'), 3723500);
  assert.equal(parseTime('1:75'), null);
  assert.equal(parseTime('abc'), null);
  assert.equal(formatTime(83000), '1:23');
  assert.equal(formatTime(3723500), '1:02:03');
  assert.deepEqual(checkTrim('', '', 60000), { ok: true, trim: { startMs: 0, endMs: null } });
  assert.deepEqual(checkTrim('0:10', '0:20', 60000), { ok: true, trim: { startMs: 10000, endMs: 20000 } });
  assert.deepEqual(checkTrim('0:10', '5:00', 60000), { ok: true, trim: { startMs: 10000, endMs: null } }, 'end past the video = to the end');
  assert.equal(checkTrim('0:20', '0:10', 60000).ok, false);
  assert.equal(checkTrim('2:00', '', 60000).ok, false);
  assert.equal(checkTrim('x', '', 60000).ok, false);
});

await t('formats: m4a only copies AAC, no fallback', () => {
  assert.equal(formatProblem(AAC, 'm4a'), null);
  assert.equal(formatProblem(AAC, 'wav'), null);
  assert.match(formatProblem(OPUS, 'm4a')!, /Pick WAV/);
  assert.equal(formatProblem(OPUS, 'wav'), null);
  assert.match(formatProblem(undefined, 'm4a')!, /no audio track/);
  assert.match(trackLabel(AAC), /Track 2: AAC, stereo, 48 kHz · 192 kbps/);
});

await t('screen recordings', () => {
  assert.ok(isScreenRecording({ name: 'x.mp4', relativePath: 'DCIM/Screen recordings/' }));
  assert.ok(isScreenRecording({ name: 'x.mp4', relativePath: 'Movies/Screen recordings' }));
  assert.ok(isScreenRecording({ name: 'Screen_Recording_20261030.mp4', relativePath: 'Download/' }));
  assert.ok(!isScreenRecording({ name: 'holiday.mp4', relativePath: 'DCIM/Camera/' }));
});

await t('settings', () => {
  assert.deepEqual(readSettings(() => undefined), DEFAULTS);
  const s = readSettings((k) => ({ [K.format]: 'wav', [K.folder]: '../Mine//Sub/Deeper', [K.fps]: '60', [K.countdown]: 99, [K.keep]: 'audio', [K.audioKbps]: 999, [K.chip]: false } as Record<string, unknown>)[k]);
  assert.equal(s.format, 'wav');
  assert.equal(s.folder, 'Mine/Sub');
  assert.equal(s.rec.fps, 60);
  assert.equal(s.rec.countdown, 10);
  assert.equal(s.rec.keep, 'audio');
  assert.equal(s.rec.audioKbps, 192);
  assert.equal(s.rec.chip, false);
  assert.equal(cleanFolder(''), 'AmberX Audio');
  assert.equal(readSettings((k) => (k === K.format ? 'mp3' : undefined)).format, 'm4a', 'no mp3');
});

await t('job reducer', () => {
  const a = newJob(video('u1', 'a.mp4'), { format: 'm4a', id: 'a' });
  const b = newJob(video('u2', 'b.mp4'), { format: 'm4a', id: 'b' });
  let js = [a, b];
  assert.equal(nextJob(js)?.id, 'a');
  js = jobReduce(js, { type: 'start', id: 'a' });
  assert.equal(nextJob(js), null, 'one at a time');
  js = jobReduce(js, { type: 'progress', id: 'a', progress: 0.4 });
  js = jobReduce(js, { type: 'progress', id: 'a', progress: 0.2 });
  assert.equal(js[0]!.progress, 0.4, 'progress never goes back');
  js = jobReduce(js, { type: 'done', id: 'a', result: { uri: 'r', name: 'a.m4a', size: 1 } });
  js = jobReduce(js, { type: 'cancel', id: 'a' });
  assert.equal(js[0]!.state, 'done', 'done stays done');
  js = jobReduce(js, { type: 'cancel', id: 'b' });
  assert.deepEqual(batchProgress(js), { total: 1, done: 1, failed: 0, left: 0, progress: 1 });
});

await t('recorder state machine', () => {
  let s = REC_IDLE;
  s = recReduce(s, { type: 'pause' }); assert.equal(s.phase, 'idle');
  s = recReduce(s, { type: 'start' }); assert.equal(s.phase, 'starting');
  assert.equal(recReduce(s, { type: 'refused' }).phase, 'idle');
  assert.equal(recReduce(s, { type: 'refused', error: 'boom' }).phase, 'error');
  s = recReduce(s, { type: 'native', e: { state: 'countdown', remaining: 3 } }); assert.equal(s.phase, 'countdown'); assert.equal(s.remaining, 3);
  assert.equal(recReduce(s, { type: 'stop' }).phase, 'idle', 'stop during countdown = cancel');
  s = recReduce(s, { type: 'native', e: { state: 'recording', elapsedMs: 0, playbackAudio: true } }); assert.equal(s.phase, 'recording');
  s = recReduce(s, { type: 'pause' }); assert.equal(s.phase, 'paused');
  s = recReduce(s, { type: 'native', e: { state: 'paused', elapsedMs: 5000 } }); assert.equal(s.elapsedMs, 5000);
  s = recReduce(s, { type: 'resume' }); assert.equal(s.phase, 'recording');
  s = recReduce(s, { type: 'stop' }); assert.equal(s.phase, 'recording', 'waits for the native stopped');
  s = recReduce(s, { type: 'native', e: { state: 'stopped', video: { uri: 'v', name: 'v.mp4' }, elapsedMs: 9000 } });
  assert.equal(s.phase, 'extracting'); assert.equal(s.video?.uri, 'v');
  assert.equal(recReduce(s, { type: 'start' }).phase, 'extracting', 'no new recording while extracting');
  assert.equal(recReduce(s, { type: 'reset' }).phase, 'extracting');
  s = recReduce(s, { type: 'extracted', audio: { uri: 'a', name: 'v.m4a', size: 1 } }); assert.equal(s.phase, 'done');
  s = recReduce(s, { type: 'start' }); assert.equal(s.phase, 'starting', 'again from done');
  s = recReduce(s, { type: 'native', e: { state: 'error', error: 'gone' } }); assert.equal(s.phase, 'error'); assert.equal(s.error, 'gone');
  assert.equal(recReduce(s, { type: 'reset' }).phase, 'idle');
  for (const p of ['starting', 'countdown', 'recording', 'paused']) assert.ok(recActive(p));
  for (const p of ['idle', 'extracting', 'done', 'error']) assert.ok(!recActive(p));
});

/* ---------------------------------------------------------------- controller + fake bridge */

const settingsOf = (over: Record<string, unknown> = {}) => () => readSettings((k) => over[k]);

await t('no native side: nothing runs', async () => {
  const said: string[] = [];
  const c = createController(null, { settings: settingsOf(), say: (x) => said.push(x) });
  assert.equal(c.available(), false);
  assert.deepEqual(c.enqueue([video('u', 'a.mp4')]), []);
  await c.extractLatest(); await c.recStart();
  assert.equal(said.length, 2);
  assert.equal(c.get().rec.phase, 'idle');
});

await t('batch: picked videos run one after another, lossless m4a', async () => {
  const f = fakeBridge({ videos: [video('u1', 'one.mp4'), video('u2', 'two.mp4')], picks: [[video('u1', 'one.mp4'), video('u2', 'two.mp4')]] });
  const c = createController(f.bridge, { settings: settingsOf() });
  await c.attach();
  const jobs = await c.pick(true);
  assert.equal(jobs.length, 2);
  await c.pump(); await settle();
  const s = c.get();
  assert.deepEqual(s.jobs.map((j) => j.state), ['done', 'done']);
  assert.deepEqual(f.calls.filter((x) => x.m === 'extract').map((x) => (x.o as { name: string; format: string; track: number; endMs: number }).name), ['one.m4a', 'two.m4a']);
  const ex = f.calls.find((x) => x.m === 'extract')!.o as { format: string; track: number; endMs: number; folder: string };
  assert.equal(ex.format, 'm4a'); assert.equal(ex.track, 1); assert.equal(ex.endMs, -1); assert.equal(ex.folder, 'AmberX Audio');
  assert.equal(s.files.length, 2);
  assert.equal(batchProgress(s.jobs).progress, 1);
});

await t('m4a from a non-AAC track fails plainly (no silent re-encode)', async () => {
  const f = fakeBridge({ videos: [video('u', 'opus.webm', [OPUS])] });
  const toasts: string[] = [];
  const c = createController(f.bridge, { settings: settingsOf(), toast: (x) => toasts.push(x) });
  c.enqueue([video('u', 'opus.webm', [OPUS])]);
  await c.pump();
  assert.equal(c.get().jobs[0]!.state, 'failed');
  assert.match(c.get().jobs[0]!.error!, /Pick WAV/);
  assert.equal(f.calls.filter((x) => x.m === 'extract').length, 0);
  // WAV works
  c.enqueue([video('u', 'opus.webm', [OPUS])], { format: 'wav' });
  await c.pump();
  assert.equal(c.get().jobs[1]!.state, 'done');
  assert.equal(c.get().jobs[1]!.name, 'opus.wav');
});

await t('trim + track pick reach the native call', async () => {
  const two = [AAC, { ...AAC, index: 2, language: 'eng' }];
  const f = fakeBridge({ videos: [video('u', 'multi.mp4', two)] });
  const c = createController(f.bridge, { settings: settingsOf() });
  c.enqueue([video('u', 'multi.mp4', two)], { track: 2, trim: { startMs: 5000, endMs: 15000 } });
  await c.pump();
  const ex = f.calls.find((x) => x.m === 'extract')!.o as { track: number; startMs: number; endMs: number; name: string };
  assert.deepEqual([ex.track, ex.startMs, ex.endMs, ex.name], [2, 5000, 15000, 'multi_trim.m4a']);
});

await t('cancel: a queued job never runs, a running one is stopped natively', async () => {
  const f = fakeBridge({ videos: [video('u1', 'a.mp4'), video('u2', 'b.mp4')] });
  f.holdExtracts(true);
  const c = createController(f.bridge, { settings: settingsOf() });
  const [a, b] = c.enqueue([video('u1', 'a.mp4'), video('u2', 'b.mp4')]);
  await settle();
  assert.equal(c.get().jobs[0]!.state, 'running');
  await c.cancel(b!.id);
  await c.cancel(a!.id);
  await c.pump(); await settle();
  assert.deepEqual(c.get().jobs.map((j) => j.state), ['cancelled', 'cancelled']);
  assert.deepEqual(f.calls.filter((x) => x.m === 'cancel').map((x) => (x.o as { jobId: string }).jobId), [a!.id]);
  assert.equal(f.calls.filter((x) => x.m === 'extract').length, 1);
  c.retry(b!.id); f.holdExtracts(false); await c.pump(); await settle();
  assert.equal(c.get().jobs[1]!.state, 'done');
});

await t('progress events land on the job', async () => {
  const f = fakeBridge({ videos: [video('u', 'a.mp4')] });
  f.holdExtracts(true);
  const c = createController(f.bridge, { settings: settingsOf() });
  await c.attach();
  const [j] = c.enqueue([video('u', 'a.mp4')]);
  await settle();
  assert.equal(c.get().jobs[0]!.progress, 0.5);
  f.finish(j!.id); await c.pump(); await settle();
  assert.equal(c.get().jobs[0]!.progress, 1);
});

await t('delete the video after: only when set, only after success', async () => {
  const f = fakeBridge({ videos: [video('u', 'a.mp4'), video('bad', 'b.mp4', [])] });
  const c = createController(f.bridge, { settings: settingsOf({ [K.deleteVideo]: true }) });
  c.enqueue([video('u', 'a.mp4'), video('bad', 'b.mp4', [])]);
  await c.pump(); await settle();
  assert.deepEqual(f.calls.filter((x) => x.m === 'deleteVideo').map((x) => (x.o as { uri: string }).uri), ['u']);
  const f2 = fakeBridge({ videos: [video('u', 'a.mp4')] });
  const c2 = createController(f2.bridge, { settings: settingsOf() });
  c2.enqueue([video('u', 'a.mp4')]); await c2.pump();
  assert.equal(f2.calls.filter((x) => x.m === 'deleteVideo').length, 0);
});

await t('share to AmberX: waiting videos are taken on attach, later ones by event', async () => {
  const f = fakeBridge({ videos: [video('s1', 'shared.mp4'), video('s2', 'later.mp4')], shared: [video('s1', 'shared.mp4')] });
  const c = createController(f.bridge, { settings: settingsOf() });
  await c.attach(); await c.pump();
  f.emit('shared', { videos: [video('s2', 'later.mp4')] });
  await settle(); await c.pump();
  assert.deepEqual(c.get().jobs.map((j) => [j.video.name, j.state]), [['shared.mp4', 'done'], ['later.mp4', 'done']]);
});

await t('extract my last screen recording', async () => {
  const said: string[] = [];
  const f = fakeBridge({ videos: [video('l', 'Screen_Recording_1.mp4')], latest: video('l', 'Screen_Recording_1.mp4') });
  const c = createController(f.bridge, { settings: settingsOf(), say: (x) => said.push(x) });
  const j = await c.extractLatest(); await c.pump();
  assert.equal(j?.video.uri, 'l');
  assert.equal(c.get().jobs[0]!.state, 'done');
  assert.match(said[0]!, /Screen_Recording_1/);
  const none = createController(fakeBridge().bridge, { settings: settingsOf(), say: (x) => said.push(x) });
  assert.equal(await none.extractLatest(), null);
  assert.match(none.get().note, /No screen recordings/);
});

await t('screen-recording folders: granted through the picker, no permission; none = ask', async () => {
  const f = fakeBridge({ folders: [], latest: video('l', 'Screen_Recording_1.mp4'), videos: [video('l', 'Screen_Recording_1.mp4')] });
  const c = createController(f.bridge, { settings: settingsOf() });
  await c.attach();
  assert.deepEqual(c.get().folders, []);
  assert.equal(await c.extractLatest(), null);
  assert.match(c.get().note, /Choose your Screen recordings folder/);
  assert.equal(await c.addFolder(), true);
  assert.equal(c.get().folders!.length, 1);
  const j = await c.extractLatest(); await c.pump();
  assert.equal(j?.video.uri, 'l');
  await c.removeFolder(c.get().folders![0]!.uri);
  assert.deepEqual(c.get().folders, []);
  f.failNext('addFolder', 'cancelled');
  assert.equal(await c.addFolder(), false);
});

await t('new screen recordings: watch is opt-in; offer, or extract at once', async () => {
  const f = fakeBridge({ videos: [video('n1', 'Screen_Recording_2.mp4')] });
  const c = createController(f.bridge, { settings: settingsOf() });
  await c.attach();
  assert.equal(f.calls.filter((x) => x.m === 'watch').length, 0, 'off by default');
  f.emit('newRecording', { video: video('n1', 'Screen_Recording_2.mp4') });
  f.emit('newRecording', { video: video('n1', 'Screen_Recording_2.mp4') });
  assert.equal(c.get().offers.length, 1, 'offered once');
  c.dismissOffer('n1');
  assert.equal(c.get().offers.length, 0);
  f.emit('newRecording', { video: video('n1', 'Screen_Recording_2.mp4') });
  c.acceptOffer('n1'); await c.pump();
  assert.equal(c.get().jobs[0]!.state, 'done'); assert.equal(c.get().offers.length, 0);

  let over: Record<string, unknown> = { [K.watch]: true, [K.autoExtract]: true };
  const f2 = fakeBridge({ videos: [video('n2', 'x.mp4')] });
  const c2 = createController(f2.bridge, { settings: () => readSettings((k) => over[k]) });
  await c2.attach();
  assert.deepEqual(f2.calls.filter((x) => x.m === 'watch').map((x) => x.o), [{ on: true }]);
  f2.emit('newRecording', { video: video('n2', 'x.mp4') }); await c2.pump();
  assert.equal(c2.get().jobs[0]!.state, 'done'); assert.equal(c2.get().offers.length, 0);
  over = {}; await c2.syncWatch();
  assert.deepEqual(f2.calls.filter((x) => x.m === 'watch').map((x) => x.o), [{ on: true }, { on: false }]);
  await c2.detach();
  assert.equal(f2.listenerCount('recorder'), 0);
});

await t('results list: refresh, rename keeps the extension, delete', async () => {
  const f = fakeBridge({ videos: [video('u', 'a.mp4')] });
  const c = createController(f.bridge, { settings: settingsOf() });
  c.enqueue([video('u', 'a.mp4')]); await c.pump();
  await c.refreshFiles();
  const file = c.get().files[0]!;
  assert.equal(await c.rename(file, 'My song'), true);
  assert.equal(c.get().files[0]!.name, 'My song.m4a');
  assert.equal(await c.rename(c.get().files[0]!, ''), false);
  c.play(c.get().files[0]!); c.share(c.get().files[0]!);
  assert.ok(f.calls.some((x) => x.m === 'play') && f.calls.some((x) => x.m === 'share'));
  assert.equal(await c.remove(c.get().files[0]!), true);
  assert.equal(c.get().files.length, 0);
});

await t('recorder: consent refused → idle, nothing recorded', async () => {
  const f = fakeBridge();
  f.failNext('recordStart', 'User cancelled screen capture');
  const c = createController(f.bridge, { settings: settingsOf() });
  await c.recStart();
  assert.equal(c.get().rec.phase, 'idle');
  assert.match(c.get().note, /wasn’t allowed/);
});

await t('recorder: countdown → recording ⇄ paused → stop → extract (keep both)', async () => {
  const f = fakeBridge();
  const c = createController(f.bridge, { settings: settingsOf({ [K.countdown]: 5, [K.resolution]: '720', [K.fps]: 60 }) });
  await c.attach();
  await c.recStart();
  const start = f.calls.find((x) => x.m === 'recordStart')!.o as Record<string, unknown>;
  assert.deepEqual([start.countdown, start.resolution, start.fps, start.folder, 'mic' in start], [5, '720', 60, 'AmberX Audio', false]);
  assert.ok(f.calls.some((x) => x.m === 'notifications'));
  assert.equal(c.get().rec.phase, 'starting');
  f.recorder({ state: 'countdown', remaining: 5 }); assert.equal(c.get().rec.phase, 'countdown');
  f.recorder({ state: 'recording', elapsedMs: 0, playbackAudio: true }); assert.equal(c.get().rec.phase, 'recording');
  await c.recPause(); assert.equal(c.get().rec.phase, 'paused'); assert.ok(f.calls.some((x) => x.m === 'recordPause'));
  await c.recResume(); assert.equal(c.get().rec.phase, 'recording');
  await c.recStop(); assert.ok(f.calls.some((x) => x.m === 'recordStop'));
  const vid = video('rec1', 'AmberX_Screen_20261030.mp4', [AAC], 9000, 'Movies/AmberX Recordings/');
  f.addVideo(vid);
  f.recorder({ state: 'stopped', video: vid, elapsedMs: 9000, playbackAudio: true });
  assert.equal(c.get().rec.phase, 'extracting');
  await c.pump(); await settle();
  assert.equal(c.get().rec.phase, 'done');
  assert.equal(c.get().rec.audio?.name, 'AmberX_Screen_20261030.m4a');
  assert.equal(f.calls.filter((x) => x.m === 'deleteVideo').length, 0, 'keep both');
  // the recorder's own video turning up in the watch isn't offered twice
  c.offer(vid); assert.equal(c.get().offers.length, 0);
});

await t('recorder: audio only deletes the video after a good extract; a silent video keeps it', async () => {
  const f = fakeBridge();
  const c = createController(f.bridge, { settings: settingsOf({ [K.keep]: 'audio' }) });
  await c.attach();
  await c.recStart();
  f.recorder({ state: 'recording', elapsedMs: 0 });
  const vid = video('rec2', 'AmberX_Screen_2.mp4');
  f.addVideo(vid);
  f.recorder({ state: 'stopped', video: vid, elapsedMs: 3000 });
  await c.pump(); await settle();
  assert.equal(c.get().rec.phase, 'done');
  assert.deepEqual(f.calls.filter((x) => x.m === 'deleteVideo').map((x) => (x.o as { uri: string }).uri), ['rec2']);

  c.recReset(); await c.recStart();
  f.recorder({ state: 'recording', elapsedMs: 0, playbackAudio: false });
  assert.equal(c.get().rec.playbackAudio, false);
  const silent = video('rec3', 'AmberX_Screen_3.mp4', []);
  f.addVideo(silent);
  f.recorder({ state: 'stopped', video: silent, elapsedMs: 3000, playbackAudio: false });
  await c.pump(); await settle();
  assert.equal(c.get().rec.phase, 'error');
  assert.match(c.get().rec.error!, /video is saved/);
  assert.equal(f.calls.filter((x) => x.m === 'deleteVideo').length, 1, 'the silent video is kept');
});

await t('recorder: stop during the countdown cancels', async () => {
  const f = fakeBridge();
  const c = createController(f.bridge, { settings: settingsOf() });
  await c.attach(); await c.recStart();
  f.recorder({ state: 'countdown', remaining: 2 });
  await c.recStop();
  assert.equal(c.get().rec.phase, 'idle');
  f.recorder({ state: 'cancelled' });
  assert.equal(c.get().rec.phase, 'idle');
  assert.equal(c.get().jobs.length, 0);
});


/* ---------------------------------------------------------------- the native half in AmberX (source checks; CI compiles it) */

await t('native: AudioExtract plugin, extractor, recorder, manifest', () => {
  const at = (p: string) => new URL(`../../../amberx-droid/${p}`, import.meta.url);
  const dir = 'android/app/src/main/java/ai/amberx/droid/';
  for (const f of ['AudioExtractPlugin.java', 'AudioExtractor.java', 'ScreenRecordService.java']) assert.ok(existsSync(at(dir + f)), f);
  const java = (f: string) => readFileSync(at(dir + f), 'utf8');
  const plug = java('AudioExtractPlugin.java'), ext = java('AudioExtractor.java'), rec = java('ScreenRecordService.java');
  const mf = readFileSync(at('android/app/src/main/AndroidManifest.xml'), 'utf8');
  assert.ok(java('MainActivity.java').includes('registerPlugin(AudioExtractPlugin.class)'), 'registered');
  assert.match(plug, /@CapacitorPlugin\(\s*name = "AudioExtract"/);
  // every bridge.ts method has its Java twin
  const methods = [...readFileSync(new URL('./web/bridge.ts', import.meta.url), 'utf8').matchAll(/^  ([a-zA-Z]+)\(o?[:)]/gm)].map((m) => m[1]).filter((m) => m !== 'addListener');
  assert.ok(methods.length >= 20, `bridge methods: ${methods.join(', ')}`);
  for (const m of methods) assert.match(plug, new RegExp(`@PluginMethod\\s+public void ${m}\\(PluginCall call\\)`), `AudioExtract.${m}`);
  assert.ok(/copyAac[\s\S]{0,2500}writeSampleData/.test(ext) && !/copyAac[\s\S]{0,2500}createDecoder/.test(ext), 'm4a = sample copy, no decode');
  assert.ok(ext.includes('createDecoderByType') && ext.includes("'R', 'I', 'F', 'F'"), 'wav = MediaCodec decode + RIFF header');
  assert.ok(!/AudioSource\.|VOICE_COMMUNICATION|CAMCORDER/.test(rec + plug + ext), 'no microphone source anywhere');
  assert.ok(rec.includes('setAudioPlaybackCaptureConfig(') && rec.includes('USAGE_MEDIA'), 'app sound through playback capture only');
  assert.ok(rec.includes('FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION') && rec.indexOf('registerCallback(') < rec.indexOf('createVirtualDisplay('), 'mediaProjection service, callback before the display');
  assert.ok(rec.includes('PARAMETER_KEY_SUSPEND') && /ACTION_PAUSE[\s\S]*ACTION_RESUME[\s\S]*ACTION_STOP/.test(rec), 'pause / resume / stop');
  assert.ok(plug.includes('createScreenCaptureIntent()'), 'consent every time');
  assert.ok(!/READ_MEDIA_VIDEO|READ_EXTERNAL_STORAGE|MANAGE_EXTERNAL_STORAGE/.test(plug + mf), 'no storage permission');
  assert.match(mf, /android:name="\.ScreenRecordService"[\s\S]{0,120}foregroundServiceType="mediaProjection"/);
  assert.ok(mf.includes('FOREGROUND_SERVICE_MEDIA_PROJECTION'));
  assert.ok(/SEND_MULTIPLE[\s\S]{0,200}video\/\*/.test(mf) && /action\.SEND"[\s\S]{0,200}video\/\*/.test(mf), 'Share → AmberX for videos');
});

console.log(`audio-extract: ${n} checks passed`);
