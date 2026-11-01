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
export interface Chapter { id: string; title: string; start: number; duration: number; segments: Segment[] }
export interface WalkthroughIndex {
  id: string; title: string; recordedAt: string; duration: number;
  video: string; captions: string; poster: string; chapters: Chapter[];
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
  return {
    id: text(o.id, 40) || 'walkthrough', title: text(o.title, 80) || 'Walkthrough', recordedAt: text(o.recordedAt, 40), duration,
    video: file(o.video, 'walkthrough.mp4'), captions: file(o.captions, 'walkthrough.vtt'), poster: file(o.poster, 'poster.jpg'), chapters,
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
