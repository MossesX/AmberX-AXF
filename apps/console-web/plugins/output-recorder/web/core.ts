/**
 * Audio Output Recorder core: pure rules, no React. The page, test.mts and (as twins) the Java side use the same ones.
 *
 *  - the phone records what it plays (AudioPlaybackCapture, never the microphone) into timestamped chunks, 30 min each
 *    by default, and sends each to axHub; the local copy stays until axHub confirms it (OutputRecordUploader.java)
 *  - on axHub: the data server (same store as AmberX notes) in its own hub project, `amberx-recordings` by default.
 *    The data server takes text documents of ≤ 64 KB, so a chunk is numbered parts plus an index:
 *      output-recorder/parts/<id>/0000.json        { $axf: 'audio-part@1', id, n, b64 }      (44 000 audio bytes each)
 *      output-recorder/recordings/<id>.json         { $axf: 'audio-recording@1', id, name, startedAt, …, parts, sha256 }
 *    The data server has no delete, so Delete overwrites the parts with empty stubs and marks the index `deleted`
 *    (that gives the space back; the files stay listed).
 *  - the hub list is read with the page's own hub session (`GET /data/<project>` lists the files).
 */

/** The hub every AmberX build talks to (lib-hubstore's default; the native side's HubRules.HUB). */
export const DEFAULT_HUB = 'https://axhub.amberxai.com';
/** A hub project / path segment name (lib-hubstore's rule; no imports here so test.mts runs under plain Node). */
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const isSafeName = (s: unknown): s is string => typeof s === 'string' && SEGMENT.test(s) && !s.includes('..');
/** https only (http for localhost), never with credentials in it; null when refused. */
export function hubOriginOf(url: unknown): string | null {
  try {
    const u = new URL(String(url));
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
    if (u.username || u.password) return null;
    if (u.protocol === 'https:' || (local && u.protocol === 'http:')) return u.origin;
  } catch { /* not a URL */ }
  return null;
}

export const ID = 'ai.amberx.axf.console.output-recorder';
export const FOLDER = 'output-recorder';
export const HUB_FOLDER = 'output-recorder';
export const DEFAULT_PROJECT = 'amberx-recordings';
/** Audio bytes per part: base64 of this plus the JSON wrapper stays under the data server's 64 KB. */
export const PART_BYTES = 44_000;
export const HUB_DOC_MAX = 64 * 1024;
export const PART_FORMAT = 'audio-part@1';
export const INDEX_FORMAT = 'audio-recording@1';

/* ---------------------------------------------------------------- settings (twin: OutputRecordQueue.Settings) */

export type WhenFull = 'stop' | 'drop-oldest';
export interface Settings {
  /** AAC bitrate */
  kbps: 24 | 32 | 48 | 64 | 96;
  /** 1 = mono (downmixed, half the size), 2 = stereo */
  channels: 1 | 2;
  /** minutes per chunk */
  chunkMin: number;
  /** what the phone may hold while axHub can't be reached, MB */
  capMb: number;
  /** over the cap: stop recording (nothing lost) or drop the oldest unsent chunk */
  whenFull: WhenFull;
  /** drop a chunk that was silent all through */
  skipSilent: boolean;
  /** hub project the recordings go to */
  project: string;
}

export const K = {
  kbps: 'output-recorder.kbps',
  channels: 'output-recorder.channels',
  chunkMin: 'output-recorder.chunkMin',
  capMb: 'output-recorder.capMb',
  whenFull: 'output-recorder.whenFull',
  skipSilent: 'output-recorder.skipSilent',
  project: 'output-recorder.project',
} as const;

export const DEFAULTS: Settings = { kbps: 32, channels: 1, chunkMin: 30, capMb: 200, whenFull: 'stop', skipSilent: true, project: DEFAULT_PROJECT };
export const KBPS = [24, 32, 48, 64, 96] as const;

const num = (v: unknown, d: number, lo: number, hi: number) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.round(Math.min(hi, Math.max(lo, n))) : d;
};
const pick = <T extends string | number>(v: unknown, allowed: readonly T[], d: T): T => allowed.find((a) => String(a) === String(v)) ?? d;

export const cleanProject = (v: unknown): string => {
  const p = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return isSafeName(p) && /^[a-z0-9][a-z0-9._-]{0,99}$/.test(p) ? p : DEFAULT_PROJECT;
};

/** Settings from the store (anything missing or malformed takes its default; same bounds as the Java side). */
export function readSettings(get: (key: string) => unknown): Settings {
  const d = DEFAULTS;
  return {
    kbps: pick(get(K.kbps), KBPS, d.kbps),
    channels: pick(get(K.channels), [1, 2] as const, d.channels),
    chunkMin: num(get(K.chunkMin), d.chunkMin, 5, 60),
    capMb: num(get(K.capMb), d.capMb, 50, 2000),
    whenFull: pick(get(K.whenFull), ['stop', 'drop-oldest'] as const, d.whenFull),
    skipSilent: get(K.skipSilent) !== false,
    project: cleanProject(get(K.project) ?? d.project),
  };
}

/** Bytes a chunk takes at these settings (AAC at a constant bitrate, plus ~1 % container). */
export function chunkBytes(s: Pick<Settings, 'kbps' | 'chunkMin'>): number {
  return Math.round((s.kbps * 1000 / 8) * s.chunkMin * 60 * 1.01);
}
/** How many hours the local cap holds at these settings. */
export function capHours(s: Pick<Settings, 'kbps' | 'capMb'>): number {
  return (s.capMb * 1024 * 1024) / (s.kbps * 1000 / 8) / 3600;
}
/** Hours of audio a hub project holds (100 MB, base64 adds a third). */
export function hubHours(kbps: number, projectMb = 100): number {
  return (projectMb * 1024 * 1024 * 0.75) / (kbps * 1000 / 8) / 3600;
}

/* ---------------------------------------------------------------- chunk ids, hub paths, parts */

/** `20261030-101500-k3x9`: local start time + four random letters (twin: OutputRecordQueue.isId). */
export const isChunkId = (id: unknown): id is string => typeof id === 'string' && /^\d{8}-\d{6}-[a-z0-9]{4}$/.test(id);

/** When a chunk started, read from its id (local time). */
export function idDate(id: string): Date | null {
  if (!isChunkId(id)) return null;
  const n = (a: number, b: number) => Number(id.slice(a, b));
  const t = new Date(n(0, 4), n(4, 6) - 1, n(6, 8), n(9, 11), n(11, 13), n(13, 15));
  return Number.isNaN(t.getTime()) ? null : t;
}

/** The name a chunk gets: "Phone audio 2026-10-30 10:15". */
export function chunkName(id: string): string {
  return isChunkId(id) ? `Phone audio ${id.slice(0, 4)}-${id.slice(4, 6)}-${id.slice(6, 8)} ${id.slice(9, 11)}:${id.slice(11, 13)}` : 'Phone audio';
}

/**
 * A session's part name (Claude's session recordings through axHub's `amberx.recorder_start`, axHub decision 108):
 * "<session_name> - <YYYY-MM-DD HH-mm> - partN", the time being when the session started (local), N from 1.
 * Twin: RecorderControl.partName (Android). Characters files can't hold become spaces.
 */
export function sessionPartName(session: string, started: Date, part: number): string {
  const p = (v: number) => String(v).padStart(2, '0');
  const when = `${started.getFullYear()}-${p(started.getMonth() + 1)}-${p(started.getDate())} ${p(started.getHours())}-${p(started.getMinutes())}`;
  return `${cleanSession(session)} - ${when} - part${Math.max(1, Math.floor(part))}`;
}

/** A session or group name made safe for a file name and a list heading (twin: RecorderControl.clean). */
export function cleanSession(raw: unknown): string {
  const c = (typeof raw === 'string' ? raw : '').replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  return c || 'Session';
}

export const partPath = (id: string, n: number) => `${HUB_FOLDER}/parts/${id}/${String(n).padStart(4, '0')}.json`;
export const indexPath = (id: string) => `${HUB_FOLDER}/recordings/${id}.json`;
export const partCount = (bytes: number) => Math.ceil(Math.max(0, bytes) / PART_BYTES);

/** The id an index path belongs to, or null. */
export function idOfIndex(path: string): string | null {
  const m = /^output-recorder\/recordings\/([^/]+)\.json$/.exec(path);
  return m && isChunkId(m[1]) ? m[1] : null;
}

/** The hub to use: https only (http for localhost), never with credentials in it. */
export const hubOf = (v?: unknown): string => hubOriginOf(v ?? DEFAULT_HUB) ?? DEFAULT_HUB;

export function dataUrl(hub: string, project: string, path = ''): string {
  if (!isSafeName(project)) throw new Error(`"${project}" isn't a hub project name`);
  if (path && (path.includes('..') || !path.split('/').every((p) => SEGMENT.test(p)))) throw new Error(`"${path}" isn't a safe hub path`);
  return `${hub}/data/${project}${path ? `/${path}` : ''}`;
}

/* ---------------------------------------------------------------- base64 parts */

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function toBase64(b: Uint8Array): string {
  let out = '';
  for (let i = 0; i < b.length; i += 3) {
    const n = ((b[i] ?? 0) << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    out += B64.charAt((n >> 18) & 63) + B64.charAt((n >> 12) & 63) + (i + 1 < b.length ? B64.charAt((n >> 6) & 63) : '=') + (i + 2 < b.length ? B64.charAt(n & 63) : '=');
  }
  return out;
}
export function fromBase64(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const at = (k: number) => Math.max(0, B64.indexOf(clean.charAt(k) || 'A'));
    const n = (at(i) << 18) | (at(i + 1) << 12) | (at(i + 2) << 6) | at(i + 3);
    out[o++] = (n >> 16) & 255;
    if (i + 2 < clean.length) out[o++] = (n >> 8) & 255;
    if (i + 3 < clean.length) out[o++] = n & 255;
  }
  return out.slice(0, o);
}

/** The part documents for a file, as the phone writes them (each under the data server's 64 KB). */
export function splitParts(id: string, bytes: Uint8Array): { path: string; body: string }[] {
  const out: { path: string; body: string }[] = [];
  for (let n = 0; n * PART_BYTES < bytes.length; n++) {
    const body = JSON.stringify({ $axf: PART_FORMAT, id, n, b64: toBase64(bytes.subarray(n * PART_BYTES, (n + 1) * PART_BYTES)) });
    out.push({ path: partPath(id, n), body });
  }
  return out;
}

/* ---------------------------------------------------------------- the index on axHub */

export interface Recording {
  id: string;
  name: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  bytes: number;
  mime: string;
  kbps: number;
  channels: number;
  device: string;
  parts: number;
  sha256: string;
  uploadedAt: string;
  deleted: boolean;
  /** The recording group on axHub (a session's name when started through axHub, decision 108); '' = none. */
  group: string;
  /** The session it belongs to and its note, when started through axHub. */
  session: string;
  note: string;
}

/** An index document read from the hub, checked (null = not one of ours or damaged). */
export function normalizeIndex(raw: unknown, id: string): Recording | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.$axf !== INDEX_FORMAT || r.id !== id || !isChunkId(id)) return null;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
  const s = (v: unknown, d = '') => (typeof v === 'string' ? v.slice(0, 200) : d);
  const bytes = n(r.bytes);
  const parts = n(r.parts);
  if (parts !== partCount(bytes) && r.deleted !== true) return null;
  return {
    id, name: s(r.name, chunkName(id)) || chunkName(id), startedAt: s(r.startedAt), endedAt: s(r.endedAt), durationMs: n(r.durationMs),
    bytes, mime: s(r.mime, 'audio/mp4') || 'audio/mp4', kbps: n(r.kbps), channels: n(r.channels), device: s(r.device), parts,
    sha256: /^[0-9a-f]{64}$/.test(s(r.sha256)) ? s(r.sha256) : '', uploadedAt: s(r.uploadedAt), deleted: r.deleted === true,
    group: s(r.group).slice(0, 80), session: s(r.session).slice(0, 80), note: typeof r.note === 'string' ? r.note.slice(0, 500) : '',
  };
}

/** Newest first; deleted ones out. */
export const sortRecordings = (list: Recording[]) => list.filter((r) => !r.deleted).sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));

/** Recordings grouped by local day ("2026-10-30"), newest day first. */
export function byDay(list: Recording[]): { day: string; items: Recording[] }[] {
  const days = new Map<string, Recording[]>();
  for (const r of sortRecordings(list)) {
    const day = `${r.id.slice(0, 4)}-${r.id.slice(4, 6)}-${r.id.slice(6, 8)}`;
    days.set(day, [...(days.get(day) ?? []), r]);
  }
  return [...days.entries()].map(([day, items]) => ({ day, items }));
}

/**
 * Recordings grouped for the list: a session's parts under its group name, the rest by local day; groups are ordered by
 * their newest recording, parts inside a group oldest first (part1, part2, …).
 */
export function byGroup(list: Recording[]): { key: string; label: string; group: boolean; items: Recording[] }[] {
  const out = new Map<string, { key: string; label: string; group: boolean; items: Recording[] }>();
  for (const r of sortRecordings(list)) {
    const key = r.group ? `g:${r.group}` : `d:${r.id.slice(0, 8)}`;
    const label = r.group || `${r.id.slice(0, 4)}-${r.id.slice(4, 6)}-${r.id.slice(6, 8)}`;
    if (!out.has(key)) out.set(key, { key, label, group: !!r.group, items: [] });
    out.get(key)!.items.push(r);
  }
  return [...out.values()].map((g) => (g.group ? { ...g, items: [...g.items].reverse() } : g));
}

/* ---------------------------------------------------------------- the hub client (the page's own hub session) */

export interface HubClientOptions { hub: string; project: string; fetchImpl?: typeof fetch }

export class HubRecordings {
  readonly hub: string;
  readonly project: string;
  private readonly f: typeof fetch;
  constructor(o: HubClientOptions) {
    this.hub = hubOf(o.hub);
    this.project = cleanProject(o.project);
    this.f = o.fetchImpl ?? ((i, n) => fetch(i, n));
  }

  private async req(path: string, init: RequestInit = {}): Promise<Response> {
    let r: Response;
    try { r = await this.f(dataUrl(this.hub, this.project, path), { credentials: 'include', redirect: 'error', cache: 'no-store', ...init }); }
    catch (e) { throw new Error(`axHub can’t be reached (${(e as Error).message}).`); }
    if (r.status === 401 || r.status === 403) throw new Error(`Sign in to axHub (${r.status}) to see recordings.`);
    return r;
  }

  /** Every recording's index (newest first, deleted ones out). A project that doesn't exist yet = none. */
  async list(): Promise<Recording[]> {
    const r = await this.req('');
    if (r.status === 404) return [];
    if (!r.ok) throw new Error(`axHub answered ${r.status}.`);
    const body = (await r.json()) as { files?: { path?: string }[] };
    const ids = (body.files ?? []).map((f) => idOfIndex(String(f.path ?? ''))).filter((x): x is string => !!x);
    const got = await Promise.all(ids.map(async (id) => {
      try {
        const x = await this.req(indexPath(id), { headers: { accept: 'application/json' } });
        return x.ok ? normalizeIndex(await x.json(), id) : null;
      } catch { return null; }
    }));
    return sortRecordings(got.filter((x): x is Recording => !!x));
  }

  /** The audio of one recording, checked against its SHA-256 when the browser can hash. */
  async download(rec: Recording, onProgress?: (done: number, total: number) => void): Promise<Uint8Array> {
    const out = new Uint8Array(rec.bytes);
    let at = 0;
    for (let n = 0; n < rec.parts; n++) {
      const r = await this.req(partPath(rec.id, n), { headers: { accept: 'application/json' } });
      if (!r.ok) throw new Error(`Part ${n + 1} of ${rec.parts}: axHub answered ${r.status}.`);
      const doc = (await r.json()) as { $axf?: string; n?: number; b64?: string };
      if (doc.$axf !== PART_FORMAT || doc.n !== n || typeof doc.b64 !== 'string') throw new Error(`Part ${n + 1} of ${rec.parts} is damaged or was deleted.`);
      const b = fromBase64(doc.b64);
      if (at + b.length > out.length) throw new Error('The parts are bigger than the recording.');
      out.set(b, at);
      at += b.length;
      onProgress?.(n + 1, rec.parts);
    }
    if (at !== rec.bytes) throw new Error('The parts don’t add up to the recording.');
    const sha = await sha256Hex(out);
    if (sha && rec.sha256 && sha !== rec.sha256) throw new Error('The download didn’t match axHub’s checksum.');
    return out;
  }

  /** Delete: stub every part (frees the space), then mark the index. The data server has no delete of its own. */
  async remove(rec: Recording): Promise<void> {
    const put = async (path: string, body: unknown) => {
      const r = await this.req(path, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error(`axHub refused the delete (${r.status}).`);
    };
    await put(indexPath(rec.id), { ...rec, $axf: INDEX_FORMAT, deleted: true, deletedAt: new Date().toISOString() });
    for (let n = 0; n < rec.parts; n++) await put(partPath(rec.id, n), { $axf: PART_FORMAT, id: rec.id, n, gone: true });
  }
}

export async function sha256Hex(b: Uint8Array): Promise<string> {
  const subtle = (globalThis as { crypto?: Crypto }).crypto?.subtle;
  if (!subtle) return '';
  const d = await subtle.digest('SHA-256', b as unknown as ArrayBuffer);
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/* ---------------------------------------------------------------- the recorder's state (native events → screen) */

export type UploadState = 'idle' | 'uploading' | 'offline' | 'signed-out' | 'hub-full' | 'error';
export interface RecState {
  running: boolean;
  /** start pressed, waiting for Android's prompt */
  starting: boolean;
  startedAt: string | null;
  upload: UploadState;
  message: string;
  waiting: number;
  waitingBytes: number;
  capBytes: number;
  nextTryAt: string;
  lastUploadAt: string;
  /** the last thing worth telling (a stop reason, a refusal) */
  note: string;
}
export const REC_IDLE: RecState = { running: false, starting: false, startedAt: null, upload: 'idle', message: '', waiting: 0, waitingBytes: 0, capBytes: 0, nextTryAt: '', lastUploadAt: '', note: '' };

export type NativeEvent = { state: string; [k: string]: unknown };
export type RecAction = { type: 'start' } | { type: 'status'; status: Partial<RecState> } | { type: 'native'; e: NativeEvent };

const UPLOADS: readonly UploadState[] = ['idle', 'uploading', 'offline', 'signed-out', 'hub-full', 'error'];
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const nn = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

function queueFields(e: Record<string, unknown>): Partial<RecState> {
  const out: Partial<RecState> = {};
  if ('upload' in e) out.upload = UPLOADS.includes(e.upload as UploadState) ? (e.upload as UploadState) : 'idle';
  if ('message' in e) out.message = str(e.message);
  if ('waiting' in e) out.waiting = nn(e.waiting);
  if ('waitingBytes' in e) out.waitingBytes = nn(e.waitingBytes);
  if ('capBytes' in e) out.capBytes = nn(e.capBytes);
  if ('nextTryAt' in e) out.nextTryAt = str(e.nextTryAt);
  if ('lastUploadAt' in e) out.lastUploadAt = str(e.lastUploadAt);
  return out;
}

export function recReduce(s: RecState, a: RecAction): RecState {
  if (a.type === 'start') return s.running ? s : { ...s, starting: true, note: '' };
  if (a.type === 'status') {
    const st = a.status as Record<string, unknown>;
    const running = typeof st.running === 'boolean' ? st.running : s.running;
    return { ...s, ...queueFields(st), running, starting: running ? false : s.starting, startedAt: running ? (str(st.startedAt) || s.startedAt) : null };
  }
  const e = a.e;
  switch (e.state) {
    case 'recording': return { ...s, running: true, starting: false, startedAt: str(e.startedAt) || new Date().toISOString(), note: '' };
    case 'stopped': return { ...s, running: false, starting: false, startedAt: null, note: str(e.reason) };
    case 'cancelled': return { ...s, running: false, starting: false, note: str(e.message) || 'Capture wasn’t allowed.' };
    case 'error': return { ...s, running: false, starting: false, startedAt: null, note: str(e.message) || 'The recorder stopped.' };
    case 'queue': return { ...s, ...queueFields(e) };
    case 'dropped': return { ...s, note: `The oldest unsent chunk (${str(e.id)}) was dropped: the phone’s queue was full.` };
    default: return s; // chunk, uploaded, silent: the queue event that follows carries the counts
  }
}

export const UPLOAD_LABEL: Record<UploadState, string> = {
  idle: 'Up to date', uploading: 'Sending to axHub', offline: 'Waiting for axHub', 'signed-out': 'Sign in to axHub', 'hub-full': 'axHub is full', error: 'Upload problem',
};

/* ---------------------------------------------------------------- formatting */

export function formatSize(b: number): string {
  if (!Number.isFinite(b) || b <= 0) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = b;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
}
export function formatTime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Voice phrases for AmberX's voice plugin (same seam as Audio Extract). */
export const VOICE = {
  start: ['record audio out', 'start recording phone audio', 'record what the phone plays'],
  stop: ['stop recording audio out', 'stop recording phone audio'],
  open: ['open audio recorder', 'show phone recordings'],
} as const;
