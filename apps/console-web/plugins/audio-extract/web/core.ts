/**
 * Audio Extract core: pure rules, no React, no bridge. The page, the controller and test.mts all use these.
 *
 *  - formats: `m4a` = the video's AAC track copied as is (no re-encode, lossless, fast); `wav` = decoded to 16-bit PCM
 *    through MediaCodec, only when picked. No MP3: Android ships no MP3 encoder, so it would need a bundled encoder.
 *  - names: an output file is named after its video (`Screen_Recording_20261030_101500.mp4` → `….m4a`), cleaned.
 *  - trim: "1:23", "83", "1:02:03.5" → milliseconds; start < end ≤ duration.
 *  - screen recordings: a video under Movies/Screen recordings or DCIM/Screen recordings (Samsung, Pixel, most others).
 *  - the recorder's state machine: idle → countdown → recording ⇄ paused → extracting → done (or error), driven by the
 *    person's taps / voice and by what the native recorder reports.
 */

import type { AudioExtractBridge, Handle } from './bridge';

export const FOLDER = 'audio-extract';
export const ID = 'ai.amberx.axf.console.audio-extract';

/* ---------------------------------------------------------------- settings */

export type AudioFormat = 'm4a' | 'wav';
export const FORMATS: { value: AudioFormat; label: string; detail: string }[] = [
  { value: 'm4a', label: 'M4A (original audio, no re-encode)', detail: 'The AAC track copied out as it is: lossless and fast.' },
  { value: 'wav', label: 'WAV (decoded, uncompressed)', detail: 'Decoded to 16-bit PCM. About ten times bigger.' },
];
export type Resolution = 'native' | '1080' | '720';
export type KeepWhat = 'both' | 'audio';

export const K = {
  format: 'audio-extract.format',
  folder: 'audio-extract.folder',
  watch: 'audio-extract.watch',
  autoExtract: 'audio-extract.autoExtract',
  deleteVideo: 'audio-extract.deleteVideo',
  resolution: 'audio-extract.rec.resolution',
  fps: 'audio-extract.rec.fps',
  videoMbps: 'audio-extract.rec.videoMbps',
  audioKbps: 'audio-extract.rec.audioKbps',
  keep: 'audio-extract.rec.keep',
  countdown: 'audio-extract.rec.countdown',
  chip: 'audio-extract.rec.chip',
} as const;

export interface Settings {
  format: AudioFormat;
  /** sub-folder of Music/ the audio files go to */
  folder: string;
  /** watch the screen-recording folders and offer to extract new ones (opt-in) */
  watch: boolean;
  /** extract a new screen recording without asking (only while watching) */
  autoExtract: boolean;
  /** delete the video once its audio is saved (asks Android first: it isn't AmberX's file) */
  deleteVideo: boolean;
  rec: RecorderSettings;
}

export interface RecorderSettings {
  resolution: Resolution;
  fps: 30 | 60;
  videoMbps: number;
  audioKbps: 128 | 192 | 256;
  /** `both` = keep the video and its audio; `audio` = the video is deleted once its audio is saved */
  keep: KeepWhat;
  /** seconds before recording starts, 0–10 */
  countdown: number;
  /** show the floating chip (elapsed, Stop) while recording */
  chip: boolean;
}

export const DEFAULT_FOLDER = 'AmberX Audio';
export const DEFAULTS: Settings = {
  format: 'm4a', folder: DEFAULT_FOLDER, watch: false, autoExtract: false, deleteVideo: false,
  rec: { resolution: 'native', fps: 30, videoMbps: 8, audioKbps: 192, keep: 'both', countdown: 3, chip: true },
};

const FOLDER_BAD = /[\\:*?"<>|\u0000-\u001f]/g;
/** A safe Music/ sub-folder: no "..", no leading/trailing slashes, at most two levels, ≤ 60 chars. */
export function cleanFolder(v: unknown): string {
  if (typeof v !== 'string') return DEFAULT_FOLDER;
  const parts = v.replace(FOLDER_BAD, '').split('/').map((p) => p.trim()).filter((p) => p && p !== '.' && p !== '..');
  const out = parts.slice(0, 2).join('/').slice(0, 60).trim();
  return out || DEFAULT_FOLDER;
}

const num = (v: unknown, d: number, lo: number, hi: number) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};
const pick = <T extends string | number>(v: unknown, allowed: readonly T[], d: T): T => {
  const hit = allowed.find((a) => String(a) === String(v));
  return hit ?? d;
};

/** Settings from the store (anything missing or malformed takes its default). */
export function readSettings(get: (key: string) => unknown): Settings {
  const d = DEFAULTS;
  return {
    format: pick(get(K.format), ['m4a', 'wav'] as const, d.format),
    folder: cleanFolder(get(K.folder) ?? d.folder),
    watch: get(K.watch) === true,
    autoExtract: get(K.autoExtract) === true,
    deleteVideo: get(K.deleteVideo) === true,
    rec: {
      resolution: pick(get(K.resolution), ['native', '1080', '720'] as const, d.rec.resolution),
      fps: pick(get(K.fps), [30, 60] as const, d.rec.fps),
      videoMbps: num(get(K.videoMbps), d.rec.videoMbps, 1, 40),
      audioKbps: pick(get(K.audioKbps), [128, 192, 256] as const, d.rec.audioKbps),
      keep: pick(get(K.keep), ['both', 'audio'] as const, d.rec.keep),
      countdown: Math.round(num(get(K.countdown), d.rec.countdown, 0, 10)),
      chip: get(K.chip) !== false,
    },
  };
}

/* ---------------------------------------------------------------- names */

const NAME_BAD = /[\\/:*?"<>|\u0000-\u001f]/g;
/** A file name stem: no path characters, no leading dots, ≤ 120 chars; '' when nothing is left. */
export function cleanStem(v: string): string {
  return v.replace(NAME_BAD, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+/, '').slice(0, 120).trim();
}
export const stemOf = (name: string) => name.replace(/\.[A-Za-z0-9]{1,5}$/, '');
export const extOf = (name: string) => (/\.([A-Za-z0-9]{1,5})$/.exec(name)?.[1] ?? '').toLowerCase();

/** The audio file's name for a video: same stem, the format's extension, a `_trim` mark when trimmed. */
export function outputName(videoName: string, format: AudioFormat, trimmed = false): string {
  const stem = cleanStem(stemOf(videoName)) || 'Audio';
  return `${stem}${trimmed ? '_trim' : ''}.${format}`;
}

/** A rename keeps the extension it has (`foo` → `foo.m4a`); null when the new name is empty. */
export function renameTo(current: string, next: string): string | null {
  const ext = extOf(current);
  const n = next.trim();
  const stem = cleanStem(ext && extOf(n) === ext ? stemOf(n) : n);
  if (!stem) return null;
  return ext ? `${stem}.${ext}` : stem;
}

/* ---------------------------------------------------------------- time + trim */

/** "1:23" / "83" / "1:02:03.5" / "" → ms (null when it isn't a time). '' → null. */
export function parseTime(v: string): number | null {
  const s = v.trim();
  if (!s) return null;
  if (!/^\d+(?::\d{1,2}){0,2}(?:\.\d{1,3})?$/.test(s)) return null;
  const [main, frac = ''] = s.split('.');
  const parts = main!.split(':').map(Number);
  if (parts.slice(1).some((p) => p > 59)) return null;
  const secs = parts.reduce((acc, p) => acc * 60 + p, 0);
  return secs * 1000 + (frac ? Math.round(Number(`0.${frac}`) * 1000) : 0);
}

/** ms → "m:ss" (or "h:mm:ss"). */
export function formatTime(ms: number): string {
  const t = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(t / 3600); const m = Math.floor((t % 3600) / 60); const s = t % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

export const formatSize = (bytes: number) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

export interface Trim { startMs: number; endMs: number | null }
/** Checks a trim against the video's length. `endMs: null` = to the end. */
export function checkTrim(startText: string, endText: string, durationMs: number | null): { ok: true; trim: Trim } | { ok: false; error: string } {
  const start = startText.trim() ? parseTime(startText) : 0;
  const end = endText.trim() ? parseTime(endText) : null;
  if (start === null) return { ok: false, error: 'Start isn’t a time (use 1:23 or 83).' };
  if (endText.trim() && end === null) return { ok: false, error: 'End isn’t a time (use 1:23 or 83).' };
  if (end !== null && end <= start) return { ok: false, error: 'End must be after the start.' };
  if (durationMs !== null && start >= durationMs) return { ok: false, error: `Start is past the end of the video (${formatTime(durationMs)}).` };
  const capped = end !== null && durationMs !== null && end >= durationMs ? null : end;
  return { ok: true, trim: { startMs: start, endMs: capped } };
}
export const isTrimmed = (t: Trim) => t.startMs > 0 || t.endMs !== null;

/* ---------------------------------------------------------------- videos + tracks */

export interface Video { uri: string; name: string; size?: number; durationMs?: number; dateMs?: number; relativePath?: string; mime?: string }
export interface AudioTrack { index: number; mime: string; channels: number; sampleRate: number; bitrate?: number; language?: string; durationMs?: number }

/** Folders screen recorders write to (Samsung: DCIM/Screen recordings; Pixel and others: Movies/Screen recordings). */
export const RECORDING_FOLDERS = ['Movies/Screen recordings/', 'DCIM/Screen recordings/', 'Movies/ScreenRecords/', 'DCIM/ScreenRecorder/'];
export function isScreenRecording(v: Pick<Video, 'name' | 'relativePath'>): boolean {
  const p = (v.relativePath ?? '').replace(/\\/g, '/').toLowerCase();
  const p2 = p.endsWith('/') ? p : `${p}/`;
  return RECORDING_FOLDERS.some((f) => p2.startsWith(f.toLowerCase())) || /^screen[_ -]?record(ing)?/i.test(v.name);
}

/** Copying (m4a) needs AAC; anything else has to be decoded (wav). */
export const copyable = (t: AudioTrack) => t.mime === 'audio/mp4a-latm';
export function trackLabel(t: AudioTrack): string {
  const codec = t.mime.replace(/^audio\//, '').replace('mp4a-latm', 'AAC').replace('vorbis', 'Vorbis').replace('opus', 'Opus');
  const ch = t.channels === 1 ? 'mono' : t.channels === 2 ? 'stereo' : `${t.channels} ch`;
  const kb = t.bitrate ? ` · ${Math.round(t.bitrate / 1000)} kbps` : '';
  return `Track ${t.index + 1}: ${codec}, ${ch}, ${Math.round(t.sampleRate / 100) / 10} kHz${kb}${t.language && t.language !== 'und' ? ` · ${t.language}` : ''}`;
}
/** Why a format can't be made from a track (null = fine). No fallback: the person picks another format. */
export function formatProblem(t: AudioTrack | undefined, f: AudioFormat): string | null {
  if (!t) return 'This video has no audio track.';
  if (f === 'm4a' && !copyable(t)) return `This audio is ${t.mime.replace(/^audio\//, '')}, which can’t be copied into an .m4a as is. Pick WAV.`;
  return null;
}

/* ---------------------------------------------------------------- jobs (batch queue) */

export type JobState = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
export interface AudioFile { uri: string; name: string; size: number; durationMs?: number; dateMs?: number; mime?: string }
export interface Job {
  id: string;
  video: Video;
  track: number;
  format: AudioFormat;
  trim: Trim;
  name: string;
  state: JobState;
  progress: number;
  result?: AudioFile;
  error?: string;
  /** delete the video after a successful extract */
  deleteVideo: boolean;
  /** made by the built-in recorder (its video is AmberX's own, so it's deleted without asking) */
  fromRecorder?: boolean;
}

let seq = 0;
export const jobId = (now = Date.now()) => `ae-${now.toString(36)}-${(seq++).toString(36)}`;

export function newJob(video: Video, o: { format: AudioFormat; track?: number; trim?: Trim; deleteVideo?: boolean; fromRecorder?: boolean; id?: string }): Job {
  const trim = o.trim ?? { startMs: 0, endMs: null };
  return {
    id: o.id ?? jobId(), video, track: o.track ?? -1, format: o.format, trim, name: outputName(video.name, o.format, isTrimmed(trim)),
    state: 'queued', progress: 0, deleteVideo: o.deleteVideo === true, ...(o.fromRecorder ? { fromRecorder: true } : {}),
  };
}

/** The next job to run (one at a time, oldest first), or null while one runs or none wait. */
export function nextJob(jobs: readonly Job[]): Job | null {
  if (jobs.some((j) => j.state === 'running')) return null;
  return jobs.find((j) => j.state === 'queued') ?? null;
}

export type JobEvent =
  | { type: 'start'; id: string }
  | { type: 'progress'; id: string; progress: number }
  | { type: 'done'; id: string; result: AudioFile }
  | { type: 'failed'; id: string; error: string }
  | { type: 'cancel'; id: string };

export function jobReduce(jobs: readonly Job[], e: JobEvent): Job[] {
  return jobs.map((j) => {
    if (j.id !== e.id) return j;
    const open = j.state === 'queued' || j.state === 'running';
    switch (e.type) {
      case 'start': return j.state === 'queued' ? { ...j, state: 'running', progress: 0 } : j;
      case 'progress': return j.state === 'running' ? { ...j, progress: Math.max(j.progress, Math.min(1, Math.max(0, e.progress))) } : j;
      case 'done': return j.state === 'running' ? { ...j, state: 'done', progress: 1, result: e.result } : j;
      case 'failed': return open ? { ...j, state: 'failed', error: e.error || 'It failed.' } : j;
      case 'cancel': return open ? { ...j, state: 'cancelled' } : j;
      default: return j;
    }
  });
}

/** Totals for the batch strip: how many done / failed / left and the overall progress 0–1. */
export function batchProgress(jobs: readonly Job[]) {
  const live = jobs.filter((j) => j.state !== 'cancelled');
  const done = live.filter((j) => j.state === 'done').length;
  const failed = live.filter((j) => j.state === 'failed').length;
  const left = live.filter((j) => j.state === 'queued' || j.state === 'running').length;
  const sum = live.reduce((a, j) => a + (j.state === 'done' || j.state === 'failed' ? 1 : j.progress), 0);
  return { total: live.length, done, failed, left, progress: live.length ? sum / live.length : 0 };
}

/* ---------------------------------------------------------------- recorder state machine */

export type RecPhase = 'idle' | 'starting' | 'countdown' | 'recording' | 'paused' | 'extracting' | 'done' | 'error';
export interface RecState {
  phase: RecPhase;
  /** seconds left on the countdown */
  remaining: number;
  /** recorded time so far (paused time excluded) */
  elapsedMs: number;
  /** the finished video (AmberX's own file) */
  video?: Video;
  /** the extract job made from it */
  jobId?: string;
  /** the audio file it made */
  audio?: AudioFile;
  /** false = Android refused playback capture for this recording (the video has no sound track) */
  playbackAudio: boolean;
  error?: string;
}
export const REC_IDLE: RecState = { phase: 'idle', remaining: 0, elapsedMs: 0, playbackAudio: true };

/** What the native recorder reports (`recorder` event). */
export type NativeRec =
  | { state: 'countdown'; remaining: number }
  | { state: 'recording'; elapsedMs: number; playbackAudio?: boolean }
  | { state: 'paused'; elapsedMs: number }
  | { state: 'stopped'; video: Video; elapsedMs: number; playbackAudio?: boolean }
  | { state: 'cancelled' }
  | { state: 'error'; error: string };

export type RecEvent =
  | { type: 'start' }               // person: start (consent dialog comes next)
  | { type: 'refused'; error?: string } // consent refused / native start failed
  | { type: 'native'; e: NativeRec }
  | { type: 'pause' } | { type: 'resume' } | { type: 'stop' }
  | { type: 'extract'; jobId: string } // the controller queued the stopped video's extract
  | { type: 'extracted'; audio: AudioFile }
  | { type: 'extractFailed'; error: string }
  | { type: 'reset' };

/** Phases the person can stop from (and the native side is busy in). */
export const recActive = (p: RecPhase) => p === 'starting' || p === 'countdown' || p === 'recording' || p === 'paused';

export function recReduce(s: RecState, ev: RecEvent): RecState {
  switch (ev.type) {
    case 'start':
      return s.phase === 'idle' || s.phase === 'done' || s.phase === 'error' ? { ...REC_IDLE, phase: 'starting' } : s;
    case 'refused':
      return s.phase === 'starting' ? { ...REC_IDLE, ...(ev.error ? { phase: 'error', error: ev.error } : {}) } : s;
    case 'pause':
      return s.phase === 'recording' ? { ...s, phase: 'paused' } : s;
    case 'resume':
      return s.phase === 'paused' ? { ...s, phase: 'recording' } : s;
    case 'stop':
      // countdown/starting stop = cancel; recording/paused wait for the native `stopped` with the file
      return s.phase === 'countdown' || s.phase === 'starting' ? { ...REC_IDLE } : s;
    case 'extract':
      return s.phase === 'extracting' ? { ...s, jobId: ev.jobId } : s;
    case 'extracted':
      return s.phase === 'extracting' ? { ...s, phase: 'done', audio: ev.audio } : s;
    case 'extractFailed':
      return s.phase === 'extracting' ? { ...s, phase: 'error', error: ev.error } : s;
    case 'reset':
      return recActive(s.phase) || s.phase === 'extracting' ? s : { ...REC_IDLE };
    case 'native': {
      const e = ev.e;
      switch (e.state) {
        case 'countdown': return s.phase === 'starting' || s.phase === 'countdown' ? { ...s, phase: 'countdown', remaining: Math.max(0, Math.round(e.remaining)) } : s;
        case 'recording': return recActive(s.phase) ? { ...s, phase: 'recording', remaining: 0, elapsedMs: Math.max(0, e.elapsedMs), playbackAudio: e.playbackAudio ?? s.playbackAudio } : s;
        case 'paused': return s.phase === 'recording' || s.phase === 'paused' ? { ...s, phase: 'paused', elapsedMs: Math.max(0, e.elapsedMs) } : s;
        case 'stopped': return recActive(s.phase) ? { ...s, phase: 'extracting', elapsedMs: e.elapsedMs, video: e.video, playbackAudio: e.playbackAudio ?? s.playbackAudio } : s;
        case 'cancelled': return recActive(s.phase) ? { ...REC_IDLE } : s;
        case 'error': return { ...REC_IDLE, phase: 'error', error: e.error };
        default: return s;
      }
    }
    default:
      return s;
  }
}

/** One plain line for the recorder's state. */
export function recLabel(s: RecState): string {
  switch (s.phase) {
    case 'idle': return 'Ready to record';
    case 'starting': return 'Waiting for Android’s screen capture prompt…';
    case 'countdown': return `Starting in ${s.remaining}…`;
    case 'recording': return `Recording · ${formatTime(s.elapsedMs)}`;
    case 'paused': return `Paused · ${formatTime(s.elapsedMs)}`;
    case 'extracting': return 'Saving the audio…';
    case 'done': return 'Saved';
    case 'error': return s.error ?? 'Recording failed';
    default: return '';
  }
}

/* ---------------------------------------------------------------- voice */

export const VOICE = {
  extractLast: ['extract audio from my last screen recording', 'extract audio from the last screen recording', 'extract audio from last recording', 'extract the audio', 'extract audio'],
  pick: ['pick a video to extract', 'extract audio from a video'],
  recStart: ['start screen recording', 'start recording the screen', 'record the screen', 'record my screen'],
  recStop: ['stop screen recording', 'stop recording'],
  recPause: ['pause recording', 'pause screen recording'],
  recResume: ['resume recording', 'resume screen recording'],
  open: ['open audio extract', 'audio extract'],
} as const;

/* ---------------------------------------------------------------- controller (bridge-driven; React subscribes) */

export interface Store {
  /** this session's extract jobs, newest last */
  jobs: Job[];
  /** audio files in Music/<folder> */
  files: AudioFile[];
  filesLoaded: boolean;
  rec: RecState;
  /** new screen recordings waiting for "extract audio?" */
  offers: Video[];
  /** one plain line about the last thing that happened */
  note: string;
  /** screen-recording folders granted through the folder picker (null = not read yet) */
  folders: { uri: string; name: string }[] | null;
}

export interface Hooks {
  settings(): Settings;
  toast?(text: string, tone: 'info' | 'success' | 'warning' | 'danger'): void;
  /** spoken / shown after a voice command */
  say?(text: string): void;
}

const msg = (e: unknown) => (e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : String(e));
const refusedConsent = (m: string) => /cancel|denied|refused|declined/i.test(m);
const codeOf = (e: unknown) => (typeof e === 'object' && e && 'code' in e ? String((e as { code: unknown }).code) : '');

export type Controller = ReturnType<typeof createController>;

/**
 * The plugin's one controller. `bridge` null = no native side (the page says so; nothing runs).
 * Jobs run one at a time; a batch is just several queued jobs.
 */
export function createController(bridge: AudioExtractBridge | null, hooks: Hooks) {
  let st: Store = { jobs: [], files: [], filesLoaded: false, rec: { ...REC_IDLE }, offers: [], note: '', folders: null };
  const subs = new Set<() => void>();
  const set = (p: Partial<Store>) => { st = { ...st, ...p }; subs.forEach((f) => f()); };
  const jobs = (e: JobEvent) => set({ jobs: jobReduce(st.jobs, e) });
  const rec = (e: RecEvent) => set({ rec: recReduce(st.rec, e) });
  const handles: Handle[] = [];
  let pumping: Promise<void> | null = null;
  let watching = false;

  const job = (id: string) => st.jobs.find((j) => j.id === id);

  async function runOne(j: Job): Promise<void> {
    const b = bridge!;
    jobs({ type: 'start', id: j.id });
    try {
      const info = await b.probe({ uri: j.video.uri });
      if (job(j.id)?.state !== 'running') return;
      const track = j.track >= 0 ? info.tracks.find((t) => t.index === j.track) : info.tracks[0];
      const problem = formatProblem(track, j.format);
      if (problem) throw new Error(problem);
      if (j.trim.startMs >= info.durationMs && info.durationMs > 0) throw new Error(`Start is past the end of the video (${formatTime(info.durationMs)}).`);
      const result = await b.extract({
        jobId: j.id, uri: j.video.uri, track: track!.index, format: j.format, startMs: j.trim.startMs,
        endMs: j.trim.endMs ?? -1, folder: hooks.settings().folder, name: j.name,
      });
      if (job(j.id)?.state !== 'running') return; // cancelled while finishing: native already removed the file
      jobs({ type: 'done', id: j.id, result });
      set({ files: [result, ...st.files.filter((f) => f.uri !== result.uri)], note: `Saved ${result.name} to Music/${hooks.settings().folder}.` });
      if (j.deleteVideo) {
        try {
          const r = await b.deleteVideo({ uri: j.video.uri });
          if (!r.deleted) set({ note: `Saved ${result.name}. The video was kept (deleting it wasn’t allowed).` });
        } catch (e) { set({ note: `Saved ${result.name}. The video couldn’t be deleted: ${msg(e)}` }); }
      }
      if (j.fromRecorder) rec({ type: 'extracted', audio: result });
    } catch (e) {
      const m = msg(e);
      if (job(j.id)?.state === 'cancelled') return;
      jobs({ type: 'failed', id: j.id, error: m });
      if (j.fromRecorder) rec({ type: 'extractFailed', error: `The video is saved, but its audio wasn’t: ${m}` });
      hooks.toast?.(`${j.video.name}: ${m}`, 'danger');
    }
  }

  function pump(): Promise<void> {
    if (pumping || !bridge) return pumping ?? Promise.resolve();
    pumping = (async () => {
      for (let j = nextJob(st.jobs); j; j = nextJob(st.jobs)) await runOne(j);
    })().finally(() => { pumping = null; });
    return pumping;
  }

  const c = {
    get: () => st,
    subscribe(fn: () => void) { subs.add(fn); return () => { subs.delete(fn); }; },
    available: () => bridge !== null,

    /** Listeners, shared videos waiting from before the page loaded, the folder watch. Call once. */
    async attach(): Promise<void> {
      if (!bridge) return;
      handles.push(await bridge.addListener('progress', (e) => jobs({ type: 'progress', id: e.jobId, progress: e.progress })));
      handles.push(await bridge.addListener('shared', (e) => { if (e.videos?.length) c.enqueue(e.videos); }));
      handles.push(await bridge.addListener('newRecording', (e) => c.offer(e.video)));
      handles.push(await bridge.addListener('recorder', (e) => c.onRecorder(e)));
      const { videos } = await bridge.takeShared().catch(() => ({ videos: [] as Video[] }));
      if (videos.length) c.enqueue(videos);
      await c.refreshFolders();
      await c.syncWatch();
    },
    async detach(): Promise<void> {
      for (const h of handles.splice(0)) await h.remove();
      if (watching && bridge) await bridge.watch({ on: false }).catch(() => undefined);
      watching = false;
    },
    /** Follows the "watch screen recordings" setting. */
    async syncWatch(): Promise<void> {
      if (!bridge) return;
      const on = hooks.settings().watch;
      if (on === watching) return;
      watching = on;
      await bridge.watch({ on }).catch((e) => { watching = false; set({ note: `Can’t watch the screen recording folders: ${msg(e)}` }); });
    },

    /** Queue videos with today's settings (format, delete after); returns the jobs. */
    enqueue(videos: Video[], o: { track?: number; trim?: Trim; format?: AudioFormat; deleteVideo?: boolean; fromRecorder?: boolean } = {}): Job[] {
      if (!bridge || !videos.length) return [];
      const s = hooks.settings();
      const add = videos.map((v) => newJob(v, { format: o.format ?? s.format, track: o.track, trim: o.trim, deleteVideo: o.deleteVideo ?? s.deleteVideo, fromRecorder: o.fromRecorder }));
      set({ jobs: [...st.jobs, ...add], offers: st.offers.filter((x) => !videos.some((v) => v.uri === x.uri)) });
      void pump();
      return add;
    },
    pump,
    async cancel(id: string): Promise<void> {
      const j = job(id);
      if (!j || (j.state !== 'queued' && j.state !== 'running')) return;
      const running = j.state === 'running';
      jobs({ type: 'cancel', id });
      if (running && bridge) await bridge.cancel({ jobId: id }).catch(() => undefined);
    },
    async cancelAll(): Promise<void> { for (const j of st.jobs) await c.cancel(j.id); },
    clearFinished() { set({ jobs: st.jobs.filter((j) => j.state === 'queued' || j.state === 'running') }); },
    /** Re-queue a failed or cancelled job as it was. */
    retry(id: string) {
      const j = job(id);
      if (!j || (j.state !== 'failed' && j.state !== 'cancelled')) return;
      set({ jobs: st.jobs.map((x) => (x.id === id ? { ...x, state: 'queued', progress: 0, error: undefined } : x)) });
      void pump();
    },

    async pick(multiple = true, o: { track?: number; trim?: Trim; format?: AudioFormat } = {}): Promise<Job[]> {
      if (!bridge) return [];
      try {
        const { videos } = await bridge.pickVideos({ multiple });
        return c.enqueue(videos, o);
      } catch (e) { const m = msg(e); if (!refusedConsent(m)) set({ note: m }); return []; }
    },
    /** Pick one video without queuing it (the trim / track card). */
    async pickOne(): Promise<{ video: Video; durationMs: number; tracks: AudioTrack[] } | null> {
      if (!bridge) return null;
      try {
        const { videos } = await bridge.pickVideos({ multiple: false });
        const video = videos[0];
        if (!video) return null;
        const info = await bridge.probe({ uri: video.uri });
        return { video: { ...video, durationMs: info.durationMs }, durationMs: info.durationMs, tracks: info.tracks };
      } catch (e) { const m = msg(e); if (!refusedConsent(m)) set({ note: m }); return null; }
    },
    /** "Extract audio from my last screen recording". */
    async extractLatest(): Promise<Job | null> {
      if (!bridge) { hooks.say?.('Audio extract needs the AmberX app on Android.'); return null; }
      let video: Video | null = null;
      try { ({ video } = await bridge.latestRecording()); }
      catch (e) {
        if (codeOf(e) === 'no-folder') { set({ note: 'Choose your Screen recordings folder once (Android asks), then try again.', folders: [] }); hooks.say?.('Choose your screen recordings folder first.'); return null; }
        set({ note: msg(e) }); return null;
      }
      if (!video) { set({ note: 'No screen recordings found in Movies or DCIM → Screen recordings.' }); hooks.say?.('I found no screen recordings.'); return null; }
      hooks.say?.(`Extracting the audio from ${video.name}.`);
      return c.enqueue([video])[0] ?? null;
    },

    /** A new screen recording turned up: extract it now (auto-extract on) or offer it. */
    offer(video: Video) {
      if (!video?.uri || st.offers.some((v) => v.uri === video.uri) || st.jobs.some((j) => j.video.uri === video.uri)) return;
      if (st.rec.video?.uri === video.uri) return; // the built-in recorder's own video is handled by the recorder
      if (hooks.settings().autoExtract) { c.enqueue([video]); return; }
      set({ offers: [video, ...st.offers].slice(0, 10) });
    },
    acceptOffer(uri: string) { const v = st.offers.find((x) => x.uri === uri); if (v) c.enqueue([v]); },
    dismissOffer(uri: string) { set({ offers: st.offers.filter((x) => x.uri !== uri) }); },

    async refreshFolders(): Promise<void> {
      if (!bridge) return;
      const { folders } = await bridge.folders().catch(() => ({ folders: [] as { uri: string; name: string }[] }));
      set({ folders });
    },
    async addFolder(): Promise<boolean> {
      if (!bridge) return false;
      try {
        const { folder } = await bridge.addFolder();
        set({ folders: [...(st.folders ?? []).filter((f) => f.uri !== folder.uri), folder], note: `AmberX can read ${folder.name} now.` });
        if (watching) { await bridge.watch({ on: true }).catch(() => undefined); }
        return true;
      } catch (e) { const m = msg(e); if (!refusedConsent(m)) set({ note: m }); return false; }
    },
    async removeFolder(uri: string): Promise<void> {
      if (!bridge) return;
      await bridge.removeFolder({ uri }).catch((e) => set({ note: msg(e) }));
      set({ folders: (st.folders ?? []).filter((f) => f.uri !== uri) });
    },

    async refreshFiles(): Promise<void> {
      if (!bridge) return;
      try { const { files } = await bridge.list({ folder: hooks.settings().folder }); set({ files, filesLoaded: true }); }
      catch (e) { set({ filesLoaded: true, note: `Can’t list the audio files: ${msg(e)}` }); }
    },
    async rename(f: AudioFile, next: string): Promise<boolean> {
      const name = renameTo(f.name, next);
      if (!bridge || !name || name === f.name) return false;
      try {
        const r = await bridge.rename({ uri: f.uri, name });
        set({ files: st.files.map((x) => (x.uri === f.uri ? { ...x, name: r.name } : x)) });
        return true;
      } catch (e) { hooks.toast?.(`Couldn’t rename: ${msg(e)}`, 'danger'); return false; }
    },
    async remove(f: AudioFile): Promise<boolean> {
      if (!bridge) return false;
      try { await bridge.remove({ uri: f.uri }); set({ files: st.files.filter((x) => x.uri !== f.uri) }); return true; }
      catch (e) { hooks.toast?.(`Couldn’t delete: ${msg(e)}`, 'danger'); return false; }
    },
    play: (f: AudioFile) => bridge?.play({ uri: f.uri }).catch((e) => hooks.toast?.(msg(e), 'danger')),
    share: (f: AudioFile) => bridge?.share({ uri: f.uri, mime: f.mime }).catch((e) => hooks.toast?.(msg(e), 'danger')),

    /* recorder */
    async recStart(): Promise<void> {
      if (!bridge) { hooks.say?.('Screen recording needs the AmberX app on Android.'); return; }
      if (recActive(st.rec.phase) || st.rec.phase === 'extracting') return;
      rec({ type: 'start' });
      const s = hooks.settings();
      await bridge.notifications().catch(() => undefined);
      try { await bridge.recordStart({ ...s.rec, folder: s.folder }); }
      catch (e) { const m = msg(e); rec({ type: 'refused', ...(refusedConsent(m) ? {} : { error: m }) }); if (refusedConsent(m)) set({ note: 'Screen capture wasn’t allowed, so nothing was recorded.' }); }
    },
    async recPause(): Promise<void> { if (bridge && st.rec.phase === 'recording') { rec({ type: 'pause' }); await bridge.recordPause().catch((e) => set({ note: msg(e) })); } },
    async recResume(): Promise<void> { if (bridge && st.rec.phase === 'paused') { rec({ type: 'resume' }); await bridge.recordResume().catch((e) => set({ note: msg(e) })); } },
    async recStop(): Promise<void> {
      if (!bridge || !recActive(st.rec.phase)) return;
      rec({ type: 'stop' });
      await bridge.recordStop().catch((e) => set({ note: msg(e) }));
    },
    recReset() { rec({ type: 'reset' }); },
    /** What the native recorder reports. A stopped recording goes straight through the extractor. */
    onRecorder(e: NativeRec) {
      const before = st.rec.phase;
      rec({ type: 'native', e });
      if (e.state === 'stopped' && st.rec.phase === 'extracting' && before !== 'extracting') {
        const s = hooks.settings();
        const [j] = c.enqueue([e.video], { fromRecorder: true, deleteVideo: s.rec.keep === 'audio' });
        if (j) rec({ type: 'extract', jobId: j.id });
        else rec({ type: 'extractFailed', error: 'The video is saved, but its audio couldn’t be queued.' });
      }
    },
  };
  return c;
}
