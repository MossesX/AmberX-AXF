/**
 * Installer look (pure: no React, no runtime): the token tree, roll marks and the roll itself.
 *
 *  - Style  = the app's style-theme tokens + the gauge and progress-meter control assets (framework types).
 *  - Color  = the app's color-theme tokens (light and dark themes).
 *  - Layout = the installer's own layout (variant, gauges, log lines, which side the groups sit on): page layout
 *             only, so it is the plugin's to keep (colours and control styles always come from the app).
 *
 * Every leaf has a roll mark; a parent's mark is all / some / none of its children and toggling it sets every child.
 * A roll changes only marked leaves: for themes it takes them from one other theme of the same kind (a "donor", so
 * colours stay coherent; colour donors share the current light/dark scheme unless the scheme itself is marked), for
 * gauge / meter / layout leaves it picks a value from the field's allowed values. When every leaf of a theme is
 * marked the roll simply switches to the donor theme.
 */

export type LookType = 'style-theme' | 'color-theme' | 'gauge' | 'meter' | 'installer-layout';
export const ASSET_TYPES: LookType[] = ['style-theme', 'color-theme', 'gauge', 'meter'];

export interface InstallerLayout {
  variant: 'classic' | 'dashboard' | 'compact' | 'focus';
  gauges: boolean;
  logLines: number;
  groupsSide: 'left' | 'right';
}
export const LAYOUT_DEFAULT: InstallerLayout = { variant: 'classic', gauges: true, logLines: 7, groupsSide: 'left' };
export const LAYOUT_VARIANTS: { id: InstallerLayout['variant']; label: string; hint: string }[] = [
  { id: 'classic', label: 'Classic', hint: 'Groups beside the current group, gauges on top' },
  { id: 'dashboard', label: 'Dashboard', hint: 'Big gauges and every group as a card' },
  { id: 'compact', label: 'Compact', hint: 'One column, the essentials only' },
  { id: 'focus', label: 'Focus', hint: 'The current step, large' },
];

export function normalizeLayout(l: Partial<InstallerLayout> | null | undefined): InstallerLayout {
  const d = l ?? {};
  const n = Number(d.logLines);
  return {
    variant: LAYOUT_VARIANTS.some((v) => v.id === d.variant) ? (d.variant as InstallerLayout['variant']) : LAYOUT_DEFAULT.variant,
    gauges: typeof d.gauges === 'boolean' ? d.gauges : LAYOUT_DEFAULT.gauges,
    logLines: Number.isFinite(n) ? Math.min(12, Math.max(0, Math.round(n))) : LAYOUT_DEFAULT.logLines,
    groupsSide: d.groupsSide === 'right' ? 'right' : 'left',
  };
}

/** What a field may be, for the tree's editors and for rolling. */
export type FieldKind =
  | { kind: 'color' }
  | { kind: 'enum'; values: (string | number)[] }
  | { kind: 'number'; min: number; max: number; step?: number }
  | { kind: 'bool' }
  | { kind: 'text' };

export interface TreeNode {
  id: string;
  label: string;
  children?: TreeNode[];
  /** leaves only */
  type?: LookType;
  path?: string[];
  field?: FieldKind;
}

type Json = Record<string, unknown>;
export interface TypeSpec { required?: string[]; enums?: Record<string, (string | number)[]> }

const pretty = (k: string) => k.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
const isColor = (v: unknown) => typeof v === 'string' && /^(#|rgb|hsl)/i.test(v);

/** Number ranges the framework's assets use (so a roll never makes a 300 px radius). */
export const NUMBER_RANGES: Record<string, { min: number; max: number; step?: number }> = {
  thickness: { min: 4, max: 16 }, ticks: { min: 0, max: 10 }, height: { min: 2, max: 24 }, segments: { min: 4, max: 40 },
  logLines: { min: 0, max: 12 },
};

function fieldFor(key: string, value: unknown, spec: TypeSpec | undefined, samples: unknown[]): FieldKind {
  const en = spec?.enums?.[key];
  if (en) return { kind: 'enum', values: en };
  if (typeof value === 'boolean') return { kind: 'bool' };
  if (isColor(value)) return { kind: 'color' };
  if (typeof value === 'number') {
    const r = NUMBER_RANGES[key];
    if (r) return { kind: 'number', ...r };
    const nums = samples.filter((s): s is number => typeof s === 'number');
    const lo = Math.min(value, ...nums), hi = Math.max(value, ...nums);
    const step = [value, ...nums].every(Number.isInteger) ? 1 : 0.01;
    return { kind: 'number', min: lo === hi ? Math.max(0, lo / 2) : lo, max: lo === hi ? hi * 1.5 || 1 : hi, step };
  }
  if (typeof value === 'string' && samples.some((s) => typeof s === 'string' && s !== value)) {
    return { kind: 'enum', values: [...new Set([value, ...samples.filter((s): s is string => typeof s === 'string')])] };
  }
  return { kind: 'text' };
}

/** Leaves for one asset's data (one level of nesting, e.g. color-theme `tokens.*`), with their field kinds. */
function leavesFor(type: LookType, data: Json, spec: TypeSpec | undefined, others: Json[], prefix: string[] = []): TreeNode[] {
  const out: TreeNode[] = [];
  for (const [k, v] of Object.entries(data)) {
    const path = [...prefix, k];
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const kids = leavesFor(type, v as Json, spec, others.map((o) => (o[k] && typeof o[k] === 'object' ? (o[k] as Json) : {})), path);
      if (kids.length) out.push({ id: `${type}:${path.join('.')}`, label: pretty(k), children: kids });
      continue;
    }
    if (Array.isArray(v)) continue;
    out.push({ id: `${type}:${path.join('.')}`, label: pretty(k), type, path, field: fieldFor(k, v, prefix.length ? undefined : spec, others.map((o) => o[k])) });
  }
  return out;
}

export interface TreeInput {
  /** active data per asset type (+ 'installer-layout') */
  current: Partial<Record<LookType, Json>>;
  /** every registered asset's data per type, for donors and field ranges */
  options: Partial<Record<LookType, Json[]>>;
  spec: Partial<Record<LookType, TypeSpec>>;
}

/** The three-branch tree: Style (style theme, gauge, meter), Color (color theme), Layout (installer layout). */
export function buildTree(inp: TreeInput): TreeNode[] {
  const branch = (type: LookType, label: string): TreeNode => ({
    id: type, label, children: leavesFor(type, inp.current[type] ?? {}, inp.spec[type], inp.options[type] ?? []),
  });
  const layoutSpec: TypeSpec = { enums: { variant: LAYOUT_VARIANTS.map((v) => v.id), groupsSide: ['left', 'right'] } };
  return [
    { id: 'style', label: 'Style', children: [branch('style-theme', 'Style theme'), branch('gauge', 'Gauges'), branch('meter', 'Progress meters')] },
    { id: 'color', label: 'Color', children: [branch('color-theme', 'Color theme')] },
    { id: 'layout', label: 'Layout', children: [{ id: 'installer-layout', label: 'Installer layout', children: leavesFor('installer-layout', inp.current['installer-layout'] ?? { ...LAYOUT_DEFAULT }, layoutSpec, []) }] },
  ];
}

export function leaves(nodes: TreeNode[]): TreeNode[] {
  return nodes.flatMap((n) => (n.children ? leaves(n.children) : [n]));
}

export type Marks = Record<string, boolean>;
/** Unmarked by default only where rolling would be surprising: nothing. Every leaf rolls until switched off. */
export const isMarked = (marks: Marks, id: string) => marks[id] !== false;

export function markState(node: TreeNode, marks: Marks): 'all' | 'some' | 'none' {
  if (!node.children) return isMarked(marks, node.id) ? 'all' : 'none';
  const ls = leaves(node.children);
  const on = ls.filter((l) => isMarked(marks, l.id)).length;
  return on === 0 ? 'none' : on === ls.length ? 'all' : 'some';
}

/** Toggle a node: a leaf flips; a parent turns every child on (unless all are on, then off). */
export function toggleMark(node: TreeNode, marks: Marks): Marks {
  const next = { ...marks };
  const target = markState(node, marks) !== 'all';
  for (const l of node.children ? leaves(node.children) : [node]) next[l.id] = target;
  return next;
}

const getPath = (o: Json, p: string[]): unknown => p.reduce<unknown>((a, k) => (a && typeof a === 'object' ? (a as Json)[k] : undefined), o);
function setPath(o: Json, p: string[], v: unknown): Json {
  const out: Json = { ...o };
  if (p.length === 1) { out[p[0]!] = v; return out; }
  const head = p[0]!;
  out[head] = setPath((o[head] && typeof o[head] === 'object' ? o[head] : {}) as Json, p.slice(1), v);
  return out;
}

export type Rng = () => number;
const pickOne = <T>(xs: T[], rng: Rng): T => xs[Math.floor(rng() * xs.length) % xs.length]!;

export interface RollResult {
  /** new data per type that changed */
  data: Partial<Record<LookType, Json>>;
  /** types where every leaf was marked: switch to this donor (its index in options) instead of a rolled copy */
  whole: Partial<Record<LookType, number>>;
  changed: number;
}

/** Roll every marked leaf. Deterministic for a given rng (tests pass a seeded one). */
export function roll(tree: TreeNode[], marks: Marks, inp: TreeInput, rng: Rng = Math.random): RollResult {
  const res: RollResult = { data: {}, whole: {}, changed: 0 };
  const all = leaves(tree);
  const types = [...new Set(all.map((l) => l.type!).filter(Boolean))] as LookType[];
  for (const type of types) {
    const ls = all.filter((l) => l.type === type);
    const marked = ls.filter((l) => isMarked(marks, l.id));
    if (!marked.length) continue;
    const cur = inp.current[type] ?? {};
    let out: Json = { ...cur };
    if (type === 'style-theme' || type === 'color-theme') {
      const opts = inp.options[type] ?? [];
      const schemeMarked = marked.some((l) => l.path?.join('.') === 'scheme');
      const pool = opts.map((o, i) => ({ o, i })).filter(({ o }) => JSON.stringify(o) !== JSON.stringify(cur))
        .filter(({ o }) => type !== 'color-theme' || schemeMarked || o.scheme === cur.scheme);
      if (!pool.length) continue;
      const donor = pickOne(pool, rng);
      if (marked.length === ls.length) { res.whole[type] = donor.i; res.data[type] = donor.o; res.changed += ls.length; continue; }
      for (const l of marked) {
        const v = getPath(donor.o, l.path!);
        if (v !== undefined && JSON.stringify(v) !== JSON.stringify(getPath(out, l.path!))) { out = setPath(out, l.path!, v); res.changed++; }
      }
    } else {
      for (const l of marked) {
        const f = l.field!;
        const now = getPath(out, l.path!);
        let v: unknown = now;
        if (f.kind === 'enum') { const others = f.values.filter((x) => x !== now); if (others.length) v = pickOne(others, rng); }
        else if (f.kind === 'bool') v = rng() < 0.5;
        else if (f.kind === 'number') { const step = f.step ?? 1; const n = Math.round((f.min + rng() * (f.max - f.min)) / step) * step; v = Math.round(n * 1000) / 1000; }
        if (JSON.stringify(v) !== JSON.stringify(now)) { out = setPath(out, l.path!, v); res.changed++; }
      }
    }
    res.data[type] = out;
  }
  return res;
}

/** Edit one leaf by hand (the tree's editors). */
export function setLeaf(data: Json, path: string[], value: unknown): Json { return setPath(data, path, value); }
export const leafValue = getPath;

/** The saved document on axHub's data server (shared/settings/claude-handoff-look.json). */
export interface LookDoc {
  $axf: 'handoff-look@1';
  layout: InstallerLayout;
  marks: Marks;
  /** rolled / hand-edited asset bodies, re-registered on load (ids handoff-look-<type>) */
  custom: Partial<Record<LookType, Json>>;
  treeOpen: boolean;
  updatedAt: string;
}
export const emptyDoc = (): LookDoc => ({ $axf: 'handoff-look@1', layout: { ...LAYOUT_DEFAULT }, marks: {}, custom: {}, treeOpen: true, updatedAt: '' });

export function parseDoc(raw: unknown): LookDoc {
  const d = (raw && typeof raw === 'object' ? raw : {}) as Partial<LookDoc>;
  const marks: Marks = {};
  for (const [k, v] of Object.entries(d.marks ?? {})) if (typeof v === 'boolean' && k.length < 200) marks[k] = v;
  const custom: LookDoc['custom'] = {};
  for (const t of ASSET_TYPES) { const c = (d.custom ?? {})[t]; if (c && typeof c === 'object' && !Array.isArray(c)) custom[t] = c as Json; }
  return { $axf: 'handoff-look@1', layout: normalizeLayout(d.layout), marks, custom, treeOpen: d.treeOpen !== false, updatedAt: typeof d.updatedAt === 'string' ? d.updatedAt : '' };
}

export const customId = (type: LookType) => `handoff-look-${type}`;
