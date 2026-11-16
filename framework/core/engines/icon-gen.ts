/**
 * Icon generator (icon-gen@1, spec/ICON-MAP.md). Deterministic: the same seed, hints and style always give the same
 * path data, so spec/fixtures/icon-gen.json holds across ports. Pure, no DOM, no randomness beyond the seeded PRNG.
 *
 * A glyph is built from a small shape grammar on a 24 grid: one to three primitives (ring, square, diamond, triangle,
 * bars, dots, arc, chevron, cross, polygon, star, slash, check), each placed, sized and mirrored by the seed, under a
 * symmetry (none, mirror-x, mirror-y, radial). The glyph name steers the grammar where the name says what it is
 * (`chevron-right` → a chevron, `search` → a ring with a handle, `plus` → a cross …), so a generated pack stays
 * legible; everything else is a seeded abstract mark. Output is path commands only (M L A Q Z and numbers; no colours,
 * no transforms): the pack's style decides stroke / fill / duotone, and colour is always currentColor.
 *
 *   generateIcon(seed, hints)              one glyph `{ d, secondary, fill, recipe }`
 *   generatePack(seed, names, options)     an icon-pack@1 asset data block with a glyph per name (and per spot)
 *   seedHash(text)                         the 32-bit hash a seed string becomes (for fixtures and the designer)
 */
import { GEN_STYLES, type GenStyle } from './icon-rules.mjs';

export const ICON_GEN_CONTRACT = 'icon-gen@1';
export const ICON_GEN_GRID = 24;
export { GEN_STYLES };
export type { GenStyle };

/* ---------------------------------------------------------------- seeded randomness */

/** FNV-1a 32-bit of a string (deterministic across runtimes). */
export function seedHash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

/** mulberry32: small, fast, well distributed, identical everywhere. */
export class SeededRng {
  private s: number;
  constructor(seed: number | string) { this.s = (typeof seed === 'number' ? seed : seedHash(seed)) >>> 0 || 1; }
  next(): number { let t = (this.s = (this.s + 0x6d2b79f5) >>> 0); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
  int(lo: number, hi: number): number { return lo + Math.floor(this.next() * (hi - lo + 1)); }
  pick<T>(list: readonly T[]): T { return list[Math.floor(this.next() * list.length)]; }
  chance(p: number): boolean { return this.next() < p; }
}

/* ---------------------------------------------------------------- path helpers */

const N = ICON_GEN_GRID;
const C = N / 2;
const r2 = (v: number) => { const s = (Math.round(v * 100) / 100).toFixed(2).replace(/\.?0+$/, ''); return s === '-0' ? '0' : s; };
const pt = (x: number, y: number) => `${r2(x)} ${r2(y)}`;

export const PRIMITIVES = ['ring', 'square', 'diamond', 'triangle', 'bars', 'dots', 'arc', 'chevron', 'cross', 'polygon', 'star', 'slash', 'check'] as const;
export type Primitive = (typeof PRIMITIVES)[number];
export const SYMMETRIES = ['none', 'mirror-x', 'mirror-y', 'radial'] as const;
export type Symmetry = (typeof SYMMETRIES)[number];

function ring(cx: number, cy: number, r: number): string {
  return `M${pt(cx + r, cy)}A${r2(r)} ${r2(r)} 0 1 1 ${pt(cx - r, cy)}A${r2(r)} ${r2(r)} 0 1 1 ${pt(cx + r, cy)}Z`;
}
function rect(x: number, y: number, w: number, h: number, rad = 0): string {
  if (rad <= 0) return `M${pt(x, y)}L${pt(x + w, y)}L${pt(x + w, y + h)}L${pt(x, y + h)}Z`;
  const r = Math.min(rad, w / 2, h / 2);
  return `M${pt(x + r, y)}L${pt(x + w - r, y)}Q${pt(x + w, y)} ${pt(x + w, y + r)}L${pt(x + w, y + h - r)}Q${pt(x + w, y + h)} ${pt(x + w - r, y + h)}L${pt(x + r, y + h)}Q${pt(x, y + h)} ${pt(x, y + h - r)}L${pt(x, y + r)}Q${pt(x, y)} ${pt(x + r, y)}Z`;
}
function polygon(cx: number, cy: number, r: number, sides: number, rot = -Math.PI / 2): string {
  const pts: string[] = [];
  for (let i = 0; i < sides; i++) { const a = rot + (i * 2 * Math.PI) / sides; pts.push(pt(cx + r * Math.cos(a), cy + r * Math.sin(a))); }
  return `M${pts.join('L')}Z`;
}
function star(cx: number, cy: number, r: number, points: number, inner: number): string {
  const pts: string[] = [];
  for (let i = 0; i < points * 2; i++) { const a = -Math.PI / 2 + (i * Math.PI) / points; const rr = i % 2 ? r * inner : r; pts.push(pt(cx + rr * Math.cos(a), cy + rr * Math.sin(a))); }
  return `M${pts.join('L')}Z`;
}
function arc(cx: number, cy: number, r: number, from: number, to: number): string {
  const large = to - from > Math.PI ? 1 : 0;
  return `M${pt(cx + r * Math.cos(from), cy + r * Math.sin(from))}A${r2(r)} ${r2(r)} 0 ${large} 1 ${pt(cx + r * Math.cos(to), cy + r * Math.sin(to))}`;
}
const line = (x1: number, y1: number, x2: number, y2: number) => `M${pt(x1, y1)}L${pt(x2, y2)}`;

/** Mirror path data across the vertical (x) or horizontal (y) centre line; coordinates are absolute, so a token walk does it. */
export function mirrorPath(d: string, axis: 'x' | 'y'): string {
  // tokens: a command letter followed by numbers; A has (rx ry rot large sweep x y) and needs its sweep flag flipped
  return d.replace(/([MLQAZ])([^MLQAZ]*)/g, (_, cmd: string, body: string) => {
    const nums = body.trim() ? body.trim().split(/[\s,]+/).map(Number) : [];
    if (cmd === 'Z') return 'Z';
    if (cmd === 'A') {
      const out: string[] = [];
      for (let i = 0; i + 6 < nums.length + 1 && i + 6 <= nums.length; i += 7) { const [rx, ry, rot, large, sweep, x, y] = nums.slice(i, i + 7); out.push(`${r2(rx)} ${r2(ry)} ${r2(rot)} ${large} ${sweep ? 0 : 1} ${axis === 'x' ? pt(N - x, y) : pt(x, N - y)}`); }
      return `A${out.join('A')}`;
    }
    const out: string[] = [];
    for (let i = 0; i + 1 < nums.length; i += 2) out.push(axis === 'x' ? pt(N - nums[i], nums[i + 1]) : pt(nums[i], N - nums[i + 1]));
    return `${cmd}${out.join(cmd === 'M' ? 'L' : ' ')}`;
  });
}

/* ---------------------------------------------------------------- grammar */

export interface GenHints {
  /** glyph name: mixed into the seed and used to steer the grammar when it names a known shape */
  name?: string;
  kind?: 'icon' | 'badge' | 'app-icon';
  style?: GenStyle;
  symmetry?: Symmetry;
  /** force a primitive (the designer's "more like this") */
  primitive?: Primitive;
}

export interface GeneratedGlyph {
  kind: 'path';
  d: string;
  secondary: string;
  fill: boolean;
  /** what was drawn, for the designer's caption and the fixtures: primitives + symmetry */
  recipe: string;
  seed: number;
}

/** Name words that pin a primitive, so generated packs keep the few icons everyone reads at a glance. */
const NAME_HINTS: [RegExp, Primitive][] = [
  [/chevron|arrow|caret|next|prev|back|forward|expand|collapse/, 'chevron'],
  [/check|done|ok|tick|success/, 'check'],
  [/^x$|close|cancel|times|remove|clear|x-circle/, 'cross'],
  [/plus|add|new|create/, 'cross'],
  [/search|find|zoom|look/, 'ring'],
  [/menu|list|lines|bars|text|align|rows/, 'bars'],
  [/more|dots|ellipsis|grip|drag/, 'dots'],
  [/star|favou?rite|sparkle/, 'star'],
  [/refresh|reload|sync|loop|undo|redo|history|clock|time/, 'arc'],
  [/home|house|folder|file|box|package|save|card|window|layout|grid|tab|monitor|screen/, 'square'],
  [/alert|warn|triangle|play|zap|bolt|rocket|flag/, 'triangle'],
  [/shield|lock|key|badge|hex|gem|diamond|tag/, 'diamond'],
  [/slash|cut|minus|divide|hide|off|mute/, 'slash'],
  [/user|person|avatar|circle|info|help|bell|globe|cloud|sun|moon|eye|dot|status|record/, 'ring'],
];

function primitiveFor(name: string, rng: SeededRng): Primitive {
  const n = name.toLowerCase();
  for (const [re, p] of NAME_HINTS) if (re.test(n)) return p;
  return rng.pick(PRIMITIVES);
}

/** The strokes of one primitive, centred with radius `r`, as `{ open, closed }` path data (open = stroked lines). */
function drawPrimitive(p: Primitive, rng: SeededRng, r: number, rounded: boolean, name: string): { open: string; closed: string } {
  const rad = rounded ? Math.max(1, r * 0.3) : 0;
  switch (p) {
    case 'ring': {
      const hole = rng.chance(0.4);
      const handle = /search|find|zoom/.test(name) || (hole && rng.chance(0.3));
      const rr = handle ? r * (0.72 + rng.int(0, 4) * 0.03) : r;
      const cx = handle ? C - r * 0.2 : C, cy = handle ? C - r * 0.2 : C;
      let open = handle ? line(cx + rr * 0.7, cy + rr * 0.7, C + r, C + r) : '';
      if (hole && !handle) open += ring(C, C, r * (0.3 + rng.int(0, 4) * 0.05));
      return { open, closed: ring(cx, cy, rr) };
    }
    case 'square': {
      const w = r * 1.8, x = C - w / 2;
      const split = rng.chance(0.5);
      const open = split ? (rng.chance(0.5) ? line(x, C, x + w, C) : line(C, x, C, x + w)) : '';
      return { open, closed: rect(x, x, w, w, rad) };
    }
    case 'diamond': return { open: '', closed: polygon(C, C, r, rng.pick([4, 6]), rng.pick([-Math.PI / 2, 0])) };
    case 'triangle': { const up = rng.chance(0.5); return { open: '', closed: polygon(C, C + (up ? r * 0.15 : -r * 0.15), r, 3, up ? -Math.PI / 2 : Math.PI / 2) }; }
    case 'bars': {
      const n = rng.int(2, 4), gap = (r * 2) / (n + 1);
      let open = '';
      for (let i = 1; i <= n; i++) { const y = C - r + gap * i; const shrink = rng.chance(0.3) && i === n ? r * 0.5 : 0; open += line(C - r, y, C + r - shrink, y); }
      return { open, closed: '' };
    }
    case 'dots': {
      const n = rng.int(2, 3), gap = (r * 2) / (n + 1), dr = Math.max(0.9, r * 0.14);
      let closed = '';
      const horizontal = rng.chance(0.6);
      for (let i = 1; i <= n; i++) { const o = C - r + gap * i; closed += horizontal ? ring(o, C, dr) : ring(C, o, dr); }
      return { open: '', closed };
    }
    case 'arc': {
      const from = rng.pick([0.2, 0.6, 1.0]) * Math.PI, to = from + rng.pick([1.2, 1.5, 1.7]) * Math.PI;
      let open = arc(C, C, r, from, to);
      if (rng.chance(0.6)) { const ex = C + r * Math.cos(to), ey = C + r * Math.sin(to); open += line(ex, ey, ex - r * 0.35, ey) + line(ex, ey, ex, ey - r * 0.35); }
      if (/clock|time/.test(name)) open += line(C, C, C, C - r * 0.55) + line(C, C, C + r * 0.4, C);
      return { open, closed: '' };
    }
    case 'chevron': {
      const n = name.toLowerCase();
      const dir = /left|back|prev|collapse/.test(n) ? 'l' : /up/.test(n) ? 'u' : /down/.test(n) ? 'd' : 'r';
      const h = r * 0.9;
      const o = r * 0.45;
      const tip = { r: `M${pt(C - o, C - h)}L${pt(C + o, C)}L${pt(C - o, C + h)}`, l: `M${pt(C + o, C - h)}L${pt(C - o, C)}L${pt(C + o, C + h)}`, u: `M${pt(C - h, C + o)}L${pt(C, C - o)}L${pt(C + h, C + o)}`, d: `M${pt(C - h, C - o)}L${pt(C, C + o)}L${pt(C + h, C - o)}` }[dir];
      const shaft = /arrow/.test(n) ? { r: line(C - r, C, C + o, C), l: line(C + r, C, C - o, C), u: line(C, C + r, C, C - o), d: line(C, C - r, C, C + o) }[dir] : '';
      return { open: tip + shaft, closed: '' };
    }
    case 'cross': {
      const diagonal = /^x$|close|cancel|times|remove|clear|x-circle/.test(name.toLowerCase()) || (!/plus|add|new|create/.test(name.toLowerCase()) && rng.chance(0.4));
      const a = r * 0.85;
      const open = diagonal ? line(C - a * 0.7, C - a * 0.7, C + a * 0.7, C + a * 0.7) + line(C + a * 0.7, C - a * 0.7, C - a * 0.7, C + a * 0.7) : line(C - a, C, C + a, C) + line(C, C - a, C, C + a);
      const framed = rng.chance(0.35);
      return { open, closed: framed ? ring(C, C, r) : '' };
    }
    case 'polygon': return { open: '', closed: polygon(C, C, r, rng.pick([5, 6, 7, 8])) };
    case 'star': return { open: '', closed: star(C, C, r, rng.pick([4, 5, 6]), rng.pick([0.45, 0.5, 0.6])) };
    case 'slash': { const framed = rng.chance(0.5); return { open: line(C - r * 0.7, C + r * 0.7, C + r * 0.7, C - r * 0.7), closed: framed ? ring(C, C, r) : '' }; }
    case 'check': { const open = `M${pt(C - r * 0.8, C)}L${pt(C - r * 0.2, C + r * 0.6)}L${pt(C + r * 0.9, C - r * 0.6)}`; return { open, closed: rng.chance(0.4) ? ring(C, C, r) : '' }; }
  }
}

/** Snap every coordinate of a path to a coarse grid (pixel style). */
function snapPath(d: string, step: number): string {
  return d.replace(/-?\d+(?:\.\d+)?/g, (m) => r2(Math.round(Number(m) / step) * step));
}

/**
 * One glyph for `seed` + `hints`. The name is mixed into the seed (`seed:name`) so one pack seed gives every spot its own
 * glyph; the same seed and hints always give the same output.
 */
export function generateIcon(seed: string | number, hints: GenHints = {}): GeneratedGlyph {
  const name = (hints.name ?? '').trim();
  const style: GenStyle = hints.style && GEN_STYLES.includes(hints.style) ? hints.style : 'line';
  const h = seedHash(`${typeof seed === 'number' ? seed >>> 0 : seed}:${name}:${style}:${hints.kind ?? 'icon'}`);
  const rng = new SeededRng(h);
  const rounded = style === 'rounded';
  const primary = hints.primitive ?? primitiveFor(name, rng);
  const symmetry: Symmetry = hints.symmetry ?? (name && NAME_HINTS.some(([re]) => re.test(name.toLowerCase())) ? 'none' : rng.pick(SYMMETRIES));
  // size and a small seeded offset so two seeds never share a glyph even when the name pins the primitive
  const r = hints.kind === 'app-icon' ? 9 : hints.kind === 'badge' ? 7.5 : 7.5 + rng.int(0, 10) * 0.25;
  let { open, closed } = drawPrimitive(primary, rng, r, rounded, name);
  const parts = [primary];
  // a second, smaller primitive when the grammar allows (abstract marks only): a dot, a bar or a ring inside / beside
  if (!NAME_HINTS.some(([re]) => re.test(name.toLowerCase())) && rng.chance(0.55)) {
    const second = rng.pick(['dots', 'bars', 'ring', 'triangle', 'diamond'] as Primitive[]);
    const inner = drawPrimitive(second, rng, r * rng.pick([0.35, 0.45]), rounded, '');
    open += inner.open; closed += inner.closed; parts.push(second);
  }
  // symmetry: mirror the open strokes (closed centred shapes are symmetric already) or add a quarter turn copy
  if (symmetry === 'mirror-x' && open) open += mirrorPath(open, 'x');
  if (symmetry === 'mirror-y' && open) open += mirrorPath(open, 'y');
  if (symmetry === 'radial' && open) open += mirrorPath(open, 'x') + mirrorPath(open, 'y');
  if (style === 'pixel') { open = snapPath(open, 2); closed = snapPath(closed, 2); }
  // style → what is stroked and what is filled
  const fill = style === 'solid' || style === 'geometric' || style === 'pixel';
  let d: string, secondary = '';
  if (style === 'duotone') { d = open || closed; secondary = open ? closed : ring(C, C, r * 1.15); }
  else if (fill) d = (closed || '') + (open || ''); // a filled pack fills the closed shapes and strokes the open lines (brand glyphSvg)
  else d = (closed || '') + (open || '');
  if (!d) d = ring(C, C, r);
  return { kind: 'path', d, secondary, fill: fill && !open ? true : false, recipe: `${parts.join('+')} ${symmetry} ${style}`, seed: h };
}

/* ---------------------------------------------------------------- packs */

export interface GenPackOptions {
  style?: GenStyle;
  /** spot ids to give per-spot entries (app-icon and badge spots get their kind's sizing); names come from `names` */
  spots?: { id: string; kind?: 'icon' | 'badge' | 'app-icon'; glyph?: string }[];
  /** the pack this one extends (names it lacks fall through) */
  extends?: string;
  name?: string;
  id?: string;
}

/** Style of the generator → icon-pack@1 style, stroke and linecap. */
export function packStyleFor(style: GenStyle, rng: SeededRng): { style: string; stroke: number; linecap: 'round' | 'square' | 'butt' } {
  const stroke = rng.pick([1.25, 1.5, 1.75, 2, 2.25]);
  switch (style) {
    case 'solid': return { style: 'filled', stroke, linecap: 'round' };
    case 'duotone': return { style: 'duotone', stroke, linecap: 'round' };
    case 'rounded': return { style: 'rounded', stroke: Math.max(1.75, stroke), linecap: 'round' };
    case 'geometric': return { style: 'sharp', stroke, linecap: 'square' };
    case 'pixel': return { style: 'filled', stroke: 2, linecap: 'butt' };
    default: return { style: 'outline', stroke, linecap: rng.pick(['round', 'round', 'square']) };
  }
}

/**
 * A whole pack: one glyph per name (per-name entries) and one per given spot (per-spot entries, keyed by the spot id,
 * generated with the spot's kind and glyph name). Returns icon-pack@1 asset data plus a suggested envelope.
 */
export function generatePack(seed: string | number, names: string[], options: GenPackOptions = {}): { id: string; name: string; data: Record<string, unknown> } {
  const style: GenStyle = options.style && GEN_STYLES.includes(options.style) ? options.style : 'line';
  const seedText = typeof seed === 'number' ? String(seed >>> 0) : seed;
  const rng = new SeededRng(seedHash(`${seedText}:pack:${style}`));
  const ps = packStyleFor(style, rng);
  const glyphs: Record<string, unknown> = {};
  for (const n of [...new Set(names)].filter((x) => /^[a-z][a-z0-9-]*$/.test(x)).sort()) {
    const g = generateIcon(seedText, { name: n, style, kind: 'icon' });
    glyphs[n] = g.secondary ? { d: g.d, secondary: g.secondary } : g.fill ? { d: g.d, fill: true } : { d: g.d };
  }
  const spots: Record<string, unknown> = {};
  for (const s of options.spots ?? []) {
    if (s.kind && s.kind !== 'icon') {
      const g = generateIcon(seedText, { name: s.glyph || s.id.split('/').pop() || '', style, kind: s.kind });
      spots[s.id] = g.secondary ? { d: g.d, secondary: g.secondary } : g.fill ? { d: g.d, fill: true } : { d: g.d };
    } else if (s.glyph && s.glyph in glyphs) spots[s.id] = s.glyph;
  }
  const id = options.id ?? `generated-${seedHash(`${seedText}:${style}`).toString(36)}`;
  const data: Record<string, unknown> = {
    style: ps.style, grid: ICON_GEN_GRID, stroke: ps.stroke, linecap: ps.linecap, fallback: 'framework',
    glyphs, ...(Object.keys(spots).length ? { spots } : {}), ...(options.extends ? { extends: options.extends } : {}),
    source: { kind: 'generated' }, license: { id: 'CC0-1.0', holder: 'AmberX AXF icon-gen' },
    seed: { seed: seedText, style, grammar: ICON_GEN_CONTRACT },
    tags: ['generated', style],
  };
  return { id, name: options.name ?? `Generated ${style} (${seedText})`, data };
}
