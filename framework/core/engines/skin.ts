/**
 * skin@1 + app-look@1 (build skins, Nov 2026; format built on Opus, possible Fable review).
 *
 * A skin (asset type `skin`) is a whole look: a layout theme, a colour theme, a style theme and the assets that fill
 * the other slots (title bar, menus, context menus, toolbars, dialogs, buttons, nav menu ...). Every design package
 * also reads as a skin (`skinFromDesignPackage`), so a picker offers both and nothing is kept twice.
 *
 * app-look@1 is one app's look on the hub (`shared/settings/looks/<app>.json`): the snapshot of its default, its own
 * picks over that default, and its skin switch. It is what keeps apps apart (Brett, Nov 4 2026: "by default they're
 * all their own"): the shared appearance@1 document stays the transport and the source of shared token overrides,
 * but an app's slots, spacing and chrome come from its own document, which only that app writes.
 *
 *   effective look = default snapshot + own picks          (Use skin off)
 *                  = that + the skin + the skin overrides  (Use skin on)
 *
 * Pure and port-neutral; Kotlin twin deferred (spec/PORTING.md, "skin@1 + app-look@1").
 */
import type { AppearanceChange, AppearanceDocument } from './appearance';
import { APPEARANCE_FRAME } from './appearance';
import { DESIGN_OVERRIDES_KEY, normalizeDesignPackage, type DesignPackageData } from './designpackage';
import { spacingOf } from './spacing';
import { SKIN_NEVER, normalizeLookPart, type AppLookDocument, type LookPart } from './skin-rules.mjs';

export { APP_LOOK_FRAME, APP_LOOK_MAX_BYTES, APP_LOOK_PROJECT, SKIN_NEVER, appLookPath, backToSkin, newAppLook, normalizeAppLook, overriddenSlots, parseAppLook, pickSkin, restoreAppDefault, setUseSkin, undoRestore } from './skin-rules.mjs';
export type { AppLookDocument, AppSkinState, LookPart } from './skin-rules.mjs';

export const SKIN_TYPE = 'skin';
export const SKIN_FRAME = 'skin@1';
/** Setting keys of a shared document that still reach every app: control@1 token overrides. */
export const SHARED_SETTING_PREFIXES: readonly string[] = ['axf.tokens.'];

export interface SkinExtras { spacing?: string; hidden?: Record<string, boolean>; settings?: Record<string, unknown> }
export interface SkinData {
  layoutTheme: string;
  colorTheme: string;
  styleTheme: string;
  /** Appearance slot → asset id, for everything but the three themes. */
  assets: Record<string, string>;
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

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const ID = /^[a-z0-9][a-z0-9-]*$/;
const THEMES = { layoutTheme: 'layout', colorTheme: 'color-theme', styleTheme: 'style-theme' } as const;

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

/** Keep only what skin@1 holds; a malformed field is dropped, never a crash. */
export function normalizeSkin(raw: unknown): SkinData {
  const d = isObj(raw) ? raw : {};
  const id = (k: keyof typeof THEMES) => (typeof d[k] === 'string' && ID.test(d[k] as string) ? (d[k] as string) : '');
  const out: SkinData = { layoutTheme: id('layoutTheme'), colorTheme: id('colorTheme'), styleTheme: id('styleTheme'), assets: idMap(d.assets) };
  for (const t of Object.values(THEMES)) delete out.assets[t];
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

/**
 * The document the runtime applies for this app. `shared` only adds the shared token overrides: its slots, spacing and
 * chrome belong to the snapshot now. `skin` is the data of the app's skin; null (unknown id) reads as Use skin off.
 */
export function composeLook(shared: AppearanceDocument | null, look: AppLookDocument, skin: SkinData | null): AppearanceDocument {
  const slots = { ...look.default.slots, ...look.own.slots };
  const hidden = { ...look.default.hidden, ...look.own.hidden };
  let spacing = look.own.spacing ?? look.default.spacing;
  const settings: Record<string, unknown> = { ...look.default.settings, ...look.own.settings };
  for (const [k, v] of Object.entries(shared?.settings ?? {})) if (SHARED_SETTING_PREFIXES.some((p) => k.startsWith(p))) settings[k] = v;
  if (look.skin.use && skin) {
    Object.assign(slots, skinSlots(skin), look.skin.overrides);
    if (skin.extras?.spacing) spacing = skin.extras.spacing;
    Object.assign(hidden, skin.extras?.hidden);
    Object.assign(settings, skin.extras?.settings);
    // the design package's precedence rule must not take the skin's themes back
    settings[DESIGN_OVERRIDES_KEY] = { 'style-theme': slots['style-theme'], 'color-theme': slots['color-theme'] };
  }
  for (const [k, v] of Object.entries(settings)) if (v === null) delete settings[k];
  const out: AppearanceDocument = { $axf: APPEARANCE_FRAME, slots, hidden, settings: settings as AppearanceDocument['settings'] };
  if (spacing) out.spacing = spacing as AppearanceDocument['spacing'];
  if (shared?.palette) out.palette = shared.palette;
  return out;
}

/** A local change after the runtime made it. Skin on: a slot pick overrides that part of the skin. Skin off: it is the app's own. */
export function lookAfterChange(look: AppLookDocument, change: AppearanceChange, skin: SkinData | null): AppLookDocument {
  const next: AppLookDocument = { ...look, own: { ...look.own }, skin: { ...look.skin, overrides: { ...look.skin.overrides } } };
  const skinOn = look.skin.use && !!skin;
  const inSkin = skinOn ? skinSlots(skin!) : {};
  for (const [t, id] of Object.entries(change.slots ?? {})) {
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
      if (k === DESIGN_OVERRIDES_KEY && skinOn) continue; // composed from the slots while a skin is on
      if (v === null && !(k in (look.default.settings ?? {}))) delete settings[k]; else settings[k] = v;
    }
    next.own.settings = settings;
  }
  return next;
}
