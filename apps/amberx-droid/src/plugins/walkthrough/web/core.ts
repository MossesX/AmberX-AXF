/**
 * walkthrough-video@1 index (what `walkthrough/assemble.mjs` writes as chapters.json and the AmberX server serves at
 * `/api/walkthrough/chapters.json`): chapters with start times, each with its scenes as indexed segments. The same shape
 * the demo.amberxai.com walkthrough player reads (title, duration, chapters[{title, start}]), plus ids so a page or a
 * Help tooltip can open one chapter (`walkthrough.open:<chapterId>`). Pure: no DOM, tested by test.mjs.
 */
export const WALKTHROUGH_FORMAT = 'walkthrough-video@1';
export const WALKTHROUGH_BASE = '/api/walkthrough/';
export const SPEEDS = [0.75, 1, 1.25, 1.5, 2] as const;

export interface Segment { start: number; title: string }
/** A file the Download button offers: the full video and its smaller copies (walkthrough-720.mp4). */
export interface Download { file: string; label: string; bytes: number }
export interface Chapter { id: string; title: string; start: number; duration: number; segments: Segment[] }
export interface WalkthroughIndex {
  id: string; title: string; recordedAt: string; duration: number;
  video: string; captions: string; poster: string; chapters: Chapter[];
  /** Landscape recording (the whole-stack one, 1920×1080) rather than a phone screen. */
  wide: boolean;
  downloads: Download[];
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max) : '');
/** Only plain file names next to chapters.json (never a path or another site). */
const file = (v: unknown, fallback: string) => (typeof v === 'string' && /^[a-z0-9][a-z0-9._-]{0,60}$/i.test(v) && !v.includes('..') ? v : fallback);

/** chapters.json made safe to show; null when it isn't a walkthrough index. Chapters are sorted by start. */
export function parseIndex(raw: unknown): WalkthroughIndex | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (o.$axf !== undefined && o.$axf !== WALKTHROUGH_FORMAT) return null;
  const chapters: Chapter[] = [];
  const ids = new Set<string>();
  for (const [i, c] of (Array.isArray(o.chapters) ? o.chapters : []).entries()) {
    if (!c || typeof c !== 'object') continue;
    const r = c as Record<string, unknown>;
    const start = num(r.start);
    const title = text(r.title, 80);
    if (start === null || !title) continue;
    let id = text(r.id, 40).toLowerCase().replace(/[^a-z0-9-]/g, '') || `chapter-${i + 1}`;
    while (ids.has(id)) id = `${id}-${i + 1}`;
    ids.add(id);
    const segments = (Array.isArray(r.segments) ? r.segments : [])
      .map((s) => (s && typeof s === 'object' ? { start: num((s as Segment).start), title: text((s as Segment).title, 120) } : null))
      .filter((s): s is Segment => !!s && s.start !== null && !!s.title)
      .slice(0, 50);
    chapters.push({ id, title, start, duration: num(r.duration) ?? 0, segments });
  }
  if (!chapters.length) return null;
  chapters.sort((a, b) => a.start - b.start);
  const last = chapters[chapters.length - 1]!;
  const duration = Math.max(num(o.duration) ?? 0, last.start + last.duration);
  chapters.forEach((c, i) => { if (!c.duration) c.duration = Math.max(0, (chapters[i + 1]?.start ?? duration) - c.start); });
  const video = file(o.video, 'walkthrough.mp4');
  const downloads: Download[] = [];
  for (const d of Array.isArray(o.downloads) ? o.downloads : []) {
    if (!d || typeof d !== 'object') continue;
    const r = d as Record<string, unknown>;
    const f = file(r.file, '');
    if (f && f.endsWith('.mp4') && !downloads.some((x) => x.file === f)) downloads.push({ file: f, label: text(r.label, 12) || f, bytes: num(r.bytes) ?? 0 });
  }
  if (!downloads.length) downloads.push({ file: video, label: 'Video', bytes: 0 });
  return {
    wide: (num(o.width) ?? 0) > (num(o.height) ?? 0), downloads,
    id: text(o.id, 40) || 'walkthrough', title: text(o.title, 80) || 'Walkthrough', recordedAt: text(o.recordedAt, 40), duration,
    video, captions: file(o.captions, 'walkthrough.vtt'), poster: file(o.poster, 'poster.jpg'), chapters,
  };
}

/** Index of the chapter playing at `t` seconds (-1 before the first). */
export function chapterAt(ix: Pick<WalkthroughIndex, 'chapters'>, t: number): number {
  let at = -1;
  ix.chapters.forEach((c, i) => { if (c.start <= t + 0.25) at = i; });
  return at;
}

/** Where Previous goes: the start of this chapter, or the one before when we're within 3 s of its start. */
export function previousStart(ix: Pick<WalkthroughIndex, 'chapters'>, t: number): number {
  const i = chapterAt(ix, t);
  if (i < 0) return 0;
  const c = ix.chapters[i]!;
  return t - c.start > 3 || i === 0 ? c.start : ix.chapters[i - 1]!.start;
}

/** Where Next goes (null at the last chapter). */
export function nextStart(ix: Pick<WalkthroughIndex, 'chapters'>, t: number): number | null {
  const c = ix.chapters[chapterAt(ix, t) + 1];
  return c ? c.start : null;
}

/** 75 → "1:15", 3725 → "1:02:05". */
export function clock(t: number): string {
  const s = Math.max(0, Math.floor(t)), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

/** A playback speed from settings, snapped to the offered ones. */
export const speedOf = (v: unknown): number => (SPEEDS as readonly number[]).includes(Number(v)) ? Number(v) : 1;

/** "1.2 GB", "380 MB" (0 → ""). */
export function sizeLabel(bytes: number): string {
  if (!bytes) return '';
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}

/* ---------------------------------------------------------------- every recorded walkthrough */

export const DEFAULT_WALKTHROUGH = 'amberx-app';
/** One row of /api/walkthrough/walkthroughs.json; `base` is its folder under WALKTHROUGH_BASE ("" for the AmberX tour). */
export interface WalkthroughEntry { id: string; title: string; duration: number; recordedAt: string; base: string }

export function parseList(raw: unknown): WalkthroughEntry[] {
  const rows = raw && typeof raw === 'object' && Array.isArray((raw as { walkthroughs?: unknown }).walkthroughs) ? (raw as { walkthroughs: unknown[] }).walkthroughs : [];
  const out: WalkthroughEntry[] = [];
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const id = text(o.id, 40);
    if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(id) || out.some((x) => x.id === id)) continue;
    out.push({ id, title: text(o.title, 80) || id, duration: num(o.duration) ?? 0, recordedAt: text(o.recordedAt, 40), base: id === DEFAULT_WALKTHROUGH ? '' : `${id}/` });
  }
  return out;
}

/* ---------------------------------------------------------------- the voice editor (walkthrough-voice@1) */

export const VOICE_FORMAT = 'walkthrough-voice@1';
/** The Piper voices the recorder can use (walkthrough/load.mjs VOICES; the AmberX server checks the same list). */
export const VOICES: readonly { id: string; label: string }[] = [
  { id: 'en_US-kristin-medium', label: 'Kristin (US, Amber\'s own)' }, { id: 'en_US-amy-medium', label: 'Amy (US)' },
  { id: 'en_US-lessac-medium', label: 'Lessac (US)' }, { id: 'en_US-hfc_female-medium', label: 'HFC female (US)' },
  { id: 'en_US-ljspeech-medium', label: 'LJ Speech (US)' }, { id: 'en_US-ryan-medium', label: 'Ryan (US)' },
  { id: 'en_US-joe-medium', label: 'Joe (US)' }, { id: 'en_US-hfc_male-medium', label: 'HFC male (US)' },
  { id: 'en_GB-alba-medium', label: 'Alba (Scottish)' }, { id: 'en_GB-jenny_dioco-medium', label: 'Jenny (British)' },
];
export const SPEED_RANGE = { min: 0.75, max: 1.3, step: 0.05 } as const;
export const MAX_LINE = 400;

export interface ScriptScene { key: string; say: string }
export interface ScriptChapter { id: string; title: string; scenes: ScriptScene[] }
/** script.json: every scene's words as written, the voice and speed in use, and the edits it was voiced with. */
export interface ScriptDoc { id: string; voice: string; speed: number; chapters: ScriptChapter[]; edits: Edits }
/** What the editor saves (on axHub) and sends with a re-voice: only what differs from the script. */
export interface Edits { voice: string | null; speed: number | null; lines: Record<string, string> }

const KEY = /^[a-z0-9][a-z0-9-]{0,40}-\d{1,3}$/;
const line = (v: unknown) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_LINE) : '');

/** Edits made safe: a known voice, a speed in range, plain-text lines with scene keys. */
export function normalizeEdits(raw: unknown): Edits {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const lines: Record<string, string> = {};
  const src = o.lines && typeof o.lines === 'object' && !Array.isArray(o.lines) ? (o.lines as Record<string, unknown>) : {};
  for (const [k, v] of Object.entries(src).slice(0, 600)) { const t = line(v); if (KEY.test(k) && t) lines[k] = t; }
  const sp = Number(o.speed);
  return {
    voice: typeof o.voice === 'string' && VOICES.some((x) => x.id === o.voice) ? o.voice : null,
    speed: o.speed !== null && o.speed !== undefined && Number.isFinite(sp) && sp >= SPEED_RANGE.min && sp <= SPEED_RANGE.max ? Math.round(sp * 100) / 100 : null,
    lines,
  };
}

export function parseScript(raw: unknown): ScriptDoc | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const chapters: ScriptChapter[] = [];
  for (const c of Array.isArray(o.chapters) ? o.chapters : []) {
    if (!c || typeof c !== 'object') continue;
    const r = c as Record<string, unknown>;
    const scenes = (Array.isArray(r.scenes) ? r.scenes : [])
      .map((x) => (x && typeof x === 'object' ? { key: text((x as ScriptScene).key, 50), say: line((x as ScriptScene).say) } : null))
      .filter((x): x is ScriptScene => !!x && KEY.test(x.key) && !!x.say);
    const id = text(r.id, 41);
    if (id && scenes.length) chapters.push({ id, title: text(r.title, 80) || id, scenes });
  }
  if (!chapters.length) return null;
  const sp = num(o.speed);
  return { id: text(o.id, 40), voice: text(o.voice, 60), speed: sp && sp > 0 ? sp : 1, chapters, edits: normalizeEdits(o.edits) };
}

/** The edits a draft amounts to: lines that differ from the script, and voice / speed only when they differ. */
export function editsOf(script: ScriptDoc, voice: string, speed: number, drafts: Record<string, string>): Edits {
  const base = new Map(script.chapters.flatMap((c) => c.scenes.map((x) => [x.key, x.say] as const)));
  const lines: Record<string, string> = {};
  for (const [k, v] of Object.entries(drafts)) { const t = line(v); if (base.has(k) && t && t !== base.get(k)) lines[k] = t; }
  return normalizeEdits({ voice: voice !== script.voice ? voice : null, speed: Math.abs(speed - script.speed) > 0.001 ? speed : null, lines });
}

/** How many changes an edit set holds (lines + voice + speed), for the button labels. */
export const editCount = (e: Edits) => Object.keys(e.lines).length + (e.voice ? 1 : 0) + (e.speed !== null ? 1 : 0);
