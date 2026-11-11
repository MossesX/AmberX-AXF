/**
 * skin@1 + app-look@1 (build skins, Nov 2026; coverage, parts, icon pack and scopes added by build skins-asset-types,
 * Fable, Nov 7 2026).
 *
 * A skin (asset type `skin`) is a whole look: a layout theme, a colour theme, a style theme and the assets that fill
 * the other slots (title bar, menus, context menus, toolbars, dialogs, buttons, nav menu ...). Every design package
 * also reads as a skin (`skinFromDesignPackage`), so a picker offers both and nothing is kept twice. A skin is a
 * design pack (Brett): it MAY name an icon pack (`iconPack`) and MAY carry style `parts` for any type that has a style
 * target (customize engine), so it reaches widgets, badges, labels and every other drawn piece — the registry says
 * how each type is covered (`skin-coverage.mjs`, `skinCoverage()`), and CI fails on a type it can't reach.
 *
 * A skin owns everything, and its colour theme is the one section switched on its own (Brett, Nov 9 2026: "You can
 * change the color theme without changing the skin. If you change the color theme, it makes a new skin, don't like
 * that."). `colorTheme` on the skin is the skin's own; a pick made while the skin is in force is kept beside the skin
 * in the look document (`skin.colorTheme`, a scope's `colorTheme`, the hub-wide skin's `colorTheme`: skin-rules.mjs),
 * never as an override and never as another skin. Changing the colour theme leaves the skin id, the skin asset and
 * the list of skins exactly as they were (`lookAfterChange`, `setSkinColorTheme`, `setLookSlot`); `skinColorOf` says
 * what a place shows.
 *
 * app-look@1 is one app's look on the hub (`shared/settings/looks/<app>.json`): the snapshot of its default, its own
 * picks over that default, its skin switch, and a skin state per UI / plugin. It is what keeps apps apart (Brett,
 * Nov 4 2026: "by default they're all their own"): the shared appearance@1 document stays the transport and the
 * source of shared token overrides (and of the hub-wide skin, `skin` on that document), but an app's slots, spacing
 * and chrome come from its own document, which only that app writes.
 *
 *   effective look at a place = default snapshot + own picks                        (no skin in the chain)
 *                             = that + the skin in force + the chain's overrides     (plugin → ui → app → global)
 *                               + the colour theme picked inside the skin, when one is
 *
 * Pure and port-neutral; Kotlin twin deferred (spec/PORTING.md, "skin@1 + app-look@1").
 */
import type { AppearanceChange, AppearanceDocument } from './appearance';
import { APPEARANCE_FRAME } from './appearance';
import { DESIGN_OVERRIDES_KEY, normalizeDesignPackage } from './designpackage';
import type { DesignPackageData } from '../types';
import { spacingOf } from './spacing';
import { CUSTOM_TARGETS, customizable, normalizeCustomValues, type CustomValues } from './customize';
import spec from '../../schemas/asset-types.json';
import { SKIN_COLOR_SLOT, SKIN_NEVER, normalizeLookPart, resolveLookSkin, setSkinColorTheme, type AppLookDocument, type GlobalSkin, type LookPart } from './skin-rules.mjs';
import { coverageSummary, coverageTable, partsErrors, partsTypes, skinScopeKey, uncoveredTypes, type CoverageRow, type CoverageSummary, type ResolvedSkin, type SkinScope, type TypeSpecs } from './skin-coverage.mjs';

export { APP_LOOK_FRAME, APP_LOOK_MAX_BYTES, APP_LOOK_PROJECT, SKIN_COLOR_SLOT, SKIN_NEVER, SKIN_USES, appLookPath, backToSkin, newAppLook, normalizeAppLook, normalizeScopeState, overriddenSlots, parseAppLook, pickSkin, resolveLookSkin, restoreAppDefault, scopeEntries, scopeState, setInheritSkin, setLookSlot, setScopeOverride, setScopeSkin, setSkinColorTheme, setUseSkin, skinColorTheme, undoRestore } from './skin-rules.mjs';
export type { AppLookDocument, AppSkinState, GlobalSkin, LookPart } from './skin-rules.mjs';
// named, not `export *`: tsx links a star re-export of a .mjs module as empty when the importer is a .mts file
export { COVERAGE_KINDS, PART_ELEMENTS, SKIN_COVERAGE_CONTRACT, SKIN_SCOPE_APP, SKIN_SCOPE_GLOBAL, SKIN_SCOPE_KINDS, coverageOf, coverageSummary, coverageTable, declarationErrors, declaredCoverage, isSubScopeKey, normalizeSkinScope, partElements, partsErrors, partsTypes, resolveSkinChain, skinScopeChain, skinScopeDomId, skinScopeKey, skinScopeKind, skinScopeOf, skinScopeSelector, uncoveredTypes } from './skin-coverage.mjs';
export type { CoverageKind, CoverageRow, CoverageSummary, PartElement, ResolvedSkin, SkinScope, SkinScopeKind, SkinScopeState, StyleTargets, TypeSpecs } from './skin-coverage.mjs';

export const SKIN_TYPE = 'skin';
export const SKIN_FRAME = 'skin@1';
/** Setting keys of a shared document that still reach every app: control@1 token overrides. */
export const SHARED_SETTING_PREFIXES: readonly string[] = ['axf.tokens.'];
/** `axf.icons.pack.<scopeKey>` = the icon pack a skin puts in force at a scope (the icon-map engine's own key, so icon maps read it as the scope's pack). */
export const SKIN_ICON_PACK_KEY = (scopeKey: string): string => `axf.icons.pack.${scopeKey}`;

export interface SkinExtras { spacing?: string; hidden?: Record<string, boolean>; settings?: Record<string, unknown> }
export interface SkinData {
  layoutTheme: string;
  colorTheme: string;
  styleTheme: string;
  /** Appearance slot → asset id, for everything but the three themes. */
  assets: Record<string, string>;
  /** The icon pack the skin draws its icons from (icon-pack asset id); absent = the branding's. */
  iconPack?: string;
  /** Style parts per asset type (customize tokens): how the type's box, text, icon and items look under this skin. */
  parts?: Record<string, CustomValues>;
  /** Shown in the picker; swatches are drawn from the skin's colour theme. */
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
export interface SkinEntry { id: string; name: string; kind: 'skin' | 'design-package'; description: string; data: SkinData }
/** The colour theme of a skin at a place: `id` = what shows, `own` = the skin's own, `picked` = the user switched it inside the skin. */
export interface SkinColor { id: string; own: string; picked: boolean }
/** What a place in an app draws: the composed document, the skin's parts and which level decided. */
export interface ComposedLook { doc: AppearanceDocument; parts: Record<string, CustomValues>; skin: ResolvedSkin; scopeKey: string }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const ID = /^[a-z0-9][a-z0-9-]*$/;
const THEMES = { layoutTheme: 'layout', colorTheme: 'color-theme', styleTheme: 'style-theme' } as const;
const TYPE_SPECS = spec.types as unknown as TypeSpecs;

/** The parts of a document a snapshot keeps (never the palette or who saved it). */
export function snapshotLook(doc: AppearanceDocument | null): LookPart {
  return normalizeLookPart(doc ?? {});
}

function idMap(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (isObj(raw)) for (const [k, v] of Object.entries(raw)) if (ID.test(k) && typeof v === 'string' && ID.test(v) && !SKIN_NEVER.includes(k)) out[k] = v;
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

/** Keep only what skin@1 holds; a malformed field is dropped, never a crash. */
export function normalizeSkin(raw: unknown): SkinData {
  const d = isObj(raw) ? raw : {};
  const id = (k: keyof typeof THEMES) => (typeof d[k] === 'string' && ID.test(d[k] as string) ? (d[k] as string) : '');
  const out: SkinData = { layoutTheme: id('layoutTheme'), colorTheme: id('colorTheme'), styleTheme: id('styleTheme'), assets: idMap(d.assets) };
  for (const t of Object.values(THEMES)) delete out.assets[t];
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

/** Validation messages for a skin's data (validators call it for type `skin`). */
export function skinErrors(raw: unknown): string[] {
  if (!isObj(raw)) return ['data must be an object'];
  const errors: string[] = [];
  for (const [k, t] of Object.entries(THEMES)) if (typeof raw[k] !== 'string' || !ID.test(raw[k] as string)) errors.push(`data.${k} must be a ${t} asset id`);
  if (!isObj(raw.assets)) errors.push('data.assets must be an object (slot → asset id)');
  else for (const [t, id] of Object.entries(raw.assets)) {
    if (SKIN_NEVER.includes(t) || (Object.values(THEMES) as string[]).includes(t)) errors.push(`data.assets.${t}: a skin never sets ${t} here`);
    else if (typeof id !== 'string' || !ID.test(id)) errors.push(`data.assets.${t} must be an asset id`);
  }
  if ('iconPack' in raw && (typeof raw.iconPack !== 'string' || !ID.test(raw.iconPack))) errors.push('data.iconPack must be an icon-pack asset id');
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

/** Every slot a skin sets, themes included. Empty ids are skipped. */
export function skinSlots(skin: SkinData): Record<string, string> {
  const out = { ...skin.assets };
  for (const [k, t] of Object.entries(THEMES)) { const v = skin[k as keyof typeof THEMES]; if (v) out[t] = v; }
  return out;
}

/** A design package read as a skin: same bundle, so the Skin picker lists them without a second copy of any look. */
export function skinFromDesignPackage(raw: unknown): SkinData {
  const p: DesignPackageData = normalizeDesignPackage(raw);
  const assets = { ...(p.extras?.slots ?? {}) };
  if (p['behavior-theme']) assets['behavior-theme'] = p['behavior-theme'];
  const skin: SkinData = { layoutTheme: p.layout, colorTheme: p['color-theme'], styleTheme: p['style-theme'], assets };
  const x = p.extras;
  if (x && (x.spacing || x.hidden || x.settings)) skin.extras = { ...(x.spacing ? { spacing: x.spacing } : {}), ...(x.hidden ? { hidden: x.hidden } : {}), ...(x.settings ? { settings: x.settings } : {}) };
  return skin;
}

/** The Skin picker's list: real skins first, then the design packages. */
export function skinEntries(skins: readonly { id: string; name: string; description?: string; data: unknown }[], packages: readonly { id: string; name: string; description?: string; data: unknown }[]): SkinEntry[] {
  const out: SkinEntry[] = skins.map((a) => ({ id: a.id, name: a.name, kind: 'skin', description: a.description ?? '', data: normalizeSkin(a.data) }));
  const taken = new Set(out.map((e) => e.id));
  for (const a of packages) if (!taken.has(a.id)) out.push({ id: a.id, name: a.name, kind: 'design-package', description: a.description ?? '', data: skinFromDesignPackage(a.data) });
  return out;
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
export function skinCovers(skin: SkinData): { type: string; by: CoverageRow['by']; covered: boolean; how: string[] }[] {
  const slots = skinSlots(skin);
  return skinCoverage().map((r) => {
    const how: string[] = [];
    if (slots[r.type]) how.push(`slot ${slots[r.type]}`);
    if (skin.parts?.[r.type]) how.push(`parts ${Object.keys(skin.parts[r.type]!).join(', ')}`);
    if (r.by === 'reference' && r.via === 'iconPack' && skin.iconPack) how.push(`iconPack ${skin.iconPack}`);
    if (r.by === 'reference' && r.via && r.via !== 'iconPack' && slots[r.via]) how.push(`via ${r.via} ${slots[r.via]}`);
    if (r.by === 'bundle') how.push('the skin itself');
    if (r.by === 'none') how.push('no look');
    return { type: r.type, by: r.by, covered: r.by !== 'none' && how.length > 0, how };
  });
}

/* ---------------- composing ---------------- */

/** The hub-wide skin a shared document carries (null = none); `colorTheme` only when one was picked inside it. */
export function globalSkinOf(shared: AppearanceDocument | null | undefined): GlobalSkin | null {
  const s = (shared as { skin?: unknown } | null | undefined)?.skin;
  if (!isObj(s) || typeof s.id !== 'string' || !ID.test(s.id)) return null;
  const overrides = idMap(s.overrides);
  // a document saved before the colour theme had its own field kept the pick among the overrides
  const pick = typeof s.colorTheme === 'string' && ID.test(s.colorTheme) ? s.colorTheme : overrides[SKIN_COLOR_SLOT] ?? '';
  delete overrides[SKIN_COLOR_SLOT];
  return pick ? { id: s.id, overrides, colorTheme: pick } : { id: s.id, overrides };
}

/**
 * The colour theme a skin shows where `resolved` is in force: the pick made inside the skin (the nearest level that
 * has one), else the skin's own. `picked` is false when the pick is the skin's own theme. No skin = all empty.
 */
export function skinColorOf(skin: SkinData | null, resolved: { colorTheme?: string } | null | undefined): SkinColor {
  if (!skin) return { id: '', own: '', picked: false };
  const pick = resolved?.colorTheme ?? '';
  return { id: pick || skin.colorTheme, own: skin.colorTheme, picked: !!pick && pick !== skin.colorTheme };
}

/**
 * The document for a look with `skin` on (or none) and `overrides` over it; `scopeKey` names where the icon pack lands;
 * `colorTheme` is the colour theme picked inside the skin ('' = the skin's own).
 */
function composeWith(shared: AppearanceDocument | null, look: AppLookDocument, skin: SkinData | null, overrides: Record<string, string>, scopeKey: string, colorTheme = ''): AppearanceDocument {
  const slots = { ...look.default.slots, ...look.own.slots };
  const hidden = { ...look.default.hidden, ...look.own.hidden };
  let spacing = look.own.spacing ?? look.default.spacing;
  const settings: Record<string, unknown> = { ...look.default.settings, ...look.own.settings };
  for (const [k, v] of Object.entries(shared?.settings ?? {})) if (SHARED_SETTING_PREFIXES.some((p) => k.startsWith(p))) settings[k] = v;
  if (skin) {
    Object.assign(slots, skinSlots(skin), overrides);
    if (colorTheme) slots[SKIN_COLOR_SLOT] = colorTheme; // switched inside the skin: same skin, other colours
    if (skin.extras?.spacing) spacing = skin.extras.spacing;
    Object.assign(hidden, skin.extras?.hidden);
    Object.assign(settings, skin.extras?.settings);
    if (skin.iconPack) settings[SKIN_ICON_PACK_KEY(scopeKey)] = skin.iconPack;
    // the design package's precedence rule must not take the skin's themes back
    settings[DESIGN_OVERRIDES_KEY] = { 'style-theme': slots['style-theme'], 'color-theme': slots['color-theme'] };
  }
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
  return composeWith(shared, look, on ? skin : null, on ? look.skin.overrides : {}, 'app', on ? look.skin.colorTheme : '');
}

/**
 * The look at a place: the chain plugin → ui → app → global decides the skin (`resolveLookSkin`), `skinOf` gives a
 * skin's data by id (a skin or a design package; null = unknown, reads as none), and the result carries the skin's
 * parts for the sheet. With no scope this is the app itself, hub-wide skin included.
 */
export function composeLookAt(shared: AppearanceDocument | null, look: AppLookDocument, skinOf: (id: string) => SkinData | null, scope?: Partial<SkinScope> | null): ComposedLook {
  const resolved = resolveLookSkin(look, globalSkinOf(shared), scope ?? null);
  const skin = resolved.id ? skinOf(resolved.id) : null;
  const scopeKey = skinScopeKey(scope ?? null);
  return { doc: composeWith(shared, look, skin, skin ? resolved.overrides : {}, scopeKey, skin ? resolved.colorTheme : ''), parts: skin?.parts ?? {}, skin: skin ? resolved : { id: '', overrides: resolved.overrides, from: resolved.from }, scopeKey };
}

/**
 * A local change after the runtime made it. A skin in force (Use skin on, or the hub-wide skin while the app follows
 * it): a colour theme pick is switched inside the skin (`skin.colorTheme`; the skin stays the same skin and nothing is
 * created), any other slot pick overrides that part of the skin. No skin: it is the app's own. `skin` is the data of
 * the skin in force; `parentColor` is the colour theme a level above already picked inside it (the hub-wide skin's),
 * so picking the theme that shows anyway keeps no pick.
 */
export function lookAfterChange(look: AppLookDocument, change: AppearanceChange, skin: SkinData | null, parentColor = ''): AppLookDocument {
  let next: AppLookDocument = { ...look, own: { ...look.own }, skin: { ...look.skin, overrides: { ...look.skin.overrides } } };
  const skinOn = (look.skin.use || look.skin.inherit) && !!skin;
  const inSkin = skinOn ? skinSlots(skin!) : {};
  for (const [t, id] of Object.entries(change.slots ?? {})) {
    if (skinOn && t === SKIN_COLOR_SLOT) {
      next = setSkinColorTheme(next, id === (parentColor || skin!.colorTheme) ? null : id);
    } else if (skinOn && t in inSkin) {
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
      if (k === DESIGN_OVERRIDES_KEY && skinOn) continue; // composed from the slots while a skin is on
      if (v === null && !(k in (look.default.settings ?? {}))) delete settings[k]; else settings[k] = v;
    }
    next.own.settings = settings;
  }
  return next;
}
