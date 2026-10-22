/**
 * walkthrough-project@1 — the data model of a narrated walkthrough video.
 *
 * A project is one video. Its outline is a tree of sections; pieces (clips) hang off sections. Every piece carries its
 * narration, its cue track (what the cursor does on screen while the narration plays), its status and lengths. The
 * compiler (compiler.ts) turns the tree, in order, into one timeline; swapping pieces around and recompiling only redoes
 * what changed. Everything here is pure: no React, no storage, no DOM.
 */

export const PROJECT_FORMAT = 'walkthrough-project@1';

export type PieceStatus = 'planned' | 'built' | 'partial' | 'failed' | 'skipped' | 'review';
export const STATUSES: { id: PieceStatus; label: string; tone: 'muted' | 'success' | 'accent' | 'danger' | 'warning' | 'info'; icon: string }[] = [
  { id: 'planned', label: 'Planned', tone: 'muted', icon: 'clock' },
  { id: 'built', label: 'Built', tone: 'success', icon: 'check-circle' },
  { id: 'partial', label: 'Partial', tone: 'accent', icon: 'minus' },
  { id: 'failed', label: 'Failed', tone: 'danger', icon: 'x-circle' },
  { id: 'skipped', label: 'Skipped', tone: 'info', icon: 'arrow-right' },
  { id: 'review', label: 'Needs review', tone: 'warning', icon: 'eye' },
];
export const statusInfo = (s: PieceStatus) => STATUSES.find((x) => x.id === s) ?? STATUSES[0]!;

/** What a piece is about; an open set (any string works), these get labels and icons. */
export const KINDS: Record<string, { label: string; icon: string }> = {
  intro: { label: 'Intro', icon: 'play' },
  concept: { label: 'Concept', icon: 'info' },
  engine: { label: 'Engine', icon: 'zap' },
  setting: { label: 'Setting', icon: 'sliders' },
  switch: { label: 'Switch', icon: 'check' },
  workflow: { label: 'Workflow', icon: 'branch' },
  dataflow: { label: 'Data flow', icon: 'cloud' },
  actionflow: { label: 'Action flow', icon: 'arrow-right' },
  plugin: { label: 'Plugin', icon: 'package' },
  integration: { label: 'Integration', icon: 'external' },
  security: { label: 'Security', icon: 'shield' },
  cli: { label: 'CLI', icon: 'terminal' },
  demo: { label: 'Demo', icon: 'monitor' },
  outro: { label: 'Outro', icon: 'star' },
};
export const kindInfo = (k: string) => KINDS[k] ?? { label: k || 'Other', icon: 'box' };

/** One step of the on-screen action while the narration plays. `at` = seconds from the start of the piece. */
export type CueKind = 'move' | 'click' | 'type' | 'scroll' | 'wait' | 'highlight' | 'navigate' | 'say' | 'key';
export const CUE_KINDS: { id: CueKind; label: string; icon: string; defaultDur: number }[] = [
  { id: 'navigate', label: 'Open page', icon: 'external', defaultDur: 1.5 },
  { id: 'move', label: 'Move cursor', icon: 'arrow-right', defaultDur: 0.8 },
  { id: 'click', label: 'Click', icon: 'check', defaultDur: 0.4 },
  { id: 'type', label: 'Type text', icon: 'keyboard', defaultDur: 1.5 },
  { id: 'key', label: 'Press key', icon: 'keyboard', defaultDur: 0.3 },
  { id: 'scroll', label: 'Scroll', icon: 'chevron-down', defaultDur: 0.8 },
  { id: 'highlight', label: 'Highlight', icon: 'star', defaultDur: 1.5 },
  { id: 'wait', label: 'Wait', icon: 'clock', defaultDur: 1 },
  { id: 'say', label: 'Caption', icon: 'type', defaultDur: 2 },
];
export interface Cue {
  id: string;
  kind: CueKind;
  /** a CSS selector or a description of what to point at ("Settings → Appearance → Spacing") */
  target?: string;
  /** typed text, a URL to open, a key, or the caption */
  text?: string;
  /** cursor position as fractions of the stage (0..1) when known (recordings fill these) */
  x?: number;
  y?: number;
  /** seconds */
  dur: number;
}

export interface Piece {
  id: string;
  title: string;
  kind: string;
  status: PieceStatus;
  /** 0..100; `null` = worked out from what the piece has (autoProgress) */
  progress: number | null;
  /** what the narrator says */
  narration: string;
  cues: Cue[];
  /** the page shown while it plays */
  url: string;
  /** desired length in seconds; 0 = the project's default piece length */
  targetSec: number;
  /** length of the recorded clip in seconds (0 = nothing recorded yet) */
  clipSec: number;
  recordingId?: string;
  tags: string[];
  notes: string;
  /** a concrete example of the effect to show ("switch Spacing to Regular: every row grows") */
  effect?: string;
  updatedAt: string;
}

export interface Section {
  id: string;
  title: string;
  icon?: string;
  /** collapsed in the index / grid */
  collapsed?: boolean;
  children: Section[];
  /** piece ids, in order */
  pieces: string[];
}

export interface ProjectSettings {
  /** desired total length in seconds; 0 = no limit */
  targetSec: number;
  /** default desired length of one piece in seconds; 0 = no limit */
  pieceTargetSec: number;
  /** narration speed, words per minute */
  wpm: number;
  voice: string;
  rate: number;
  pitch: number;
  /** pause between pieces, seconds */
  gapSec: number;
  transition: 'cut' | 'fade' | 'slide' | 'zoom';
  captions: boolean;
  /** an intro card + chapter cards between top-level sections */
  chapterCards: boolean;
  resolution: '1280x720' | '1920x1080' | '1080x1920' | '2560x1440';
  fps: 24 | 30 | 60;
  cursor: 'arrow' | 'dot' | 'ring';
  clickRipple: boolean;
  /** pieces with these statuses are left out of the compiled video */
  skipStatuses: PieceStatus[];
}

export const DEFAULT_SETTINGS: ProjectSettings = {
  targetSec: 0,
  pieceTargetSec: 45,
  wpm: 150,
  voice: '',
  rate: 1,
  pitch: 1,
  gapSec: 0.6,
  transition: 'fade',
  captions: true,
  chapterCards: true,
  resolution: '1920x1080',
  fps: 30,
  cursor: 'arrow',
  clickRipple: true,
  skipStatuses: ['skipped'],
};

export interface Recording {
  id: string;
  name: string;
  url: string;
  createdAt: string;
  /** seconds */
  duration: number;
  /** pointer / key events, `t` = seconds from start, x/y = fractions of the stage */
  events: RecEvent[];
  /** a captured screen video kept on this device (IndexedDB key), when one was made */
  videoKey?: string;
  pieceId?: string;
  /** what Claude made of it (narration + cues), pasted back or returned */
  processed?: { at: string; narration?: string; cues?: Cue[] };
}
export interface RecEvent { t: number; type: 'move' | 'down' | 'up' | 'click' | 'key' | 'scroll' | 'nav' | 'mark'; x?: number; y?: number; key?: string; text?: string; target?: string }

export interface TrashEntry { at: string; kind: 'piece' | 'section'; piece?: Piece; section?: Section; pieces?: Piece[]; parentId: string; index: number }

export interface Project {
  $format: typeof PROJECT_FORMAT;
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  settings: ProjectSettings;
  root: Section;
  pieces: Record<string, Piece>;
  recordings: Recording[];
  trash: TrashEntry[];
  /** the last compile, for incremental recompiles: piece id → hash of what went in */
  compiled?: { at: string; hashes: Record<string, string>; durationSec: number };
}

/* ---------- ids + small helpers ---------- */

let seq = 0;
export const uid = (p = 'x') => `${p}-${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
export const now = () => new Date().toISOString();

export function newPiece(over: Partial<Piece> = {}): Piece {
  return { id: uid('p'), title: 'New piece', kind: 'concept', status: 'planned', progress: null, narration: '', cues: [], url: '', targetSec: 0, clipSec: 0, tags: [], notes: '', updatedAt: now(), ...over };
}
export function newSection(title = 'New section', over: Partial<Section> = {}): Section {
  return { id: uid('s'), title, children: [], pieces: [], ...over };
}
export function newProject(name = 'Untitled walkthrough'): Project {
  return { $format: PROJECT_FORMAT, id: uid('prj'), name, description: '', createdAt: now(), updatedAt: now(), settings: { ...DEFAULT_SETTINGS }, root: newSection(name, { id: 'root' }), pieces: {}, recordings: [], trash: [] };
}

/* ---------- lengths ---------- */

export const words = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);
/** seconds the narration takes at the project's speed */
export const narrationSec = (p: Piece, s: ProjectSettings) => (words(p.narration) / Math.max(60, s.wpm)) * 60 / Math.max(0.5, s.rate);
export const cueSec = (p: Piece) => p.cues.reduce((a, c) => a + (c.dur || 0), 0);
/** expected length: the recorded clip when there is one, else the longer of narration and cues, else the target */
export function estimateSec(p: Piece, s: ProjectSettings): number {
  if (p.clipSec > 0) return p.clipSec;
  const n = Math.max(narrationSec(p, s), cueSec(p));
  if (n > 0) return n;
  return p.targetSec || s.pieceTargetSec || 30;
}
export const pieceTarget = (p: Piece, s: ProjectSettings) => p.targetSec || s.pieceTargetSec || 0;

/** progress when not set by hand: narration 35, cues 20, recording 35, built 10 (built = 100, failed/skipped keep theirs) */
export function autoProgress(p: Piece): number {
  if (p.progress != null) return p.progress;
  if (p.status === 'built') return 100;
  let v = 0;
  if (p.narration.trim()) v += 35;
  if (p.cues.length) v += 20;
  if (p.clipSec > 0 || p.recordingId) v += 35;
  if (p.status === 'review') v = Math.max(v, 80);
  return Math.min(99, v);
}

export function fmtDur(sec: number): string {
  if (!isFinite(sec) || sec <= 0) return '0:00';
  const s = Math.round(sec);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}
/** "1:30", "90", "1m30s", "2h", "45s" → seconds; "" or "none"/"no limit" → 0 */
export function parseDur(t: string): number {
  const s = t.trim().toLowerCase();
  if (!s || s === 'none' || s === 'no limit' || s === '0') return 0;
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  if (s.includes(':')) return s.split(':').map(Number).reduce((a, n) => a * 60 + (n || 0), 0);
  let total = 0;
  for (const m of s.matchAll(/(\d+(?:\.\d+)?)\s*(h|m|s)/g)) total += Number(m[1]) * (m[2] === 'h' ? 3600 : m[2] === 'm' ? 60 : 1);
  return total;
}

/* ---------- tree ---------- */

export function walkSections(root: Section, fn: (s: Section, depth: number, parent: Section | null) => void, depth = 0, parent: Section | null = null) {
  fn(root, depth, parent);
  for (const c of root.children) walkSections(c, fn, depth + 1, root);
}
export function findSection(root: Section, id: string): Section | null {
  let hit: Section | null = null;
  walkSections(root, (s) => { if (s.id === id) hit = s; });
  return hit;
}
export function parentOf(root: Section, id: string): Section | null {
  let hit: Section | null = null;
  walkSections(root, (s) => { if (s.children.some((c) => c.id === id)) hit = s; });
  return hit;
}
export function sectionOfPiece(root: Section, pid: string): Section | null {
  let hit: Section | null = null;
  walkSections(root, (s) => { if (s.pieces.includes(pid)) hit = s; });
  return hit;
}
/** every piece id under a section, in play order (own pieces first, then sub-sections) */
export function piecesUnder(s: Section): string[] {
  return [...s.pieces, ...s.children.flatMap(piecesUnder)];
}
export function orderedPieces(p: Project): Piece[] {
  return piecesUnder(p.root).map((id) => p.pieces[id]).filter((x): x is Piece => !!x);
}
/** the section path (titles) of a piece, root excluded */
export function pathOf(root: Section, pid: string): Section[] {
  const out: Section[] = [];
  const go = (s: Section, trail: Section[]): boolean => {
    if (s.pieces.includes(pid)) { out.push(...trail, s); return true; }
    return s.children.some((c) => go(c, [...trail, s]));
  };
  go(root, []);
  return out.slice(1);
}
const isInside = (root: Section, ancestorId: string, id: string) => { const a = findSection(root, ancestorId); return !!a && !!findSection(a, id); };

export interface Totals { pieces: number; est: number; clip: number; target: number; progress: number; byStatus: Record<PieceStatus, number> }
export function totals(p: Project, s: Section = p.root): Totals {
  const ids = piecesUnder(s);
  const byStatus = Object.fromEntries(STATUSES.map((x) => [x.id, 0])) as Record<PieceStatus, number>;
  let est = 0, clip = 0, target = 0, prog = 0;
  for (const id of ids) {
    const pc = p.pieces[id]; if (!pc) continue;
    byStatus[pc.status]++;
    est += estimateSec(pc, p.settings); clip += pc.clipSec; target += pieceTarget(pc, p.settings); prog += autoProgress(pc);
  }
  return { pieces: ids.length, est, clip, target, progress: ids.length ? prog / ids.length : 0, byStatus };
}

/* ---------- edits (pure: each returns a new project) ---------- */

const clone = <T,>(x: T): T => structuredClone(x);
const touch = (p: Project): Project => ({ ...p, updatedAt: now() });

export function updatePiece(p: Project, id: string, patch: Partial<Piece>): Project {
  const cur = p.pieces[id]; if (!cur) return p;
  return touch({ ...p, pieces: { ...p.pieces, [id]: { ...cur, ...patch, updatedAt: now() } } });
}
export function updateSection(p: Project, id: string, patch: Partial<Section>): Project {
  const q = clone(p); const s = findSection(q.root, id); if (!s) return p;
  Object.assign(s, patch); return touch(q);
}
export function addPiece(p: Project, sectionId: string, piece: Piece, index?: number): Project {
  const q = clone(p); const s = findSection(q.root, sectionId) ?? q.root;
  q.pieces[piece.id] = piece; s.pieces.splice(index ?? s.pieces.length, 0, piece.id); return touch(q);
}
export function addSection(p: Project, parentId: string, sec: Section, index?: number): Project {
  const q = clone(p); const s = findSection(q.root, parentId) ?? q.root;
  s.children.splice(index ?? s.children.length, 0, sec); return touch(q);
}

export type DropPos = 'before' | 'after' | 'inside';
export interface DragItem { kind: 'piece' | 'section'; id: string }

/** move a piece or section next to (or into) another piece or section; refuses moves into itself */
export function moveItem(p: Project, item: DragItem, target: DragItem, pos: DropPos): Project {
  if (item.id === target.id) return p;
  const q = clone(p);
  if (item.kind === 'section' && (item.id === 'root' || (target.kind === 'section' && isInside(q.root, item.id, target.id)))) return p;
  // take it out
  let moving: Section | null = null;
  if (item.kind === 'piece') { const from = sectionOfPiece(q.root, item.id); if (!from) return p; from.pieces = from.pieces.filter((x) => x !== item.id); }
  else { const par = parentOf(q.root, item.id); if (!par) return p; moving = par.children.find((c) => c.id === item.id) ?? null; par.children = par.children.filter((c) => c.id !== item.id); }
  // put it in
  if (target.kind === 'section') {
    const t = findSection(q.root, target.id); if (!t) return p;
    if (pos === 'inside' || target.id === 'root') {
      if (item.kind === 'piece') t.pieces.push(item.id); else t.children.push(moving!);
      t.collapsed = false;
    } else {
      const par = parentOf(q.root, target.id) ?? q.root;
      if (item.kind === 'piece') { par.pieces.push(item.id); }
      else { const i = par.children.findIndex((c) => c.id === target.id); par.children.splice(pos === 'before' ? i : i + 1, 0, moving!); }
    }
  } else {
    const t = sectionOfPiece(q.root, target.id); if (!t) return p;
    if (item.kind === 'piece') { const i = t.pieces.indexOf(target.id); t.pieces.splice(pos === 'before' ? i : i + 1, 0, item.id); }
    else t.children.unshift(moving!);
  }
  return touch(q);
}

/** delete into the project's trash (restorable) */
export function trashItem(p: Project, item: DragItem): Project {
  const q = clone(p);
  if (item.kind === 'piece') {
    const from = sectionOfPiece(q.root, item.id); const piece = q.pieces[item.id]; if (!from || !piece) return p;
    const index = from.pieces.indexOf(item.id); from.pieces.splice(index, 1); delete q.pieces[item.id];
    q.trash = [{ at: now(), kind: 'piece' as const, piece, parentId: from.id, index }, ...q.trash].slice(0, 200);
  } else {
    if (item.id === 'root') return p;
    const par = parentOf(q.root, item.id); if (!par) return p;
    const index = par.children.findIndex((c) => c.id === item.id); const [sec] = par.children.splice(index, 1);
    const ids = piecesUnder(sec!); const pieces = ids.map((id) => q.pieces[id]!).filter(Boolean); ids.forEach((id) => delete q.pieces[id]);
    q.trash = [{ at: now(), kind: 'section' as const, section: sec, pieces, parentId: par.id, index }, ...q.trash].slice(0, 200);
  }
  return touch(q);
}
export function restoreTrash(p: Project, at: number): Project {
  const q = clone(p); const e = q.trash[at]; if (!e) return p;
  const par = findSection(q.root, e.parentId) ?? q.root;
  if (e.kind === 'piece' && e.piece) { q.pieces[e.piece.id] = e.piece; par.pieces.splice(Math.min(e.index, par.pieces.length), 0, e.piece.id); }
  if (e.kind === 'section' && e.section) { for (const pc of e.pieces ?? []) q.pieces[pc.id] = pc; par.children.splice(Math.min(e.index, par.children.length), 0, e.section); }
  q.trash.splice(at, 1);
  return touch(q);
}

/** a deep copy with fresh ids (duplicate project / piece / section) */
export function duplicateProject(p: Project): Project {
  const q = clone(p); q.id = uid('prj'); q.name = `${p.name} copy`; q.createdAt = q.updatedAt = now(); delete q.compiled; return q;
}
export function duplicatePiece(p: Project, id: string): Project {
  const src = p.pieces[id]; const sec = sectionOfPiece(p.root, id); if (!src || !sec) return p;
  const copy = { ...clone(src), id: uid('p'), title: `${src.title} (copy)`, updatedAt: now() };
  return addPiece(p, sec.id, copy, sec.pieces.indexOf(id) + 1);
}
export function duplicateSection(p: Project, id: string): Project {
  const q = clone(p); const par = parentOf(q.root, id); const src = findSection(q.root, id); if (!par || !src) return p;
  const copy = (s: Section): Section => ({ ...s, id: uid('s'), children: s.children.map(copy), pieces: s.pieces.map((pid) => { const n = { ...clone(q.pieces[pid]!), id: uid('p') }; q.pieces[n.id] = n; return n.id; }) });
  const c = copy(src); c.title = `${src.title} (copy)`;
  par.children.splice(par.children.indexOf(src) + 1, 0, c);
  return touch(q);
}

/** a stable hash of everything that goes into a piece's compiled segment */
export function pieceHash(pc: Piece, s: ProjectSettings): string {
  const str = JSON.stringify([pc.title, pc.narration, pc.cues, pc.url, pc.clipSec, pc.recordingId, pc.status, s.wpm, s.rate, s.voice, s.transition]);
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

/** checks a loaded / imported project, filling anything missing; throws on something that isn't one */
export function normalizeProject(raw: unknown): Project {
  const r = raw as Partial<Project>;
  if (!r || typeof r !== 'object' || !r.root || !r.pieces) throw new Error('Not a walkthrough project (walkthrough-project@1).');
  const fix = (s: Section): Section => ({ id: String(s.id || uid('s')), title: String(s.title ?? 'Section'), icon: s.icon, collapsed: !!s.collapsed, children: (s.children ?? []).map(fix), pieces: (s.pieces ?? []).map(String) });
  const pieces: Record<string, Piece> = {};
  for (const [k, v] of Object.entries(r.pieces)) pieces[k] = { ...newPiece(), ...(v as Piece), id: k, cues: ((v as Piece).cues ?? []).map((c) => ({ ...c, id: c.id || uid('c'), dur: Number(c.dur) || 0 })) };
  const root = fix(r.root as Section);
  root.id = 'root';
  walkSections(root, (s) => { s.pieces = s.pieces.filter((id) => pieces[id]); });
  return { $format: PROJECT_FORMAT, id: String(r.id || uid('prj')), name: String(r.name || 'Walkthrough'), description: String(r.description ?? ''), createdAt: r.createdAt || now(), updatedAt: r.updatedAt || now(), settings: { ...DEFAULT_SETTINGS, ...(r.settings ?? {}) }, root, pieces, recordings: r.recordings ?? [], trash: r.trash ?? [], compiled: r.compiled };
}
