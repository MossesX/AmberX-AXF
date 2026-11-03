/*
 * Theme editor model (pure, no React): sections, categories, the full token list, drafts and diffs.
 *
 * The token tree itself comes from the Theme manager through the capability `axf.token-tree@1` (TokenTree below); this
 * file only arranges it. Every possible token = the asset type's fields (asset-types.json: required, nested,
 * optional_fields) and every field any known theme of the type has, so a token added to the asset types or to any theme
 * shows up by itself. A token the theme being edited doesn't set is listed as "not set" with the value other themes use.
 * Categories come from a small rule table; a token it doesn't know goes under its nested group's name or "Other".
 */

export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };
export type Data = Record<string, Json>;
export interface TypeSpec { label: string; group?: string; icon?: string; required?: string[]; enums?: Record<string, string[]>; nested?: Record<string, string[]>; optional_fields?: Record<string, string> }
export interface Leaf { path: string; label: string; kind: 'color' | 'number' | 'enum' | 'bool' | 'string'; enum?: string[]; range?: [number, number]; values?: Json[] }
export interface Node { id: string; label: string; type: string; icon?: string; children: Node[]; leaf?: Leaf }

/** The capability `axf.token-tree@1` (provided by the Theme manager's web part). */
export interface TokenTree {
  version: number;
  buildTree(specs: Record<string, TypeSpec>, assets: Record<string, { data: Data }[]>, active: Record<string, Data>, order?: string[]): Node[];
  leaves(n: Node): Node[];
  getAt(data: Data, path: string): Json | undefined;
  setAt(data: Data, path: string, v: Json): Data;
}
export const TOKEN_TREE = 'axf.token-tree@1';
/** The token tree service, or null when no plugin provides it right now. */
export function tokenTree(): TokenTree | null {
  const s = (globalThis as { __axfWebServices?: Record<string, unknown> }).__axfWebServices?.[TOKEN_TREE] as TokenTree | undefined;
  return s && typeof s.buildTree === 'function' && typeof s.leaves === 'function' ? s : null;
}

export type SectionType = 'color-theme' | 'style-theme';
export const SECTIONS: { type: SectionType; label: string; icon: string }[] = [
  { type: 'color-theme', label: 'Colour', icon: 'palette' },
  { type: 'style-theme', label: 'Style', icon: 'type' },
];

export interface Category { id: string; label: string; icon: string; tokens: Token[] }
export interface Token { id: string; type: SectionType; path: string; label: string; leaf: Leaf; category: string; set: boolean }

/* ---------------- categories ---------------- */

type Rule = { id: string; label: string; icon: string; test: RegExp };
const RULES: Record<SectionType, Rule[]> = {
  'color-theme': [
    { id: 'scheme', label: 'Scheme', icon: 'sun', test: /^scheme$/ },
    { id: 'surfaces', label: 'Surfaces', icon: 'layers', test: /^tokens\.(bg|surface\d*|border)$/ },
    { id: 'text', label: 'Text', icon: 'type', test: /^tokens\.(text|muted)$/ },
    { id: 'accent', label: 'Accent', icon: 'star', test: /^tokens\.(accent\w*|focus)$/ },
    { id: 'status', label: 'Status', icon: 'alert', test: /^tokens\.(danger|success|warning|info)$/ },
    { id: 'effects', label: 'Effects', icon: 'eye', test: /^tokens\.shadow$/ },
  ],
  'style-theme': [
    { id: 'typography', label: 'Typography', icon: 'type', test: /^(font\w*|headingWeight|tracking)$/ },
    { id: 'spacing', label: 'Spacing', icon: 'sliders', test: /^(space|density)$/ },
    { id: 'shape', label: 'Shape', icon: 'box', test: /^(radius\.\w+|borderWidth)$/ },
    { id: 'depth', label: 'Depth', icon: 'layers', test: /^(shadow\.\w+|blur)$/ },
    { id: 'transparency', label: 'Transparency', icon: 'eye', test: /^opacity\w*$/ },
    { id: 'motion', label: 'Motion', icon: 'play', test: /^motion$/ },
    { id: 'layout', label: 'Layout', icon: 'layout', test: /^wrapGroups$/ },
  ],
};
const humanize = (k: string) => k.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^\w/, (c) => c.toUpperCase());

/** The category a token belongs to: the rule table, else its nested group (`radius.xl` → Radius), else Other. */
export function categoryOf(type: SectionType, path: string): { id: string; label: string; icon: string } {
  const r = RULES[type].find((x) => x.test.test(path));
  if (r) return { id: r.id, label: r.label, icon: r.icon };
  const dot = path.lastIndexOf('.');
  if (dot > 0) { const g = path.slice(0, dot); return { id: `group:${g}`, label: humanize(g.split('.').pop()!), icon: 'folder' }; }
  return { id: 'other', label: 'Other', icon: 'more' };
}

/* ---------------- every possible token ---------------- */

const isObj = (v: unknown): v is Data => !!v && typeof v === 'object' && !Array.isArray(v);

/** Deep union of objects: the first value seen for a key wins (later ones only fill what is missing). */
function fill(into: Data, from: Data): Data {
  const out: Data = { ...into };
  for (const [k, v] of Object.entries(from)) {
    if (isObj(v)) out[k] = fill(isObj(out[k]) ? (out[k] as Data) : {}, v);
    else if (!(k in out)) out[k] = structuredClone(v);
  }
  return out;
}

/** A default for a field the asset types name that no theme sets yet (only booleans can be guessed from the spec text). */
function specDefault(text: string): Json | undefined {
  if (/^\s*boolean/i.test(text)) return /default\s+true/i.test(text);
  const n = /^\s*number[^0-9-]*(-?\d+(?:\.\d+)?)/i.exec(text);
  return n ? Number(n[1]) : undefined;
}

/**
 * The data the editor walks: the draft first, then every field any known theme of the type has, then the asset
 * type's optional fields. `set` tells which paths the draft really has.
 */
export function everyToken(type: SectionType, spec: TypeSpec | undefined, draft: Data, known: { data: Data }[]): { data: Data; set: Set<string> } {
  let data = structuredClone(draft);
  for (const a of known) if (isObj(a.data)) data = fill(data, a.data);
  for (const [k, text] of Object.entries(spec?.optional_fields ?? {})) {
    if (!(k in data)) { const d = specDefault(text); if (d !== undefined) data[k] = d; }
  }
  const set = new Set<string>();
  const walk = (o: Data, prefix: string) => { for (const [k, v] of Object.entries(o)) { const p = prefix ? `${prefix}.${k}` : k; if (isObj(v)) walk(v, p); else set.add(p); } };
  walk(draft, '');
  void type;
  return { data, set };
}

/** A token's name: `tokens.surface2` → "Surface2", `radius.sm` → "Radius sm", `fontSize` → "Font Size". */
export function tokenLabel(path: string): string {
  const parts = path.split('.');
  const k = parts[parts.length - 1]!;
  const parent = parts.length > 1 ? parts[parts.length - 2]! : '';
  return !parent || parent === 'tokens' ? humanize(k) : `${humanize(parent)} ${k}`;
}

/** Tokens of one section, grouped into categories in rule-table order (unknown groups after, Other last). */
export function categories(tt: TokenTree, type: SectionType, specs: Record<string, TypeSpec>, draft: Data, known: { data: Data }[]): Category[] {
  const { data, set } = everyToken(type, specs[type], draft, known);
  const root = tt.buildTree(specs, { [type]: known }, { [type]: data }, [type])[0];
  if (!root) return [];
  const out = new Map<string, Category>();
  for (const n of tt.leaves(root)) {
    if (!n.leaf) continue;
    const c = categoryOf(type, n.leaf.path);
    if (!out.has(c.id)) out.set(c.id, { ...c, tokens: [] });
    out.get(c.id)!.tokens.push({ id: n.id, type, path: n.leaf.path, label: tokenLabel(n.leaf.path), leaf: n.leaf, category: c.id, set: set.has(n.leaf.path) });
  }
  const order = RULES[type].map((r) => r.id);
  const rank = (id: string) => (order.includes(id) ? order.indexOf(id) : id === 'other' ? 1e6 : 1e3);
  return [...out.values()].sort((a, b) => rank(a.id) - rank(b.id) || a.label.localeCompare(b.label));
}

/** Filter categories by a search (token label, path or category); empty categories drop out. */
export function filterCategories(cats: Category[], q: string): Category[] {
  const s = q.trim().toLowerCase();
  if (!s) return cats;
  return cats.map((c) => ({ ...c, tokens: c.label.toLowerCase().includes(s) ? c.tokens : c.tokens.filter((t) => t.label.toLowerCase().includes(s) || t.path.toLowerCase().includes(s)) })).filter((c) => c.tokens.length);
}

/* ---------------- drafts, diffs, assets ---------------- */

/** Paths whose values differ between two theme datas (over the given tokens). */
export function diffPaths(tt: TokenTree, a: Data, b: Data, tokens: Token[]): string[] {
  return tokens.filter((t) => JSON.stringify(tt.getAt(a, t.path) ?? null) !== JSON.stringify(tt.getAt(b, t.path) ?? null)).map((t) => t.path);
}

export const slug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);

/** A standard asset@1 theme for a draft. */
export function themeAsset(type: SectionType, name: string, data: Data, opts: { id?: string; tags?: string[]; from?: string } = {}) {
  const id = (opts.id ?? slug(name)) || `theme-${Date.now().toString(36)}`;
  return {
    $axf: 'asset@1' as const, type, id: id.slice(0, 60), name: name.trim() || id, version: '1.0.0',
    description: opts.from ? `Edited in the Theme editor from ${opts.from}` : 'Made in the Theme editor', author: 'Brett',
    tags: ['edited', ...(opts.tags ?? [])], data,
  };
}

/** Parse pasted / imported text into colour or style theme assets (one asset, an array, or {items}). Throws on nothing usable. */
export function parseThemes(text: string): ReturnType<typeof themeAsset>[] {
  const raw = JSON.parse(text) as unknown;
  const list = Array.isArray(raw) ? raw : isObj(raw) && Array.isArray((raw as { items?: unknown }).items) ? (raw as { items: unknown[] }).items : [raw];
  const out = list.filter((a): a is ReturnType<typeof themeAsset> => isObj(a) && a.$axf === 'asset@1' && (a.type === 'color-theme' || a.type === 'style-theme') && isObj(a.data) && typeof a.id === 'string');
  if (!out.length) throw new Error('No colour or style theme (asset@1) in that text');
  return out;
}
