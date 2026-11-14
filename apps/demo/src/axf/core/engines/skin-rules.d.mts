import type { ResolvedSkin, SkinScope, SkinScopeState } from './skin-coverage.mjs';

export const APP_LOOK_FRAME: 'app-look@1';
export const APP_LOOK_PROJECT: string;
export const APP_LOOK_MAX_BYTES: number;
export const SKIN_NEVER: readonly string[];
/** The section of a skin that is switched on its own: the colour theme slot. */
export const SKIN_COLOR_SLOT: 'color-theme';
export const SKIN_USES: readonly ('on' | 'off' | 'inherit')[];
/** The skin's four sections → the asset type holding that section's presets (never picked on their own). */
export type SkinSection = 'colors' | 'style' | 'layout' | 'behavior';
export const SKIN_SECTIONS: Readonly<Record<SkinSection, string>>;
export const SKIN_SECTION_FIELDS: Readonly<Record<SkinSection, 'colorTheme' | 'styleTheme' | 'layoutTheme' | 'behaviorTheme'>>;
export const SKIN_SWAPPABLE_SECTION: 'color-theme';
export const RETIRED_PACKAGE_TYPES: readonly string[];
export const SKIN_SCALE_TYPES: readonly string[];
export function isSkinSectionType(type: string): boolean;
export function sectionOfType(type: string): SkinSection | '';
export function skinSlotMap(skin: { assets?: Record<string, string>; layoutTheme?: string; colorTheme?: string; styleTheme?: string; behaviorTheme?: string } | null | undefined): Record<string, string>;
/** What the skins-only fold moved out of a look (look-migration@1): never applied again, kept for an undo by hand. */
export interface LegacyLook { at: string; own?: LookPart; settings?: Record<string, unknown> }
/** The one-run stamp of look-migration@1 on a document. */
export interface LookMigrated { version: number; at: string; by: string; /** picks left as the app's own (no skin could carry them) */ kept?: string[] }
/** A look: what a snapshot holds and what picks add. */
export interface LookPart { slots?: Record<string, string>; spacing?: string; hidden?: Record<string, boolean>; settings?: Record<string, unknown> }
/** The app level: Use skin, follow the hub-wide skin while off, the skin, its overrides, and the colour theme picked inside it (absent = the skin's own; never an override, never a new skin). */
export interface AppSkinState { use: boolean; inherit: boolean; id: string; overrides: Record<string, string>; colorTheme?: string }
/** The hub-wide skin (kept on the shared appearance document). */
export interface GlobalSkin { id: string; overrides?: Record<string, string>; colorTheme?: string }
export interface AppLookDocument {
  $axf: typeof APP_LOOK_FRAME;
  app: string;
  default: LookPart;
  own: LookPart;
  skin: AppSkinState;
  /** Per UI / plugin skin states (`ui:<id>`, `plugin:<id>`); a missing key inherits. */
  scopes: Record<string, SkinScopeState>;
  /** What Restore replaced: one undo. */
  undo?: { own: LookPart; skin: AppSkinState; scopes: Record<string, SkinScopeState>; at: string } | null;
  /** look-migration@1 ran on this document (absent = not yet). */
  migrated?: LookMigrated;
  /** The retired picks the fold moved out, as they were. */
  legacy?: LegacyLook;
  updatedBy?: string;
  updatedAt?: string;
}
export function appLookPath(appId: string): string;
export function normalizeLookPart(raw: unknown): LookPart;
export function normalizeScopeState(raw: unknown): SkinScopeState;
export function newAppLook(app: string, snapshot: LookPart): AppLookDocument;
export function normalizeAppLook(raw: unknown): AppLookDocument | null;
export function parseAppLook(text: string | null | undefined): AppLookDocument | null;
export function setUseSkin(look: AppLookDocument, on: boolean): AppLookDocument;
export function setInheritSkin(look: AppLookDocument, on: boolean): AppLookDocument;
export function pickSkin(look: AppLookDocument, id: string): AppLookDocument;
export function setSkinColorTheme(look: AppLookDocument, id: string | null, key?: string): AppLookDocument;
export function skinColorTheme(look: AppLookDocument | null | undefined, key?: string): string;
export function backToSkin(look: AppLookDocument, slot: string): AppLookDocument;
export function overriddenSlots(look: AppLookDocument | null): string[];
export function restoreAppDefault(look: AppLookDocument, at: string): AppLookDocument;
export function undoRestore(look: AppLookDocument): AppLookDocument;
export function setLookSlot(look: AppLookDocument, slot: string, id: string | null, global?: GlobalSkin | null): AppLookDocument;
export function scopeState(look: AppLookDocument, key: string): SkinScopeState | null;
export function setScopeSkin(look: AppLookDocument, key: string, use: 'on' | 'off' | 'inherit', id?: string): AppLookDocument;
export function setScopeOverride(look: AppLookDocument, key: string, slot: string, id: string | null): AppLookDocument;
export function scopeEntries(look: AppLookDocument | null): ({ key: string } & SkinScopeState)[];
export function resolveLookSkin(look: AppLookDocument | null, global: GlobalSkin | null | undefined, scope: Partial<SkinScope> | null | undefined): ResolvedSkin;
