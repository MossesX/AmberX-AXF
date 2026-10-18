/*
 * Theme manager roll engine (pure, no React): the token tree, sane random rolls and colour contrast.
 *
 * The tree comes from the asset type registry (asset-types.json via assetTypeSpecs) and the assets of each type,
 * so a new asset type shows up by itself. Leaves are the primitive fields of an asset's data (top level and nested
 * objects; arrays such as menu items are structure, not style, and aren't rolled). A roll changes only the ticked,
 * unlocked leaves of a copy of the active asset, so the result is always a complete, valid asset:
 *   - enums pick another allowed value; booleans flip a coin;
 *   - numbers stay inside the range every known asset of that type uses (a roll never breaks the UI);
 *   - other strings (fonts, shadows) come from values other assets of that type use;
 *   - colours are generated as a palette that keeps text and accents readable (WCAG contrast) in the current scheme.
 */

export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };
export interface TypeSpec { label: string; group?: string; icon?: string; required?: string[]; enums?: Record<string, string[]>; nested?: Record<string, string[]>; optional_fields?: Record<string, string> }
export interface Leaf { path: string; label: string; kind: 'color' | 'number' | 'enum' | 'bool' | 'string'; enum?: string[]; range?: [number, number]; values?: Json[] }
export interface Node { id: string; label: string; type: string; icon?: string; children: Node[]; leaf?: Leaf }

const isColor = (v: unknown) => typeof v === 'string' && /^(#[0-9a-f]{3,8}|rgba?\(|hsla?\()/i.test(v.trim());
const humanize = (k: string) => k.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^\w/, (c) => c.toUpperCase());

export function getAt(data: Record<string, Json>, path: string): Json | undefined {
  let cur: Json | undefined = data;
  for (const p of path.split('.')) cur = cur && typeof cur === 'object' && !Array.isArray(cur) ? (cur as Record<string, Json>)[p] : undefined;
  return cur;
}
export function setAt(data: Record<string, Json>, path: string, v: Json): Record<string, Json> {
  const out = structuredClone(data);
  const parts = path.split('.');
  let cur = out as Record<string, Json>;
  for (const p of parts.slice(0, -1)) { if (!cur[p] || typeof cur[p] !== 'object') cur[p] = {}; cur = cur[p] as Record<string, Json>; }
  cur[parts[parts.length - 1]!] = v;
  return out;
}

/** One branch per asset type (except access policies), drilling down to every primitive field. */
export function buildTree(specs: Record<string, TypeSpec>, assets: Record<string, { data: Record<string, Json> }[]>, active: Record<string, Record<string, Json>>, order?: string[]): Node[] {
  const types = (order ?? Object.keys(specs)).filter((t) => t !== 'uac-policy' && specs[t] && active[t]);
  const nodes: Node[] = [];
  for (const type of types) {
    const spec = specs[type]!;
    const all = assets[type] ?? [];
    const walk = (obj: Record<string, Json>, prefix: string): Node[] => {
      const out: Node[] = [];
      for (const [k, v] of Object.entries(obj)) {
        const path = prefix ? `${prefix}.${k}` : k;
        if (Array.isArray(v) || k === 'slots') continue;
        if (v && typeof v === 'object') { const kids = walk(v as Record<string, Json>, path); if (kids.length) out.push({ id: `${type}:${path}`, label: humanize(k), type, children: kids }); continue; }
        const seen = all.map((a) => getAt(a.data, path)).filter((x) => x !== undefined && x !== null);
        const en = spec.enums?.[path];
        let leaf: Leaf;
        if (en) leaf = { path, label: humanize(k), kind: 'enum', enum: en };
        else if (typeof v === 'boolean') leaf = { path, label: humanize(k), kind: 'bool' };
        else if (typeof v === 'number') {
          const nums = seen.filter((x): x is number => typeof x === 'number');
          const lo = Math.min(v, ...nums), hi = Math.max(v, ...nums);
          leaf = { path, label: humanize(k), kind: 'number', range: [lo, hi] };
        } else if (isColor(v)) leaf = { path, label: humanize(k), kind: 'color' };
        else leaf = { path, label: humanize(k), kind: 'string', values: [...new Set(seen.map((x) => JSON.stringify(x)))].map((x) => JSON.parse(x) as Json) };
        out.push({ id: `${type}:${path}`, label: leaf.label, type, children: [], leaf });
      }
      return out;
    };
    nodes.push({ id: type, label: spec.label ?? humanize(type), type, icon: spec.icon, children: walk(active[type]!, '') });
  }
  return nodes;
}

export function leaves(n: Node): Node[] { return n.leaf ? [n] : n.children.flatMap(leaves); }

/* ---------------- colour ---------------- */

export function hexToRgb(c: string): [number, number, number] | null {
  const s = c.trim();
  let m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) return [...m[1]!].map((x) => parseInt(x + x, 16)) as [number, number, number];
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(s);
  if (m) return [0, 2, 4].map((i) => parseInt(m![1]!.slice(i, i + 2), 16)) as [number, number, number];
  m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(s);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  return null;
}
const lum = ([r, g, b]: [number, number, number]) => { const f = (x: number) => { const v = x / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
export function contrast(a: string, b: string): number {
  const A = hexToRgb(a), B = hexToRgb(b);
  if (!A || !B) return 21;
  const [x, y] = [lum(A), lum(B)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}
export function hueHex(h: number, s: number, l: number): string {
  s /= 100; l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
  return `#${[f(0), f(8), f(4)].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}
const alphaOf = (hex: string, a: number) => { const c = hexToRgb(hex) ?? [0, 0, 0]; return `rgba(${c[0]},${c[1]},${c[2]},${a})`; }; // theme-ok: builds a generated theme value

/** A readable palette for the scheme; `rand` is injectable for tests. */
export function palette(scheme: 'light' | 'dark', rand: () => number = Math.random): Record<string, string> {
  const r = (lo: number, hi: number) => lo + rand() * (hi - lo);
  const base = r(0, 360);
  const tint = r(4, 22);
  const dark = scheme === 'dark';
  const bgL = dark ? r(6, 12) : r(95, 99);
  const step = dark ? 4 : -3;
  const p: Record<string, string> = {
    bg: hueHex(base, tint, bgL), surface: hueHex(base, tint, bgL + step), surface2: hueHex(base, tint, bgL + step * 2), surface3: hueHex(base, tint, bgL + step * 3.5),
    text: hueHex(base, r(5, 18), dark ? r(90, 96) : r(8, 14)), muted: hueHex(base, r(6, 16), dark ? r(62, 70) : r(38, 46)), border: hueHex(base, tint, dark ? bgL + 14 : bgL - 14),
  };
  const accHue = (base + (rand() < 0.5 ? r(120, 240) : r(-40, 40)) + 360) % 360;
  let accL = dark ? 62 : 42;
  let accent = hueHex(accHue, r(60, 92), accL);
  for (let i = 0; i < 12 && contrast(accent, p.surface!) < 3; i++) { accL += dark ? 3 : -3; accent = hueHex(accHue, 80, accL); }
  p.accent = accent;
  p.accentText = contrast(accent, '#ffffff') >= contrast(accent, '#111111') ? '#ffffff' : '#111111';  // theme-ok: values of a generated theme asset, not UI styling
  p.accentSoft = alphaOf(accent, dark ? 0.16 : 0.12);
  p.focus = accent;
  const status = (h: number) => { let l = dark ? 64 : 40; let c = hueHex(h, 72, l); for (let i = 0; i < 10 && contrast(c, p.surface!) < 3; i++) { l += dark ? 3 : -3; c = hueHex(h, 72, l); } return c; };
  p.danger = status(r(354, 364) % 360); p.success = status(r(135, 155)); p.warning = status(r(36, 46)); p.info = status(r(200, 218));
  p.shadow = dark ? 'rgba(0,0,0,0.5)' : 'rgba(15,20,30,0.14)';  // theme-ok: values of a generated theme asset, not UI styling
  return p;
}

/* ---------------- rolling ---------------- */

export interface RollOpts { ticked: Set<string>; locked: Set<string>; rand?: () => number }

/** Roll one asset type's data: only ticked, unlocked leaves change. */
export function rollType(type: string, tree: Node[], current: Record<string, Json>, o: RollOpts): Record<string, Json> {
  const rand = o.rand ?? Math.random;
  const node = tree.find((n) => n.type === type);
  if (!node) return current;
  const pick = <T,>(xs: T[]): T => xs[Math.floor(rand() * xs.length)]!;
  let out = structuredClone(current);
  const want = leaves(node).filter((l) => o.ticked.has(l.id) && !o.locked.has(l.id));
  if (!want.length) return out;
  const colors = want.filter((l) => l.leaf!.kind === 'color');
  if (colors.length) {
    const schemeLeaf = `${type}:scheme`;
    let scheme = (getAt(out, 'scheme') as 'light' | 'dark' | undefined) ?? 'dark';
    if (o.ticked.has(schemeLeaf) && !o.locked.has(schemeLeaf) && typeof getAt(out, 'scheme') === 'string') { scheme = rand() < 0.5 ? 'light' : 'dark'; out = setAt(out, 'scheme', scheme); }
    const pal = palette(scheme, rand);
    for (const l of colors) {
      const key = l.leaf!.path.split('.').pop()!;
      out = setAt(out, l.leaf!.path, pal[key] ?? hueHex(rand() * 360, 60, scheme === 'dark' ? 60 : 45));
    }
  }
  for (const l of want) {
    const f = l.leaf!;
    if (f.kind === 'color' || (type === 'color-theme' && f.path === 'scheme')) continue;
    const cur = getAt(out, f.path);
    if (f.kind === 'enum' && f.enum?.length) out = setAt(out, f.path, f.enum.length > 1 ? pick(f.enum.filter((x) => x !== cur)) : f.enum[0]!);
    else if (f.kind === 'bool') out = setAt(out, f.path, rand() < 0.5);
    else if (f.kind === 'number' && f.range) {
      const [lo, hi] = f.range;
      const isInt = Number.isInteger(lo) && Number.isInteger(hi) && Number.isInteger(cur);
      const v = lo + rand() * (hi - lo);
      out = setAt(out, f.path, isInt ? Math.round(v) : Math.round(v * 100) / 100);
    } else if (f.kind === 'string' && f.values?.length) out = setAt(out, f.path, pick(f.values));
  }
  return out;
}

/** Readability problems of a colour theme (text and accents against surfaces). Empty = fine. */
export function readability(data: Record<string, Json>): string[] {
  const t = (getAt(data, 'tokens') ?? {}) as Record<string, string>;
  const out: string[] = [];
  const need = (a: string, b: string, min: number) => { if (t[a] && t[b] && contrast(t[a]!, t[b]!) < min) out.push(`${a} on ${b}: ${contrast(t[a]!, t[b]!).toFixed(1)}:1 (needs ${min})`); };
  need('text', 'bg', 4.5); need('text', 'surface', 4.5); need('muted', 'surface', 3); need('accent', 'surface', 3); need('accentText', 'accent', 4.5);
  return out;
}

/* ---------------- tri-state selection ---------------- */

export type Tri = 'on' | 'off' | 'some';
export function triState(n: Node, ticked: Set<string>): Tri {
  const ls = leaves(n);
  const on = ls.filter((l) => ticked.has(l.id)).length;
  return on === 0 ? 'off' : on === ls.length ? 'on' : 'some';
}
export function toggle(n: Node, ticked: Set<string>): Set<string> {
  const next = new Set(ticked);
  const ls = leaves(n);
  const turnOn = triState(n, ticked) !== 'on';
  for (const l of ls) { if (turnOn) next.add(l.id); else next.delete(l.id); }
  return next;
}
export const allLeafIds = (tree: Node[]) => tree.flatMap(leaves).map((l) => l.id);
export const PRESETS: Record<string, (tree: Node[]) => string[]> = {
  all: (t) => allLeafIds(t),
  none: () => [],
  'colors only': (t) => t.flatMap(leaves).filter((l) => l.leaf!.kind === 'color').map((l) => l.id),
  'accents only': (t) => t.flatMap(leaves).filter((l) => /accent|focus/i.test(l.leaf!.path)).map((l) => l.id),
};
