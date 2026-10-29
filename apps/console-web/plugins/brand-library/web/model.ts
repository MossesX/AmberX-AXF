/**
 * Brand library — pure model (no React, no DOM): tabs, facets, search + filters, the virtual grid's window, and how a
 * picked piece becomes a branding package. Tested by `test.mts` (npx -y tsx apps/console-web/plugins/brand-library/test.mts).
 */

export const FOLDER = 'brand-library';
export const ID = 'ai.amberx.axf.console.brand-library';
export const VIEW = 'brand-library';
/** id prefix of the branding packages this plugin derives (a mark / animation / pack swapped into the active brand) */
export const DERIVED_PREFIX = 'bl-';

export type BrandType = 'logo-mark' | 'animated-logo' | 'icon-pack' | 'branding';
export type TabId = 'logos' | 'animated' | 'packs' | 'branding';
export type TileSize = 'sm' | 'md' | 'lg';

export const TABS: { id: TabId; type: BrandType; label: string; icon: string; noun: string }[] = [
  { id: 'logos', type: 'logo-mark', label: 'Logos', icon: 'star', noun: 'logo' },
  { id: 'animated', type: 'animated-logo', label: 'Animated logos', icon: 'sparkles', noun: 'animated logo' },
  { id: 'packs', type: 'icon-pack', label: 'Icon packs', icon: 'grid', noun: 'icon pack' },
  { id: 'branding', type: 'branding', label: 'Branding packages', icon: 'package', noun: 'branding package' },
];
export const tabOf = (t: TabId) => TABS.find((x) => x.id === t) ?? TABS[0]!;

export interface LibAsset {
  $axf: 'asset@1'; type: BrandType; id: string; name: string; version: string;
  description?: string; author?: string; tags?: string[];
  data: Record<string, unknown>;
  /** added by the server: brand / form / preset / loop / style */
  facets?: Record<string, string>;
}

export interface Config { tab: TabId; tile: TileSize; brand: string; names: boolean; motion: boolean; applied: Applied | null }
export interface Applied { type: BrandType; id: string; at?: string; asset?: LibAsset }
export const DEFAULT_CONFIG: Config = { tab: 'logos', tile: 'md', brand: '', names: true, motion: true, applied: null };

/** The filter facet each tab offers besides brand. */
export const FACET_OF: Record<BrandType, { key: string; label: string } | null> = {
  'logo-mark': { key: 'form', label: 'Form' },
  'animated-logo': { key: 'preset', label: 'Motion' },
  'icon-pack': { key: 'style', label: 'Style' },
  branding: { key: 'style', label: 'Placement' },
};

export interface Filters { q: string; brand: string; facet: string }

/** Facet values present in a list (sorted, empty values dropped). */
export function facetValues(items: LibAsset[], key: string): string[] {
  return [...new Set(items.map((a) => a.facets?.[key] ?? '').filter(Boolean))].sort();
}

/** Search (name, id, tags, description; every word must match) + brand + facet filters. */
export function filterItems(items: LibAsset[], type: BrandType, f: Filters): LibAsset[] {
  const words = f.q.toLowerCase().split(/\s+/).filter(Boolean);
  const facet = FACET_OF[type]?.key;
  return items.filter((a) => {
    if (f.brand && (a.facets?.brand ?? '') !== f.brand) return false;
    if (facet && f.facet && (a.facets?.[facet] ?? '') !== f.facet) return false;
    if (!words.length) return true;
    const hay = `${a.name} ${a.id} ${(a.tags ?? []).join(' ')} ${a.description ?? ''}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** Which rows of a virtual grid to draw: columns that fit, the visible row range plus `overscan` rows each side. */
export function gridWindow(o: { count: number; width: number; tile: number; gap: number; scrollTop: number; height: number; rowHeight: number; overscan?: number }) {
  const cols = Math.max(1, Math.floor((o.width + o.gap) / (o.tile + o.gap)));
  const rows = Math.ceil(o.count / cols);
  const over = o.overscan ?? 2;
  const first = Math.max(0, Math.floor(o.scrollTop / o.rowHeight) - over);
  const last = Math.min(rows, Math.ceil((o.scrollTop + o.height) / o.rowHeight) + over);
  return { cols, rows, first, last, start: first * cols, end: Math.min(o.count, last * cols), total: rows * o.rowHeight };
}

/** Small stable hash (djb2, base 36) for derived ids. */
export function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/** Which part of a branding package a piece fills. */
export function roleOf(a: LibAsset): 'mark' | 'wordmark' | 'lockup' | 'animated' | 'iconPack' | 'branding' {
  if (a.type === 'branding') return 'branding';
  if (a.type === 'icon-pack') return 'iconPack';
  if (a.type === 'animated-logo') return 'animated';
  const form = String(a.data.form ?? a.facets?.form ?? 'mark');
  return form === 'wordmark' || form === 'lockup' ? form : 'mark';
}

const ROLE_LABEL = { mark: 'mark', wordmark: 'wordmark', lockup: 'lockup', animated: 'animated mark', iconPack: 'icon pack', branding: 'branding' } as const;
export const roleLabel = (a: LibAsset) => ROLE_LABEL[roleOf(a)];

/**
 * The branding package that puts `piece` into `base` (the active brand): its mark / wordmark / lockup, its animated
 * mark or its icon pack replaced, everything else kept. The id is derived from the content, so applying a new piece
 * always swaps to a new id (a swap to the same id is a no-op in the runtime).
 */
export function deriveBranding(base: LibAsset | null, piece: LibAsset): LibAsset {
  if (piece.type === 'branding') return piece;
  const data = JSON.parse(JSON.stringify(base?.data ?? { brand: { name: String(piece.facets?.brand || 'AmberX'), tagline: '' }, marks: {}, decorations: {} })) as Record<string, unknown>;
  const marks = { ...((data.marks as Record<string, string>) ?? {}) };
  const role = roleOf(piece);
  if (role === 'iconPack') data.iconPack = piece.id;
  else marks[role] = piece.id;
  // a lone mark also stands in for a missing wordmark / lockup (the engine falls back the same way)
  data.marks = marks;
  const baseName = base?.name?.replace(/ · with .*$/, '') ?? 'Brand';
  const id = `${DERIVED_PREFIX}${hash(JSON.stringify(data))}`;
  return {
    $axf: 'asset@1', type: 'branding', id, name: `${baseName} · with ${piece.name}`.slice(0, 80), version: '1.0.0',
    description: `Made in the Brand library: ${base?.name ?? 'a new brand'} with ${roleLabel(piece)} ${piece.id}.`,
    author: 'Brand library', tags: ['brand-library', 'derived'], data,
  };
}

/** The asset ids a branding package names (for registering what it needs before a swap). */
export function brandingRefs(b: LibAsset): { type: BrandType; id: string }[] {
  const out: { type: BrandType; id: string }[] = [];
  for (const [k, v] of Object.entries((b.data.marks as Record<string, string>) ?? {})) if (typeof v === 'string' && v) out.push({ type: k === 'animated' ? 'animated-logo' : 'logo-mark', id: v });
  if (typeof b.data.iconPack === 'string' && b.data.iconPack) out.push({ type: 'icon-pack', id: b.data.iconPack });
  return out;
}

/** Clean a saved config (the server cleans too; this keeps the UI safe offline). */
export function cleanConfig(raw: unknown): Config {
  const c = { ...DEFAULT_CONFIG };
  if (!raw || typeof raw !== 'object') return c;
  const o = raw as Record<string, unknown>;
  if (TABS.some((t) => t.id === o.tab)) c.tab = o.tab as TabId;
  if (o.tile === 'sm' || o.tile === 'md' || o.tile === 'lg') c.tile = o.tile;
  if (typeof o.brand === 'string') c.brand = o.brand.slice(0, 40);
  if (typeof o.names === 'boolean') c.names = o.names;
  if (typeof o.motion === 'boolean') c.motion = o.motion;
  const ap = o.applied as Applied | null | undefined;
  if (ap && typeof ap === 'object' && TABS.some((t) => t.type === ap.type) && typeof ap.id === 'string') c.applied = ap;
  return c;
}

/** Preview sizes (px of the mark's height), smallest = the §10 minimum. */
export const PREVIEW_SIZES = [16, 24, 32, 48, 96] as const;
