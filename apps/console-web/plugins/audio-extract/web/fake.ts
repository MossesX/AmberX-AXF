/**
 * A fake of the native bridge for tests (test.mts): videos, tracks and the recorder live in memory; every call is
 * recorded in `calls`. `emit` plays a native event; `failNext` makes the next call of a method throw.
 */
import type { AudioExtractBridge, ExtractOptions, Handle } from './bridge';
import type { AudioFile, AudioTrack, NativeRec, Video } from './core';

type Fn = (e: never) => void;

export interface FakeVideo extends Video { tracks: AudioTrack[]; durationMs: number }

export function fakeBridge(init: { videos?: FakeVideo[]; picks?: Video[][]; latest?: Video | null; shared?: Video[]; ownedVideos?: string[]; folders?: { uri: string; name: string }[] } = {}) {
  const listeners = new Map<string, Set<Fn>>();
  const videos = new Map((init.videos ?? []).map((v) => [v.uri, v]));
  const files: AudioFile[] = [];
  const folders = [...(init.folders ?? [{ uri: 'content://tree/dcim', name: 'Screen recordings' }])];
  const picks = [...(init.picks ?? [])];
  let shared = [...(init.shared ?? [])];
  const calls: { m: string; o?: unknown }[] = [];
  const fails = new Map<string, string>();
  const cancelled = new Set<string>();
  /** extracts waiting for `finish(jobId)` (hold = true) */
  const held = new Map<string, () => void>();
  let hold = false;
  let n = 0;
  const call = (m: string, o?: unknown) => {
    calls.push({ m, o });
    const f = fails.get(m);
    if (f !== undefined) { fails.delete(m); throw new Error(f); }
  };
  const emit = (event: string, e: unknown) => listeners.get(event)?.forEach((fn) => (fn as (x: unknown) => void)(e));

  const b: AudioExtractBridge = {
    async pickVideos(o) { call('pickVideos', o); return { videos: picks.shift() ?? [] }; },
    async probe(o) {
      call('probe', o);
      const v = videos.get(o.uri);
      if (!v) throw new Error('Can’t open that video.');
      return { durationMs: v.durationMs, tracks: v.tracks };
    },
    async extract(o: ExtractOptions) {
      call('extract', o);
      emit('progress', { jobId: o.jobId, progress: 0.5 });
      if (hold) await new Promise<void>((r) => held.set(o.jobId, r));
      if (cancelled.has(o.jobId)) throw new Error('Cancelled');
      emit('progress', { jobId: o.jobId, progress: 1 });
      const f: AudioFile = { uri: `content://media/audio/${++n}`, name: o.name, size: 1000 * n, mime: o.format === 'wav' ? 'audio/wav' : 'audio/mp4' };
      files.unshift(f);
      return f;
    },
    async cancel(o) { call('cancel', o); cancelled.add(o.jobId); held.get(o.jobId)?.(); },
    async folders() { call('folders'); return { folders: [...folders] }; },
    async addFolder() { call('addFolder'); const f = { uri: `content://tree/${folders.length + 1}`, name: 'Screen recordings' }; folders.push(f); return { folder: f }; },
    async removeFolder(o) { call('removeFolder', o); const i = folders.findIndex((f) => f.uri === o.uri); if (i >= 0) folders.splice(i, 1); },
    async latestRecording() {
      call('latestRecording');
      if (!folders.length) throw Object.assign(new Error('Choose your Screen recordings folder first.'), { code: 'no-folder' });
      return { video: init.latest ?? null };
    },
    async watch(o) { call('watch', o); },
    async takeShared() { call('takeShared'); const v = shared; shared = []; return { videos: v }; },
    async list(o) { call('list', o); return { files: [...files] }; },
    async rename(o) { call('rename', o); const f = files.find((x) => x.uri === o.uri); if (!f) throw new Error('gone'); f.name = o.name; return { name: o.name }; },
    async remove(o) { call('remove', o); const i = files.findIndex((x) => x.uri === o.uri); if (i >= 0) files.splice(i, 1); },
    async deleteVideo(o) { call('deleteVideo', o); const ok = (init.ownedVideos ?? []).includes(o.uri) || videos.has(o.uri); videos.delete(o.uri); return { deleted: ok }; },
    async play(o) { call('play', o); },
    async share(o) { call('share', o); },
    async recordStart(o) { call('recordStart', o); },
    async recordPause() { call('recordPause'); },
    async recordResume() { call('recordResume'); },
    async recordStop() { call('recordStop'); },
    async notifications() { call('notifications'); return { granted: true }; },
    async overlay() { call('overlay'); return { allowed: true }; },
    async addListener(event: string, fn: Fn): Promise<Handle> {
      let set = listeners.get(event);
      if (!set) { set = new Set(); listeners.set(event, set); }
      set.add(fn);
      return { remove: () => { set!.delete(fn); } };
    },
  } as AudioExtractBridge;

  return {
    bridge: b, calls, files, videos,
    emit: (event: 'progress' | 'newRecording' | 'shared' | 'recorder', e: unknown) => emit(event, e),
    recorder: (e: NativeRec) => emit('recorder', e),
    failNext: (m: string, error: string) => fails.set(m, error),
    holdExtracts: (on: boolean) => { hold = on; },
    finish: (jobId: string) => { held.get(jobId)?.(); held.delete(jobId); },
    addVideo: (v: FakeVideo) => videos.set(v.uri, v),
    listenerCount: (event: string) => listeners.get(event)?.size ?? 0,
  };
}

export const AAC: AudioTrack = { index: 1, mime: 'audio/mp4a-latm', channels: 2, sampleRate: 48000, bitrate: 192000 };
export const OPUS: AudioTrack = { index: 1, mime: 'audio/opus', channels: 2, sampleRate: 48000 };
export const video = (uri: string, name: string, tracks: AudioTrack[] = [AAC], durationMs = 60_000, relativePath = 'DCIM/Screen recordings/'): FakeVideo =>
  ({ uri, name, tracks, durationMs, relativePath, size: 5_000_000 });
