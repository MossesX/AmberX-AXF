/**
 * The compiler: one walkthrough project → one timeline (walkthrough-timeline@1).
 *
 * Pieces are laid end to end in outline order, with a chapter card before each top-level section and a gap between
 * pieces. Each piece's narration is split into caption lines timed at the project's speaking rate; its cues are spread
 * across the narration so the cursor acts while the narrator talks. Every piece is hashed: a recompile reuses the
 * segment of any piece whose inputs didn't change (only its start time moves), so swapping pieces around is instant.
 * Exports: timeline JSON, SRT, WebVTT, narration script, shot list (CSV), edit decision list and a Claude production brief.
 */
import { estimateSec, fmtDur, narrationSec, orderedPieces, pathOf, pieceHash, pieceTarget, piecesUnder, type Cue, type Piece, type Project } from './model';

export interface Line { start: number; end: number; text: string }
export interface TimedCue extends Cue { start: number }
export interface Segment {
  kind: 'title' | 'chapter' | 'piece';
  id: string;
  pieceId?: string;
  title: string;
  path: string[];
  start: number;
  end: number;
  url: string;
  transition: string;
  lines: Line[];
  cues: TimedCue[];
  hash?: string;
  reused?: boolean;
  status?: Piece['status'];
}
export interface Compiled {
  $format: 'walkthrough-timeline@1';
  at: string;
  project: { id: string; name: string };
  durationSec: number;
  targetSec: number;
  segments: Segment[];
  chapters: { title: string; start: number }[];
  hashes: Record<string, string>;
  reused: number;
  rebuilt: number;
  skipped: { id: string; title: string; why: string }[];
  warnings: string[];
}

const sentences = (s: string) => s.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+(?=[A-Z0-9])/).filter(Boolean);

/** lay a piece out from t=0: caption lines + cues spread over the narration */
function layoutPiece(p: Piece, prj: Project): { dur: number; lines: Line[]; cues: TimedCue[] } {
  const s = prj.settings;
  const total = narrationSec(p, s);
  const lines: Line[] = [];
  let t = 0;
  const parts = sentences(p.narration);
  const wordsAll = Math.max(1, p.narration.trim().split(/\s+/).length);
  for (const text of parts) {
    const d = (text.split(/\s+/).length / wordsAll) * total;
    // long sentences become two caption lines
    if (text.length > 90) {
      const mid = text.lastIndexOf(' ', Math.floor(text.length / 2));
      lines.push({ start: t, end: t + d / 2, text: text.slice(0, mid) }, { start: t + d / 2, end: t + d, text: text.slice(mid + 1) });
    } else lines.push({ start: t, end: t + d, text });
    t += d;
  }
  const cueTotal = p.cues.reduce((a, c) => a + c.dur, 0);
  const dur = Math.max(total, cueTotal, p.clipSec, p.narration ? 0 : (pieceTarget(p, s) || estimateSec(p, s)));
  // spread: the slack between cues when narration is longer than the cue track
  const slack = p.cues.length ? Math.max(0, dur - cueTotal) / (p.cues.length + 1) : 0;
  let c = slack;
  const cues = p.cues.map((cu) => { const out = { ...cu, start: c }; c += cu.dur + slack; return out; });
  return { dur: Math.max(dur, 1), lines, cues };
}

export function compile(prj: Project, prev?: Record<string, string>): Compiled {
  const s = prj.settings;
  const segments: Segment[] = [];
  const chapters: Compiled['chapters'] = [];
  const hashes: Record<string, string> = {};
  const skipped: Compiled['skipped'] = [];
  const warnings: string[] = [];
  let t = 0, reused = 0, rebuilt = 0;

  if (s.chapterCards) {
    segments.push({ kind: 'title', id: 'title', title: prj.name, path: [], start: 0, end: 4, url: '', transition: s.transition, lines: [{ start: 0, end: 4, text: prj.name }], cues: [] });
    t = 4;
  }
  const topOf = new Map<string, string>();
  for (const sec of prj.root.children) for (const id of piecesUnder(sec)) topOf.set(id, sec.id);
  let lastTop = '';

  for (const p of orderedPieces(prj)) {
    if (s.skipStatuses.includes(p.status)) { skipped.push({ id: p.id, title: p.title, why: `status ${p.status}` }); continue; }
    const top = topOf.get(p.id) ?? '';
    if (s.chapterCards && top && top !== lastTop) {
      const sec = prj.root.children.find((x) => x.id === top)!;
      chapters.push({ title: sec.title, start: t });
      segments.push({ kind: 'chapter', id: `ch-${sec.id}`, title: sec.title, path: [sec.title], start: t, end: t + 3, url: '', transition: s.transition, lines: [{ start: t, end: t + 3, text: sec.title }], cues: [] });
      t += 3;
    }
    lastTop = top;
    const h = pieceHash(p, s);
    hashes[p.id] = h;
    const same = prev?.[p.id] === h;
    same ? reused++ : rebuilt++;
    const lay = layoutPiece(p, prj);
    const shift = <T extends { start: number }>(x: T & { end?: number }) => ({ ...x, start: x.start + t, ...(x.end != null ? { end: x.end + t } : {}) });
    segments.push({ kind: 'piece', id: `seg-${p.id}`, pieceId: p.id, title: p.title, path: pathOf(prj.root, p.id).map((x) => x.title), start: t, end: t + lay.dur, url: p.url, transition: s.transition, lines: lay.lines.map(shift), cues: lay.cues.map(shift), hash: h, reused: same, status: p.status });
    if (!p.narration.trim()) warnings.push(`"${p.title}" has no narration yet.`);
    if (p.status === 'failed') warnings.push(`"${p.title}" is marked failed and is still in the video.`);
    const tgt = pieceTarget(p, s);
    if (tgt && lay.dur > tgt * 1.25) warnings.push(`"${p.title}" runs ${fmtDur(lay.dur)}, over its ${fmtDur(tgt)} target.`);
    t += lay.dur + s.gapSec;
  }
  if (s.targetSec && t > s.targetSec) warnings.push(`The video runs ${fmtDur(t)}, over the ${fmtDur(s.targetSec)} target by ${fmtDur(t - s.targetSec)}.`);
  return { $format: 'walkthrough-timeline@1', at: new Date().toISOString(), project: { id: prj.id, name: prj.name }, durationSec: t, targetSec: s.targetSec, segments, chapters, hashes, reused, rebuilt, skipped, warnings };
}

/** the segment and line playing at time t */
export function at(c: Compiled, t: number): { seg: Segment | null; line: Line | null; cue: TimedCue | null } {
  const seg = c.segments.find((x) => t >= x.start && t < x.end) ?? null;
  const line = seg?.lines.find((l) => t >= l.start && t < l.end) ?? null;
  const cue = seg ? [...seg.cues].reverse().find((q) => t >= q.start) ?? null : null;
  return { seg, line, cue };
}

/* ---------- exports ---------- */

const stamp = (sec: number, sep: ',' | '.') => {
  const ms = Math.round(sec * 1000);
  const h = Math.floor(ms / 3_600_000), m = Math.floor((ms % 3_600_000) / 60_000), s = Math.floor((ms % 60_000) / 1000), r = ms % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}${sep}${String(r).padStart(3, '0')}`;
};
const allLines = (c: Compiled) => c.segments.flatMap((s) => s.lines);

export function toSrt(c: Compiled): string {
  return allLines(c).map((l, i) => `${i + 1}\n${stamp(l.start, ',')} --> ${stamp(l.end, ',')}\n${l.text}\n`).join('\n');
}
export function toVtt(c: Compiled): string {
  return `WEBVTT\n\n${allLines(c).map((l) => `${stamp(l.start, '.')} --> ${stamp(l.end, '.')}\n${l.text}\n`).join('\n')}`;
}
export function toScript(c: Compiled, prj: Project): string {
  const out = [`# ${prj.name}`, '', prj.description, '', `Length ${fmtDur(c.durationSec)}${c.targetSec ? ` (target ${fmtDur(c.targetSec)})` : ''} · ${c.segments.filter((s) => s.kind === 'piece').length} pieces`, ''];
  for (const s of c.segments) {
    if (s.kind === 'chapter') { out.push(`## ${s.title}`, ''); continue; }
    if (s.kind !== 'piece') continue;
    const p = prj.pieces[s.pieceId!];
    out.push(`### ${fmtDur(s.start)} — ${s.title}`, '', p?.narration ?? '', '');
    if (p?.effect) out.push(`> Show: ${p.effect}`, '');
    if (s.cues.length) out.push(...s.cues.map((q) => `- ${fmtDur(q.start)} ${q.kind}${q.target ? ` **${q.target}**` : ''}${q.text ? ` “${q.text}”` : ''}`), '');
  }
  return out.join('\n');
}
export function toShotList(c: Compiled): string {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  return ['start,end,length,kind,title,section,url,cues', ...c.segments.map((s) => [fmtDur(s.start), fmtDur(s.end), (s.end - s.start).toFixed(1), s.kind, esc(s.title), esc(s.path.join(' / ')), esc(s.url), s.cues.length].join(','))].join('\n');
}
/** a CMX3600-style edit decision list, one event per segment, for an editor that assembles the recorded clips */
export function toEdl(c: Compiled, fps = 30): string {
  const tc = (sec: number) => { const f = Math.round(sec * fps); const ff = f % fps, s = Math.floor(f / fps); return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}:${String(ff).padStart(2, '0')}`; };
  const rows = c.segments.map((s, i) => `${String(i + 1).padStart(3, '0')}  ${(s.pieceId ?? s.kind).slice(0, 8).toUpperCase().padEnd(8)} V     ${s.transition === 'cut' ? 'C   ' : 'D 15'} ${tc(0)} ${tc(s.end - s.start)} ${tc(s.start)} ${tc(s.end)}\n* FROM CLIP NAME: ${s.title}`);
  return [`TITLE: ${c.project.name}`, 'FCM: NON-DROP FRAME', '', ...rows].join('\n');
}
/** the brief Claude gets to produce (or process) the video from this plan */
export function toClaudeBrief(c: Compiled, prj: Project): string {
  return [
    `You are producing a narrated screen walkthrough video: "${prj.name}".`,
    `Target length: ${c.targetSec ? fmtDur(c.targetSec) : 'no limit'}; compiled plan length: ${fmtDur(c.durationSec)}. Resolution ${prj.settings.resolution} at ${prj.settings.fps} fps, ${prj.settings.transition} transitions, captions ${prj.settings.captions ? 'on' : 'off'}.`,
    'For each segment below: open the URL, perform the cues at the given times with a visible cursor (click ripples on), and record the narration line by line. Keep each segment\'s length within 10% unless the narration needs more. Report back JSON {segments:[{id, clipSec, status, notes}]} so the plan can be updated.',
    '',
    JSON.stringify({ segments: c.segments.map((s) => ({ id: s.id, kind: s.kind, title: s.title, start: +s.start.toFixed(2), end: +s.end.toFixed(2), url: s.url, narration: s.lines.map((l) => l.text).join(' '), cues: s.cues.map((q) => ({ at: +q.start.toFixed(2), kind: q.kind, target: q.target, text: q.text })) })) }, null, 1),
  ].join('\n');
}
