/**
 * inline-edit-tokens@1 — the resolver (build inline-element-editing-plugin-right-click-any-el s1, Fable).
 *
 * For any element path and each of its parents: every settable token with its current value and where that value is
 * inherited from in axHub. The settable tokens ARE asset-customize@1's (framework/schemas/customize.json: text colour,
 * background, border, font, spacing, radius, icons, motion, hover, click…), filtered by the role of the element (a root
 * takes them all, an item drops location / width, a label takes the text and colour ones, an icon the icon ones), so
 * every value still maps to theme tokens and a theme swap restyles an edited element like everything else.
 *
 * Layers, lowest first (the next one up wins when it names the token):
 *   theme    the token's default = "leave it to the theme" (the active colour / style theme, from axHub's appearance slots)
 *   skin     skin@1 `parts[type]` in force at this place (axHub, the app's look document)
 *   custom   asset-customize@1 `axf.custom.<type>` (this device only since Nov 1 2026: retired from the hub)
 *   extra    host-provided tokens at a root (chrome-settings@1 instance fields, nav-style@1 fields), each with its own source
 *   inline   inline-override@1 records (overrides-store.mjs): `parent` scope on an ancestor, then `parent` on the path,
 *            then `item` on the path; nearest wins; a record for the active asset beats a general one at the same place
 *
 * `axHubValue` on every row is the value with the inline layer removed: what a reset goes back to. Pure: no DOM, no IO.
 * The host (runtime, plugin) supplies the sources. Kotlin twin deferred (framework/spec/PORTING.md).
 */
import { chainOf, isWithin, parsePath, roleOfPath, typeOfKind, ELEMENT_ROOTS, labelOfSegment } from './element-map.mjs';

/** Where a value comes from, by layer (the dialog's "inherited from" note). */
export const LAYER_WHERE = {
  theme: 'axHub · shared/settings/appearance.json · slots (design package, colour and style theme)',
  skin: 'axHub · shared/settings/looks/<app>.json · skin parts',
  custom: 'this device · axf.custom.<type> (Settings → Appearance → Assets; retired from axHub Nov 1 2026)',
  extra: 'see the token',
  inline: 'axHub · shared/settings/appearance.json · settings · axf.inline.<root>',
};
export const LAYERS = ['theme', 'skin', 'custom', 'extra', 'inline'];

/** Tokens each role gets, by customize group, and the single tokens dropped from it. Root = everything the type gets. */
export const ROLE_TOKENS = {
  root: { groups: null, drop: [] },
  group: { groups: ['Text', 'Colour', 'Layout', 'Shape', 'Icons', 'Motion'], drop: ['location', 'width'] },
  item: { groups: ['Text', 'Colour', 'Layout', 'Shape', 'Icons', 'Motion', 'Hover', 'Click'], drop: ['location', 'width', 'alignment'] },
  text: { groups: ['Text', 'Colour'], drop: ['glass', 'borderColor', 'textAlign'] },
  icon: { groups: ['Icons', 'Colour'], drop: ['glass', 'borderColor', 'showIcons'] },
  badge: { groups: ['Text', 'Colour', 'Shape'], drop: ['glass', 'textAlign', 'lineHeight'] },
  separator: { groups: [], keep: ['borderColor', 'opacity', 'borderWidth', 'padding', 'shadow'], drop: [] },
  part: { groups: ['Text', 'Colour', 'Shape'], drop: ['glass'] },
};

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The customize tokens an element of `role` under a root of asset `type` gets (spec = customize.json). */
export function tokensForRole(spec, type, role) {
  const all = Array.isArray(spec?.tokens) ? spec.tokens : [];
  const r = ROLE_TOKENS[role] ?? ROLE_TOKENS.part;
  return all.filter((t) => {
    if (t.types && type && !t.types.includes(type)) return false;
    if (t.types && !type) return false;
    if (r.keep) return r.keep.includes(t.key);
    if (r.groups && !r.groups.includes(t.group)) return false;
    return !r.drop.includes(t.key);
  });
}

/* ---------------- the inline layer ---------------- */

/**
 * The inline records in force at `path`, by token: `{ [token]: record }`. Candidates: `item` records on the path itself
 * and `parent` records on the path or any ancestor; a record with `asset` applies only while that asset is active.
 * Nearest wins (the path over its parent, item over parent at the same place, the asset's own over the general one).
 */
export function inlineLayer(records, path, activeAsset) {
  const out = {};
  if (!Array.isArray(records) || !path) return out;
  const depth = (p) => p.split('/').length;
  const rank = (r) => depth(r.path) * 4 + (r.scope === 'item' ? 2 : 0) + (r.asset ? 1 : 0);
  const fits = records.filter((r) => r && typeof r.path === 'string' && typeof r.token === 'string'
    && (r.scope === 'item' ? r.path === path : isWithin(path, r.path))
    && (!r.asset || r.asset === activeAsset));
  for (const r of fits) {
    const cur = out[r.token];
    if (!cur || rank(r) > rank(cur)) out[r.token] = r;
  }
  return out;
}

/** Every inline record that touches `path` or anything under it (the "what is changed here" list of a node). */
export const inlineUnder = (records, path) => (Array.isArray(records) ? records.filter((r) => r && typeof r.path === 'string' && isWithin(r.path, path)) : []);

/* ---------------- resolve ---------------- */

const src = (layer, more = {}) => ({ layer, where: LAYER_WHERE[layer], ...more });

/**
 * Resolve one path: `{ path, role, kind, instance, type, label, tokens }`. `sources`:
 *   spec                 customize.json ({ tokens, targets })
 *   overrides            inline-override@1 records (every root, or the root's own)
 *   active(type)         the active asset id of a slot (undefined when none)
 *   custom(type)         { values, shared } asset-customize@1 effective values for the active asset (optional)
 *   skinParts(type)      { values, skin } skin parts in force for the type (optional)
 *   extraTokens(node)    extra token rows at a root (chrome fields, nav-style…), each with its own `source` (optional)
 *   themeLabel()         a label for the theme layer ("hub-night · hub"), optional
 */
export function resolvePath(path, sources) {
  const p = parsePath(path);
  if (!p) return null;
  const role = roleOfPath(path);
  const kind = p.root.kind;
  const type = typeOfKind(kind);
  const active = type && typeof sources.active === 'function' ? sources.active(type) : undefined;
  const custom = type && typeof sources.custom === 'function' ? sources.custom(type) : null;
  const skin = type && typeof sources.skinParts === 'function' ? sources.skinParts(type) : null;
  const inline = inlineLayer(sources.overrides, path, active);
  const themeLabel = typeof sources.themeLabel === 'function' ? sources.themeLabel() : '';
  const last = p.segments.length ? p.segments[p.segments.length - 1] : { name: kind, id: p.root.instance };
  const node = { path, role, kind, instance: p.root.instance, type, label: labelOfSegment(last, kind), rootText: p.rootText, active };

  const rows = tokensForRole(sources.spec, type, role).map((t) => {
    let value = t.default;
    let source = src('theme', { detail: themeLabel, token: t.key });
    if (skin && isObj(skin.values) && skin.values[t.key] !== undefined) { value = skin.values[t.key]; source = src('skin', { skin: skin.skin ?? '', key: `parts.${type}.${t.key}` }); }
    if (custom && isObj(custom.values) && custom.values[t.key] !== undefined) { value = custom.values[t.key]; source = src('custom', { key: `axf.custom.${type}`, shared: custom.shared !== false, asset: active }); }
    const axHubValue = value;
    const axHubSource = source;
    const r = inline[t.key];
    if (r) { value = r.value; source = src('inline', { key: r.key ?? `axf.inline.${p.rootText}`, path: r.path, scope: r.scope, by: r.by, at: r.at, asset: r.asset, id: r.id }); }
    const row = { token: t.key, label: t.label, group: t.group, kind: t.kind, default: t.default, value, axHubValue, source, axHubSource, overridden: !!r };
    for (const k of ['options', 'min', 'max', 'step', 'unit']) if (t[k] !== undefined) row[k] = t[k];
    if (r && r.path !== path) row.overriddenAt = r.path; // a parent's override reaches this element
    return row;
  });

  if (!p.segments.length && typeof sources.extraTokens === 'function') {
    for (const x of sources.extraTokens(node) ?? []) {
      if (!x || typeof x.token !== 'string') continue;
      const r = inline[x.token];
      const base = { ...x, group: x.group ?? 'Asset', source: x.source ?? src('extra'), axHubValue: x.value, axHubSource: x.source ?? src('extra'), overridden: false };
      if (r) { base.value = r.value; base.source = src('inline', { key: r.key ?? `axf.inline.${p.rootText}`, path: r.path, scope: r.scope, by: r.by, at: r.at, id: r.id }); base.overridden = true; }
      rows.push(base);
    }
  }
  return { ...node, tokens: rows };
}

/**
 * The element and each of its parents, root first: `{ path, chain: [resolvePath(ancestor)…] }`. This is what the
 * inline-edit dialog shows as a tree (or a grid with expandable rows) and what the API answers for `get`.
 */
export function resolveElementTokens(path, sources) {
  const chain = chainOf(path);
  if (!chain.length) return null;
  const nodes = chain.map((p) => resolvePath(p, sources)).filter(Boolean);
  return { $axf: 'inline-edit-tokens@1', path, root: nodes[0]?.rootText ?? null, chain: nodes };
}

/** Every root kind the contract addresses, with its label and asset type (for the overrides list's root tabs). */
export const rootKinds = () => Object.entries(ELEMENT_ROOTS).map(([kind, s]) => ({ kind, label: s.label, type: s.type }));
