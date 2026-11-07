/**
 * Icon maps (icon-map@1) + icon sources (icon-source@1): the TypeScript face of iconmap-rules.mjs (the one copy the
 * build engine, the console server scripts and the CLI share). This file adds only what needs the asset registry: the
 * chain of maps in force for a place in an app, the glyph lookup over icon-pack assets, and the icon names an app uses.
 *
 * Fixture spec/fixtures/icon-map.json, checker spec/check-icon-map.mjs. Kotlin twin deferred (spec/PORTING.md).
 */
import {
  ICON_LIBRARY_CONTRACT, ICON_MAP_CONTRACT, ICON_MAP_KEY, ICON_MAP_LIMITS, ICON_MAP_TYPE, ICON_PACK_KEY, ICON_SETTING_PREFIX, ICON_SLOTS_KEY, ICON_SOURCE_CONTRACT, ICON_SOURCE_TYPE,
  allIcons, explainIcons, foldIconMap, generateCohesiveMap, iconMapErrors, iconRef, iconScopeChain, iconScopeKey, iconScopeKind, iconSourceErrors, iconSourceKinds, iconSynonymTable, iconSynonyms,
  matchGlyph, normalizeIconMap, normalizeIconSource, normalizeScope, parseIconRef, randomizeMap, registerIconSourceKind, registerIconSynonyms, resolveIcon, seededRandom,
  type IconLookup, type IconMapData, type IconMapLink, type IconRef, type IconResolution, type IconScope, type IconScopeKind, type IconSourceData, type IconSourceKind, type IconVia,
} from './iconmap-rules.mjs';
import { normalizeIconPack } from './brand-rules.mjs';

export {
  ICON_LIBRARY_CONTRACT, ICON_MAP_CONTRACT, ICON_MAP_KEY, ICON_MAP_LIMITS, ICON_MAP_TYPE, ICON_PACK_KEY, ICON_SETTING_PREFIX, ICON_SLOTS_KEY, ICON_SOURCE_CONTRACT, ICON_SOURCE_TYPE,
  allIcons, explainIcons, foldIconMap, generateCohesiveMap, iconMapErrors, iconRef, iconScopeChain, iconScopeKey, iconScopeKind, iconSourceErrors, iconSourceKinds, iconSynonymTable, iconSynonyms,
  matchGlyph, normalizeIconMap, normalizeIconSource, normalizeScope, parseIconRef, randomizeMap, registerIconSourceKind, registerIconSynonyms, resolveIcon, seededRandom,
};
export type { IconLookup, IconMapData, IconMapLink, IconRef, IconResolution, IconScope, IconScopeKind, IconSourceData, IconSourceKind, IconVia };

/** The least a registry needs to offer: assets by type and id, and every asset of a type. */
export interface IconRegistryLike {
  get(type: string, id: string): { id: string; data: unknown } | undefined;
  list(type: string): { id: string; data: unknown }[];
}
/** The least a settings store needs to offer. */
export interface IconSettingsLike { get(key: string): unknown }

/** A glyph lookup over the registry's icon packs (normalised once per pack per call batch). */
export function packLookup(registry: IconRegistryLike, brandingPack = ''): IconLookup {
  const cache = new Map<string, Record<string, unknown> | null>();
  const glyphsOf = (packId: string) => {
    if (!cache.has(packId)) { const a = registry.get('icon-pack', packId); cache.set(packId, a ? normalizeIconPack(a.data).glyphs : null); }
    return cache.get(packId);
  };
  return { hasGlyph: (packId, glyph) => !!glyphsOf(packId)?.[glyph], brandingPack };
}

/**
 * The maps in force for a place in an app, most specific first. For every scope key in the chain: the slot overrides
 * saved in settings (`axf.icons.slots.<key>`), then the map asset picked in settings (`axf.icons.map.<key>`) folded
 * with what it extends, then a pack picked without a map (`axf.icons.pack.<key>`), then any shipped icon-map asset
 * whose scope matches (an app's own defaults). The result feeds `resolveIcon`.
 */
export function iconChain(scope: Partial<IconScope>, registry: IconRegistryLike, settings: IconSettingsLike): IconMapLink[] {
  const full = normalizeScope(scope);
  const maps = registry.list(ICON_MAP_TYPE);
  const byId: Record<string, { data?: unknown }> = {};
  for (const m of maps) byId[m.id] = m;
  const out: IconMapLink[] = [];
  const keys = iconScopeChain(full);
  for (const key of keys) {
    const slots = settings.get(ICON_SLOTS_KEY(key));
    if (slots && typeof slots === 'object' && !Array.isArray(slots) && Object.keys(slots as object).length) out.push({ id: `settings:${key}`, data: { scope: scopeFor(full, key), slots: {} }, slots: slots as Record<string, unknown> });
    const pick = settings.get(ICON_MAP_KEY(key));
    if (typeof pick === 'string' && pick && byId[pick]) { const folded = foldIconMap(pick, byId); if (folded) out.push({ id: pick, data: folded }); }
    const pack = settings.get(ICON_PACK_KEY(key));
    if (typeof pack === 'string' && pack && registry.get('icon-pack', pack)) out.push({ id: `pack:${key}`, data: { scope: scopeFor(full, key), pack, slots: {} } });
    for (const m of maps) {
      if (m.id === pick) continue;
      const d = normalizeIconMap(m.data);
      if (iconScopeKey(d.scope) !== key) continue;
      if (key === 'app' && d.scope.app && full.app && d.scope.app !== full.app) continue;
      const folded = foldIconMap(m.id, byId);
      if (folded) out.push({ id: m.id, data: folded });
    }
  }
  return out;
}

function scopeFor(full: IconScope, key: string): IconScope {
  if (key.startsWith('plugin:')) return { app: full.app, ui: '', plugin: key.slice(7) };
  if (key.startsWith('ui:')) return { app: full.app, ui: key.slice(3), plugin: '' };
  return { app: full.app, ui: '', plugin: '' };
}

/** Resolve one name for a place in an app: chain + lookup in one call. */
export function resolveIconIn(name: string, scope: Partial<IconScope>, registry: IconRegistryLike, settings: IconSettingsLike, brandingPack = ''): IconResolution {
  return resolveIcon(name, iconChain(scope, registry, settings), packLookup(registry, brandingPack));
}

/** Every icon-map asset grouped by app → [{ app, maps: [{ id, kind, scopeKey, slots, pack }] }] for the manager's list. */
export function iconMapIndex(registry: IconRegistryLike): { app: string; maps: { id: string; kind: IconScopeKind; scopeKey: string; slots: number; pack: string; extends: string }[] }[] {
  const byApp = new Map<string, { id: string; kind: IconScopeKind; scopeKey: string; slots: number; pack: string; extends: string }[]>();
  for (const m of registry.list(ICON_MAP_TYPE)) {
    const d = normalizeIconMap(m.data);
    const app = d.scope.app || '(any app)';
    if (!byApp.has(app)) byApp.set(app, []);
    byApp.get(app)!.push({ id: m.id, kind: iconScopeKind(d.scope), scopeKey: iconScopeKey(d.scope), slots: Object.keys(d.slots).length, pack: d.pack, extends: d.extends });
  }
  return [...byApp.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([app, maps]) => ({ app, maps: maps.sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0)) }));
}

/** A map asset envelope (asset@1) for saving a generated or edited map. */
export function iconMapAsset(id: string, name: string, data: Partial<IconMapData>, description = ''): { $axf: 'asset@1'; type: 'icon-map'; id: string; name: string; version: string; description: string; author: string; tags: string[]; data: IconMapData } {
  const d = normalizeIconMap(data);
  return { $axf: 'asset@1', type: ICON_MAP_TYPE, id, name, version: '1.0.0', description: description || `Icon map for ${iconScopeKey(d.scope)}${d.scope.app ? ` in ${d.scope.app}` : ''}: ${Object.keys(d.slots).length} slot(s)${d.pack ? `, pack ${d.pack}` : ''}.`, author: 'AmberX AXF', tags: d.tags.length ? d.tags : ['icon-map'], data: d };
}
