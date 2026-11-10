/**
 * skin@2 + app-look@1 (build skins, Nov 2026; coverage, parts, icon pack and scopes added by build skins-asset-types,
 * Fable, Nov 7 2026; sections and the end of design packs by build appearance-skins-colour-themes-only, Fable, Nov 10 2026).
 *
 * A skin (asset type `skin`) is the whole look of a place (Brett, Nov 9 2026: "remove design packs as a thing since
 * everything's covered in a skin"). It has four SECTIONS, kept apart so the Skin Designer can edit each on its own:
 *
 *   colours    `colorTheme`    → a colour section preset (asset type `color-theme`)     or `sections.colors` inline
 *   style      `styleTheme`    → a style section preset (asset type `style-theme`)      or `sections.style` inline
 *   layout     `layoutTheme`   → a layout section preset (asset type `layout`)           or `sections.layout` inline
 *   behaviour  `behaviorTheme` → a behaviour section preset (asset type `behavior-theme`) or `sections.behavior` inline
 *
 * and the `assets` that fill every other slot (title bar, menus, context menus, toolbars, dialogs, buttons, nav menu,
 * the scale assets …). The section asset types are no longer picked anywhere on their own: they are the skin's
 * section presets (the library the Skin Designer offers), read through the skin. An inline section is the section's
 * data written in the skin itself; the runtime registers it as a preset named after the skin (`skinSectionAssets`).
 * A skin MAY name an icon pack (`iconPack`) and MAY carry style `parts` for any type that has a style target (customize
 * engine), so it reaches widgets, badges, labels and every other drawn piece — the registry says how each type is
 * covered (`skin-coverage.mjs`, `skinCoverage()`), and CI fails on a type it can't reach.
 *
 * Design packages (design-package@1) and style packages (style-package@1) were folded into skins: every former
 * package is now a skin with the same id (`skinFromDesignPackage`, `skinFromStylePackage` did the one-time conversion),
 * so every reference to one keeps resolving (an old `design-package` slot or `axf.appearance.design` setting reads as
 * that skin: `migrateLegacyLook`).
 *
 * app-look@1 is one app's look on the hub (`shared/settings/looks/<app>.json`): the snapshot of its default, its own
 * picks over that default, its skin switch, and a skin state per UI / plugin. It is what keeps apps apart (Brett,
 * Nov 4 2026: "by default they're all their own"): the shared appearance@1 document stays the transport and the
 * source of shared token overrides (and of the hub-wide skin, `skin` on that document), but an app's slots, spacing
 * and chrome come from its own document, which only that app writes.
 *
 *   effective look at a place = default snapshot + own picks                        (no skin in the chain)
 *                             = that + the skin in force + the chain's overrides     (plugin → ui → app → global)
 *
 * Pure and port-neutral; Kotlin twin deferred (spec/PORTING.md, "skin@2 + app-look@1").
 */
import type { AppearanceChange, AppearanceDocument } from './appearance';
import { APPEARANCE_FRAME } from './appearance';
import type { AssetEnvelope } from '../types';
import { spacingOf } from './spacing';
import { CUSTOM_TARGETS, customizable, normalizeCustomValues, type CustomValues } from './customize';
import { behaviorErrors, normalizeBehavior } from './behavior';
import { layoutErrors } from './layout-rules.mjs';
import spec from '../../schemas/asset-types.json';
import { SKIN_NEVER, SKIN_SECTIONS, isSkinSectionType, normalizeLookPart, resolveLookSkin, sectionOfType, type AppLookDocument, type GlobalSkin, type LookPart, type SkinSection } from './skin-rules.mjs';
import { coverageSummary, coverageTable, partsErrors, partsTypes, skinScopeKey, uncoveredTypes, type CoverageRow, type CoverageSummary, type ResolvedSkin, type SkinScope, type TypeSpecs } from './skin-coverage.mjs';

export { APP_LOOK_FRAME, APP_LOOK_MAX_BYTES, APP_LOOK_PROJECT, SKIN_NEVER, SKIN_SECTIONS, SKIN_USES, appLookPath, backToSkin, isSkinSectionType, migrateLegacyLook, newAppLook, normalizeAppLook, normalizeScopeState, overriddenSlots, parseAppLook, pickSkin, resolveLookSkin, restoreAppDefault, scopeEntries, scopeState, sectionOfType, setInheritSkin, setScopeOverride, setScopeSkin, setUseSkin, undoRestore } from './skin-rules.mjs';
export type { AppLookDocument, AppSkinState, GlobalSkin, LookPart, SkinSection } from './skin-rules.mjs';
// named, not `export *`: tsx links a star re-export of a .mjs module as empty when the importer is a .mts file
export { COVERAGE_KINDS, PART_ELEMENTS, SKIN_COVERAGE_CONTRACT, SKIN_SCOPE_APP, SKIN_SCOPE_GLOBAL, SKIN_SCOPE_KINDS, coverageOf, coverageSummary, coverageTable, declarationErrors, declaredCoverage, isSubScopeKey, normalizeSkinScope, partElements, partsErrors, partsTypes, resolveSkinChain, skinScopeChain, skinScopeDomId, skinScopeKey, skinScopeKind, skinScopeOf, skinScopeSelector, uncoveredTypes } from './skin-coverage.mjs';
export type { CoverageKind, CoverageRow, CoverageSummary, PartElement, ResolvedSkin, SkinScope, SkinScopeKind, SkinScopeState, StyleTargets, TypeSpecs } from './skin-coverage.mjs';

export const SKIN_TYPE = 'skin';
export const SKIN_FRAME = 'skin@2';
/** Setting keys of a shared document that still reach every app: control@1 token overrides. */
export const SHARED_SETTING_PREFIXES: readonly string[] = ['axf.tokens.'];
/** `axf.icons.pack.<scopeKey>` = the icon pack a skin puts in force at a scope (the icon-map engine's own key, so icon maps read it as the scope's pack). */
export const SKIN_ICON_PACK_KEY = (scopeKey: string): string => `axf.icons.pack.${scopeKey}`;
/** The retired design-package@1 setting (`axf.appearance.design`): read once by `migrateLegacyLook`, never written. */
export const LEGACY_DESIGN_APPLIED_KEY = 'axf.appearance.design';
/** The retired precedence overrides of design-package@1; a document still carrying them is cleaned once. */
export const LEGACY_DESIGN_OVERRIDES_KEY = 'axf.appearance.overrides';
/** The retired asset types a skin replaced; a slot or reference naming one is an alias for the skin of the same id. */
export const RETIRED_PACKAGE_TYPES: readonly string[] = ['design-package', 'style-package', 'appearance-package'];

/** The skin field that names each section's preset. */
export const SKIN_SECTION_FIELDS = { colors: 'colorTheme', style: 'styleTheme', layout: 'layoutTheme', behavior: 'behaviorTheme' } as const;
export type SkinSectionField = (typeof SKIN_SECTION_FIELDS)[SkinSection];

export interface SkinExtras { spacing?: string; hidden?: Record<string, boolean>; settings?: Record<string, unknown> }
export interface SkinData {
  /** Layout section preset (asset type `layout`). */
  layoutTheme: string;
  /** Colour section preset (asset type `color-theme`). */
  colorTheme: string;
  /** Style section preset (asset type `style-theme`). */
  styleTheme: string;
  /** Behaviour section preset (asset type `behavior-theme`); '' = the framework's standard behaviour. */
  behaviorTheme: string;
  /** Inline sections: a section's data written in the skin; wins over the preset named for that section. */
  sections?: Partial<Record<SkinSection, Record<string, unknown>>>;
  /** Appearance slot → asset id, for everything but the four sections. */
  assets: Record<string, string>;
  /** The icon pack the skin draws its icons from (icon-pack asset id); absent = the branding's. */
  iconPack?: string;
  /** Style parts per asset type (customize tokens): how the type's box, text, icon and items look under this skin. */
  parts?: Record<string, CustomValues>;
  /** Shown in the picker; swatches are drawn from the skin's colour section. */
  preview?: { caption?: string; image?: string };
  /** Spacing and chrome the skin needs shown or hidden. */
  extras?: SkinExtras;
}
/** Where an app's app-look document is kept: the hub, or a setting without one. `failed` = unreadable: nothing is written. */
export interface AppLookStore {
  get(): AppLookDocument | null;
  status(): 'loading' | 'ready' | 'missing' | 'failed';
  save(doc: AppLookDocument): void;
  subscribe(fn: () => void): () => void;
}
/** One row of the Skin picker. */
export interface SkinEntry { id: string; name: string; kind: 'skin'; description: string; tags: string[]; data: SkinData }
/** What a place in an app draws: the composed document, the skin's parts and which level decided. */
export interface ComposedLook { doc: AppearanceDocument; parts: Record<string, CustomValues>; skin: ResolvedSkin; scopeKey: string }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const ID = /^[a-z0-9][a-z0-9-]*$/;
const TYPE_SPECS = spec.types as unknown as TypeSpecs;
type SectionSpec = { required?: string[]; enums?: Record<string, string[]>; nested?: Record<string, string[]> };
const SECTION_TYPES = Object.values(SKIN_SECTIONS) as string[];

/** The parts of a document a snapshot keeps (never the palette or who saved it). */
export function snapshotLook(doc: AppearanceDocument | null): LookPart {
  return normalizeLookPart(doc ?? {});
}

function idMap(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (isObj(raw)) for (const [k, v] of Object.entries(raw)) if (ID.test(k) && typeof v === 'string' && ID.test(v) && !SKIN_NEVER.includes(k) && !RETIRED_PACKAGE_TYPES.includes(k)) out[k] = v;
  return out;
}
function boolMap(raw: unknown): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  if (isObj(raw)) for (const [k, v] of Object.entries(raw)) if (typeof v === 'boolean') out[k] = v;
  return out;
}
/** Parts kept: registered types with a style target, values checked against the type's tokens (a type left with nothing is dropped). */
function partsMap(raw: unknown): Record<string, CustomValues> {
  const out: Record<string, CustomValues> = {};
  if (isObj(raw)) for (const [t, v] of Object.entries(raw)) {
    if (!TYPE_SPECS[t] || !customizable(t) || !isObj(v)) continue;
    const n = normalizeCustomValues(v, t);
    if (Object.keys(n).length) out[t] = n;
  }
  return out;
}
/** Inline sections kept: known section names with object data (validated by `skinErrors`, not reshaped here). */
function sectionsMap(raw: unknown): Partial<Record<SkinSection, Record<string, unknown>>> {
  const out: Partial<Record<SkinSection, Record<string, unknown>>> = {};
  if (isObj(raw)) for (const s of Object.keys(SKIN_SECTIONS) as SkinSection[]) if (isObj(raw[s])) out[s] = JSON.parse(JSON.stringify(raw[s])) as Record<string, unknown>;
  return out;
}

/** Keep only what skin@2 holds; a malformed field is dropped, never a crash. */
export function normalizeSkin(raw: unknown): SkinData {
  const d = isObj(raw) ? raw : {};
  const id = (k: string) => (typeof d[k] === 'string' && ID.test(d[k] as string) ? (d[k] as string) : '');
  const assets = idMap(d.assets);
  // skin@1 kept the behaviour in `assets["behavior-theme"]`: it is the behaviour section now
  const behaviorTheme = id('behaviorTheme') || (ID.test(assets['behavior-theme'] ?? '') ? assets['behavior-theme']! : '');
  for (const t of SECTION_TYPES) delete assets[t];
  const out: SkinData = { layoutTheme: id('layoutTheme'), colorTheme: id('colorTheme'), styleTheme: id('styleTheme'), behaviorTheme, assets };
  const sections = sectionsMap(d.sections);
  if (Object.keys(sections).length) out.sections = sections;
  if (typeof d.iconPack === 'string' && ID.test(d.iconPack)) out.iconPack = d.iconPack;
  const parts = partsMap(d.parts);
  if (Object.keys(parts).length) out.parts = parts;
  if (isObj(d.preview)) {
    const p: NonNullable<SkinData['preview']> = {};
    if (typeof d.preview.caption === 'string') p.caption = d.preview.caption.slice(0, 200);
    if (typeof d.preview.image === 'string') p.image = d.preview.image.slice(0, 500);
    out.preview = p;
  }
  if (isObj(d.extras)) {
    const x: SkinExtras = {};
    if (typeof d.extras.spacing === 'string' && spacingOf(d.extras.spacing) === d.extras.spacing) x.spacing = d.extras.spacing;
    if (isObj(d.extras.hidden)) x.hidden = boolMap(d.extras.hidden);
    if (isObj(d.extras.settings)) x.settings = { ...d.extras.settings };
    out.extras = x;
  }
  return out;
}

/** The registry's shape rules for one section type (required fields, enums, nested keys), the same as validateAsset applies. */
function sectionSpecErrors(type: string, data: unknown, at: string): string[] {
  const ts = (TYPE_SPECS as unknown as Record<string, SectionSpec>)[type];
  if (!isObj(data)) return [`${at} must be an object (${type} data)`];
  const errors: string[] = [];
  for (const k of ts?.required ?? []) if (!(k in data)) errors.push(`${at}.${k} is required for ${type}`);
  for (const [k, allowed] of Object.entries(ts?.enums ?? {})) if (k in data && !allowed.includes(data[k] as string)) errors.push(`${at}.${k} must be one of: ${allowed.join(', ')}`);
  for (const [k, keys] of Object.entries(ts?.nested ?? {})) if (isObj(data[k])) for (const nk of keys) if (!(nk in (data[k] as Record<string, unknown>))) errors.push(`${at}.${k}.${nk} is required`);
  return errors;
}

/** Validation messages for one inline section (`sections.<name>`): the section type's own validator. */
export function skinSectionErrors(section: string, data: unknown): string[] {
  const type = (SKIN_SECTIONS as Record<string, string>)[section];
  const at = `data.sections.${section}`;
  if (!type) return [`${at}: not a skin section (${Object.keys(SKIN_SECTIONS).join(', ')})`];
  if (!isObj(data)) return [`${at} must be an object (${type} data)`];
  // the behaviour section is as lenient as its engine (every field has a default); the others follow the registry's shape rules
  const errors = type === 'behavior-theme' ? behaviorErrors(data).map((e) => `${at}: ${e}`) : sectionSpecErrors(type, data, at);
  if (type === 'layout') errors.push(...layoutErrors('layout', data).map((e: string) => `${at}: ${e}`));
  return errors;
}

/** Validation messages for a skin's data (validators call it for type `skin`). */
export function skinErrors(raw: unknown): string[] {
  if (!isObj(raw)) return ['data must be an object'];
  const errors: string[] = [];
  const sections = isObj(raw.sections) ? raw.sections : {};
  for (const [s, field] of Object.entries(SKIN_SECTION_FIELDS) as [SkinSection, string][]) {
    const t = SKIN_SECTIONS[s];
    const v = raw[field];
    const inline = isObj(sections[s]);
    if (s === 'behavior' && (v === undefined || v === '')) continue; // the behaviour section defaults to the framework standard
    if (v === undefined && inline) continue; // the section is written in the skin instead of a preset
    if (typeof v !== 'string' || !ID.test(v)) errors.push(`data.${field} must be a ${t} asset id${s === 'behavior' ? '' : ` (or write data.sections.${s})`}`);
  }
  if ('sections' in raw) {
    if (!isObj(raw.sections)) errors.push('data.sections must be an object (colors, style, layout, behavior)');
    else for (const [s, d] of Object.entries(raw.sections)) errors.push(...skinSectionErrors(s, d));
  }
  if (!isObj(raw.assets)) errors.push('data.assets must be an object (slot → asset id)');
  else for (const [t, id] of Object.entries(raw.assets)) {
    if (RETIRED_PACKAGE_TYPES.includes(t)) errors.push(`data.assets.${t}: ${t} is retired, a skin carries its slots itself`);
    else if (SKIN_NEVER.includes(t) || (SECTION_TYPES.includes(t) && t !== 'behavior-theme')) errors.push(`data.assets.${t}: a skin never sets ${t} here`);
    else if (typeof id !== 'string' || !ID.test(id)) errors.push(`data.assets.${t} must be an asset id`);
  }
  if (raw.iconPack !== undefined && (typeof raw.iconPack !== 'string' || !ID.test(raw.iconPack))) errors.push('data.iconPack must be an icon-pack asset id');
  errors.push(...partsErrors(raw.parts, TYPE_SPECS, CUSTOM_TARGETS));
  if ('preview' in raw && !isObj(raw.preview)) errors.push('data.preview must be an object');
  if ('extras' in raw) {
    const x = raw.extras;
    if (!isObj(x)) errors.push('data.extras must be an object');
    else {
      if ('spacing' in x && (typeof x.spacing !== 'string' || spacingOf(x.spacing) !== x.spacing)) errors.push('data.extras.spacing must be tight, compact or regular');
      if ('hidden' in x && (!isObj(x.hidden) || Object.values(x.hidden).some((v) => typeof v !== 'boolean'))) errors.push('data.extras.hidden must map asset types to true / false');
      if ('settings' in x && !isObj(x.settings)) errors.push('data.extras.settings must be an object');
    }
  }
  return errors;
}

/** The preset id of an inline section: the skin's own name as a section asset (`skin-<skin id>`). */
export const inlineSectionId = (skinId: string): string => `skin-${skinId}`;

/**
 * The section assets an inline-sectioned skin brings: one `<section type>/skin-<skin id>` per inline section, so the
 * runtime registers them and the slots point at them. Empty for a skin that only names presets.
 */
export function skinSectionAssets(skinId: string, skin: SkinData, name = skinId): AssetEnvelope<Record<string, unknown>>[] {
  const out: AssetEnvelope<Record<string, unknown>>[] = [];
  for (const [s, raw] of Object.entries(skin.sections ?? {}) as [SkinSection, Record<string, unknown>][]) {
    const data = s === 'behavior' ? (normalizeBehavior(raw) as unknown as Record<string, unknown>) : raw; // a behaviour section may set only what it changes
    out.push({ $axf: 'asset@1', type: SKIN_SECTIONS[s], id: inlineSectionId(skinId), name: `${name} (${s} section)`, version: '1.0.0', description: `The ${s} section written in skin ${skinId}.`, author: 'skin', tags: ['skin-section', skinId], data } as AssetEnvelope<Record<string, unknown>>);
  }
  return out;
}

/** The preset id in force for one section: the inline section (as `skin-<id>`) when written, else the named preset ('' = default). */
export function skinSectionId(skin: SkinData, section: SkinSection, skinId = ''): string {
  if (skin.sections?.[section] && skinId) return inlineSectionId(skinId);
  return skin[SKIN_SECTION_FIELDS[section]] ?? '';
}

/** Every slot a skin sets, sections included. Empty ids are skipped. `skinId` names the skin, so inline sections resolve. */
export function skinSlots(skin: SkinData, skinId = ''): Record<string, string> {
  const out = { ...skin.assets };
  for (const t of SECTION_TYPES) delete out[t];
  for (const [s, t] of Object.entries(SKIN_SECTIONS) as [SkinSection, string][]) { const v = skinSectionId(skin, s, skinId); if (v) out[t] = v; }
  return out;
}

/* ---------------- conversion: design packages and style packages became skins (Nov 10 2026) ---------------- */

/** What a design package (design-package@1) held. */
export interface LegacyDesignPackage { 'style-theme'?: string; 'color-theme'?: string; layout?: string; 'behavior-theme'?: string; extras?: { slots?: Record<string, string>; spacing?: string; hidden?: Record<string, boolean>; settings?: Record<string, unknown> } }

/**
 * A design package read as a skin (the one-time conversion; also how an old package document is understood):
 * its four themes are the four sections, `extras.slots` the assets, `extras` spacing / hidden / settings the skin's
 * extras. A `style-package` among the slots is expanded through `stylePackageSlots` (its member controls become
 * assets; the package's own slots win), since style packages are retired too.
 */
export function skinFromDesignPackage(raw: unknown, stylePackageSlots: (id: string) => Record<string, string> | null = () => null): SkinData {
  const p = (isObj(raw) ? raw : {}) as LegacyDesignPackage;
  const id = (v: unknown) => (typeof v === 'string' && ID.test(v) ? v : '');
  const x = isObj(p.extras) ? p.extras : {};
  const slots: Record<string, string> = {};
  const pack = id(x.slots?.['style-package']);
  if (pack) Object.assign(slots, stylePackageSlots(pack) ?? {});
  for (const [t, v] of Object.entries(x.slots ?? {})) if (!RETIRED_PACKAGE_TYPES.includes(t) && !SECTION_TYPES.includes(t) && id(v)) slots[t] = v;
  const skin: SkinData = { layoutTheme: id(p.layout), colorTheme: id(p['color-theme']), styleTheme: id(p['style-theme']), behaviorTheme: id(p['behavior-theme']), assets: idMap(slots) };
  if (x.spacing || x.hidden || x.settings) skin.extras = { ...(x.spacing && spacingOf(x.spacing) === x.spacing ? { spacing: x.spacing } : {}), ...(isObj(x.hidden) ? { hidden: boolMap(x.hidden) } : {}), ...(isObj(x.settings) ? { settings: { ...x.settings } } : {}) };
  return skin;
}

/** A style package (style-package@1: one matched set of controls) read as a skin over the default look `base`. */
export function skinFromStylePackage(raw: unknown, base: SkinData): SkinData {
  const d = isObj(raw) ? raw : {};
  const members = idMap(d.slots);
  const skin: SkinData = { ...base, assets: { ...base.assets, ...members } };
  delete skin.sections; delete skin.parts; delete skin.iconPack; delete skin.preview;
  return skin;
}

/** The Skin picker's list. */
export function skinEntries(skins: readonly { id: string; name: string; description?: string; tags?: string[]; data: unknown }[]): SkinEntry[] {
  return skins.map((a) => ({ id: a.id, name: a.name, kind: 'skin', description: a.description ?? '', tags: Array.isArray(a.tags) ? a.tags.filter((t): t is string => typeof t === 'string') : [], data: normalizeSkin(a.data) }));
}

/** What capturing the current look as a skin needs from the runtime. */
export interface SkinCaptureEnv {
  active: Record<string, string | undefined>;
  types: readonly string[];
  spacing: string;
  /** hidden overrides the user saved (type → bool) */
  hidden: Record<string, boolean>;
  /** every saved settings key → value */
  values: Record<string, unknown>;
  /** which settings keys count as look settings */
  isLookSetting: (key: string) => boolean;
}

/** The current look as a skin: the four section presets in force, every other slot as an asset, spacing, chrome and look settings as extras. */
export function captureSkin(env: SkinCaptureEnv): SkinData {
  const assets: Record<string, string> = {};
  for (const t of env.types) if (!SECTION_TYPES.includes(t) && !SKIN_NEVER.includes(t) && !RETIRED_PACKAGE_TYPES.includes(t) && env.active[t]) assets[t] = env.active[t]!;
  const settings: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(env.values).sort(([a], [b]) => a.localeCompare(b))) if (env.isLookSetting(k) && v !== undefined && v !== null) settings[k] = v;
  return {
    layoutTheme: env.active.layout ?? '', colorTheme: env.active['color-theme'] ?? '', styleTheme: env.active['style-theme'] ?? '', behaviorTheme: env.active['behavior-theme'] ?? '',
    assets, extras: { spacing: env.spacing, hidden: { ...env.hidden }, settings },
  };
}

/* ---------------- coverage: how a skin reaches every registered type ---------------- */

/** Every registered asset type with how a skin covers it (registry order, read from asset-types.json + the style targets). */
export function skinCoverage(): CoverageRow[] { return coverageTable(TYPE_SPECS, CUSTOM_TARGETS, SKIN_NEVER); }
/** The types a skin can't reach (CI fails on any). */
export function skinUncovered(): CoverageRow[] { return uncoveredTypes(TYPE_SPECS, CUSTOM_TARGETS, SKIN_NEVER); }
/** Counts per kind. */
export function skinCoverageSummary(): CoverageSummary { return coverageSummary(skinCoverage()); }
/** The types a skin's `parts` may style. */
export function skinPartsTypes(): string[] { return partsTypes(TYPE_SPECS, CUSTOM_TARGETS); }
/** What one skin covers, type by type: `covered` = it sets or styles that type; `how` = the means it uses. */
export function skinCovers(skin: SkinData, skinId = ''): { type: string; by: CoverageRow['by']; covered: boolean; how: string[] }[] {
  const slots = skinSlots(skin, skinId);
  return skinCoverage().map((r) => {
    const how: string[] = [];
    if (slots[r.type]) how.push(isSkinSectionType(r.type) ? `${sectionOfType(r.type)} section ${skin.sections?.[sectionOfType(r.type) as SkinSection] ? 'written in the skin' : slots[r.type]}` : `slot ${slots[r.type]}`);
    if (skin.parts?.[r.type]) how.push(`parts ${Object.keys(skin.parts[r.type]!).join(', ')}`);
    if (r.by === 'reference' && r.via === 'iconPack' && skin.iconPack) how.push(`iconPack ${skin.iconPack}`);
    if (r.by === 'reference' && r.via && r.via !== 'iconPack' && slots[r.via]) how.push(`via ${r.via} ${slots[r.via]}`);
    if (r.by === 'bundle') how.push('the skin itself');
    if (r.by === 'none') how.push('no look');
    return { type: r.type, by: r.by, covered: r.by !== 'none' && how.length > 0, how };
  });
}

/* ---------------- composing ---------------- */

/** The hub-wide skin a shared document carries (null = none). */
export function globalSkinOf(shared: AppearanceDocument | null | undefined): GlobalSkin | null {
  const s = (shared as { skin?: unknown } | null | undefined)?.skin;
  if (!isObj(s) || typeof s.id !== 'string' || !ID.test(s.id)) return null;
  return { id: s.id, overrides: idMap(s.overrides) };
}

/** The document for a look with `skin` on (or none) and `overrides` over it; `scopeKey` names where the icon pack lands. */
function composeWith(shared: AppearanceDocument | null, look: AppLookDocument, skin: SkinData | null, skinId: string, overrides: Record<string, string>, scopeKey: string): AppearanceDocument {
  const slots = { ...look.default.slots, ...look.own.slots };
  const hidden = { ...look.default.hidden, ...look.own.hidden };
  let spacing = look.own.spacing ?? look.default.spacing;
  const settings: Record<string, unknown> = { ...look.default.settings, ...look.own.settings };
  for (const [k, v] of Object.entries(shared?.settings ?? {})) if (SHARED_SETTING_PREFIXES.some((p) => k.startsWith(p))) settings[k] = v;
  if (skin) {
    Object.assign(slots, skinSlots(skin, skinId), overrides);
    if (skin.extras?.spacing) spacing = skin.extras.spacing;
    Object.assign(hidden, skin.extras?.hidden);
    Object.assign(settings, skin.extras?.settings);
    if (skin.iconPack) settings[SKIN_ICON_PACK_KEY(scopeKey)] = skin.iconPack;
  }
  for (const t of RETIRED_PACKAGE_TYPES) delete slots[t];
  delete settings[LEGACY_DESIGN_OVERRIDES_KEY];
  delete settings[LEGACY_DESIGN_APPLIED_KEY];
  for (const [k, v] of Object.entries(settings)) if (v === null) delete settings[k];
  const out: AppearanceDocument = { $axf: APPEARANCE_FRAME, slots, hidden, settings: settings as AppearanceDocument['settings'] };
  if (spacing) out.spacing = spacing as AppearanceDocument['spacing'];
  if (shared?.palette) out.palette = shared.palette;
  return out;
}

/**
 * The document the runtime applies for this app (the app level alone). `shared` only adds the shared token overrides:
 * its slots, spacing and chrome belong to the snapshot now. `skin` is the data of the app's skin; null (unknown id)
 * reads as Use skin off. The hub-wide skin and the sub scopes are `composeLookAt`'s business.
 */
export function composeLook(shared: AppearanceDocument | null, look: AppLookDocument, skin: SkinData | null): AppearanceDocument {
  const on = look.skin.use && !!skin;
  return composeWith(shared, look, on ? skin : null, look.skin.id, on ? look.skin.overrides : {}, 'app');
}

/**
 * The look at a place: the chain plugin → ui → app → global decides the skin (`resolveLookSkin`), `skinOf` gives a
 * skin's data by id (null = unknown, reads as none), and the result carries the skin's parts for the sheet. With no
 * scope this is the app itself, hub-wide skin included.
 */
export function composeLookAt(shared: AppearanceDocument | null, look: AppLookDocument, skinOf: (id: string) => SkinData | null, scope?: Partial<SkinScope> | null): ComposedLook {
  const resolved = resolveLookSkin(look, globalSkinOf(shared), scope ?? null);
  const skin = resolved.id ? skinOf(resolved.id) : null;
  const scopeKey = skinScopeKey(scope ?? null);
  return { doc: composeWith(shared, look, skin, resolved.id, skin ? resolved.overrides : {}, scopeKey), parts: skin?.parts ?? {}, skin: skin ? resolved : { ...resolved, id: '' }, scopeKey };
}

/**
 * A local change after the runtime made it. A skin in force (Use skin on, or the hub-wide skin while the app follows
 * it): a slot pick overrides that part of the skin. No skin: it is the app's own. `skin` is the data of the skin in force.
 */
export function lookAfterChange(look: AppLookDocument, change: AppearanceChange, skin: SkinData | null, skinId = look.skin.id): AppLookDocument {
  const next: AppLookDocument = { ...look, own: { ...look.own }, skin: { ...look.skin, overrides: { ...look.skin.overrides } } };
  const skinOn = (look.skin.use || look.skin.inherit) && !!skin;
  const inSkin = skinOn ? skinSlots(skin!, skinId) : {};
  for (const [t, id] of Object.entries(change.slots ?? {})) {
    if (RETIRED_PACKAGE_TYPES.includes(t)) continue; // a retired package slot is a skin pick, never a slot (migrateLegacyLook)
    if (skinOn && t in inSkin) {
      if (id === null || id === inSkin[t]) delete next.skin.overrides[t];
      else next.skin.overrides[t] = id;
    } else {
      const own = { ...next.own.slots };
      if (id === null) delete own[t]; else own[t] = id;
      next.own.slots = own;
    }
  }
  if (change.spacing) next.own.spacing = change.spacing;
  if (change.hidden) {
    const hidden = { ...next.own.hidden };
    for (const [t, v] of Object.entries(change.hidden)) { if (v === null) delete hidden[t]; else hidden[t] = v; }
    next.own.hidden = hidden;
  }
  if (change.settings) {
    const settings = { ...next.own.settings };
    for (const [k, v] of Object.entries(change.settings)) {
      if (k === LEGACY_DESIGN_OVERRIDES_KEY || k === LEGACY_DESIGN_APPLIED_KEY) continue; // retired with design packages
      if (v === null && !(k in (look.default.settings ?? {}))) delete settings[k]; else settings[k] = v;
    }
    next.own.settings = settings;
  }
  return next;
}
