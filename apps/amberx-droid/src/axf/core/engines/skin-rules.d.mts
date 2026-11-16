import type { ResolvedSkin, SkinScope, SkinScopeState } from './skin-coverage.mjs';

export const APP_LOOK_FRAME: 'app-look@1';
export const APP_LOOK_PROJECT: string;
export const APP_LOOK_MAX_BYTES: number;
/** How many backups an app-look document keeps (newest first). */
export const LOOK_BACKUPS_MAX: number;
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
/** The one undo record: the look before the last Restore or skin switch (skin-switch@1: `action`, `scope`, and `global` for a hub switch). */
export interface LookUndo { own: LookPart; skin: AppSkinState; scopes: Record<string, SkinScopeState>; at: string; action?: string; scope?: string; global?: GlobalSkin | null }
/** One backup taken before the app was moved onto the hub default skin: what it drew, named for Restore from backup. */
export interface LookBackup { id: string; at: string; by: string; reason: string; own: LookPart; skin: AppSkinState; scopes: Record<string, SkinScopeState> }
export interface AppLookDocument {
  $axf: typeof APP_LOOK_FRAME;
  app: string;
  default: LookPart;
  own: LookPart;
  skin: AppSkinState;
  /** Per UI / plugin skin states (`ui:<id>`, `plugin:<id>`); a missing key inherits. */
  scopes: Record<string, SkinScopeState>;
  /** What the last Restore or skin switch replaced: one undo (skin-switch@1 adds the action, the scope and the hub-wide skin before a hub switch). */
  undo?: LookUndo | null;
  /** look-migration@1 ran on this document (absent = not yet). */
  migrated?: LookMigrated;
  /** The retired picks the fold moved out, as they were. */
  legacy?: LegacyLook;
  /** Backups taken before a move onto the hub default skin, newest first (at most LOOK_BACKUPS_MAX); absent = none. */
  backups?: LookBackup[];
  updatedBy?: string;
  updatedAt?: string;
}
/** One chrome kind under a skin: the settings interface its dialog uses, field overrides per instance (chrome-settings@1). */
export interface SkinChromeKind { interface?: string; instances?: Record<string, Record<string, unknown>> }
/** The skin's `chrome` block: chrome kind → its setup. */
export type SkinChrome = Record<string, SkinChromeKind>;
export function normalizeSkinChrome(raw: unknown): SkinChrome;
export function skinChromeErrors(raw: unknown): string[];
/** The settings keys the chrome block puts in force (`axf.chrome.settings.<kind>`, `axf.chrome.<kind>.<instance>`). */
export function skinChromeSettings(chrome: SkinChrome | null | undefined): Record<string, unknown>;
export function appLookPath(appId: string): string;
export function normalizeLookPart(raw: unknown): LookPart;
export function normalizeLookBackup(raw: unknown): LookBackup | null;
export function normalizeScopeState(raw: unknown): SkinScopeState;
export function newAppLook(app: string, snapshot: LookPart): AppLookDocument;
export function normalizeAppLook(raw: unknown): AppLookDocument | null;
export function parseAppLook(text: string | null | undefined): AppLookDocument | null;
export function setUseSkin(look: AppLookDocument, on: boolean): AppLookDocument;
export function setInheritSkin(look: AppLookDocument, on: boolean): AppLookDocument;
/** The look drawn while the app takes its skin from axHub only: the hub-wide skin over the default snapshot, nothing of its own. */
export function hubOnlyLook<T extends AppLookDocument | null>(look: T): T;
export function pickSkin(look: AppLookDocument, id: string): AppLookDocument;
export function setSkinColorTheme(look: AppLookDocument, id: string | null, key?: string): AppLookDocument;
export function skinColorTheme(look: AppLookDocument | null | undefined, key?: string): string;
export function backToSkin(look: AppLookDocument, slot: string): AppLookDocument;
export function overriddenSlots(look: AppLookDocument | null): string[];
export function restoreAppDefault(look: AppLookDocument, at: string): AppLookDocument;
export function undoRestore(look: AppLookDocument): AppLookDocument;
export function setLookSlot(look: AppLookDocument, slot: string, id: string | null, global?: GlobalSkin | null): AppLookDocument;
/** Keep what the app draws now at the head of `backups` (capped; a twin of the newest is not added again). */
export function backupLook(look: AppLookDocument, meta: { at: string; by?: string; reason?: string; id?: string }): AppLookDocument;
/** The backup named `id`, or the newest; null when none. */
export function lookBackup(look: AppLookDocument | null | undefined, id?: string): LookBackup | null;
/** Move the app onto the hub default skin: back up, Use skin and Follow off, overrides and colour pick become own picks, scopes inherit, one undo. */
export function adoptHubDefault(look: AppLookDocument, meta: { at: string; by?: string; reason?: string; id?: string }): AppLookDocument;
/** Put a backup's own picks, skin state and scopes back (the newest when `id` is empty); backups kept, one undo. */
export function restoreLookBackup(look: AppLookDocument, id: string | null | undefined, at: string): AppLookDocument;
export function scopeState(look: AppLookDocument, key: string): SkinScopeState | null;
export function setScopeSkin(look: AppLookDocument, key: string, use: 'on' | 'off' | 'inherit', id?: string): AppLookDocument;
export function setScopeOverride(look: AppLookDocument, key: string, slot: string, id: string | null): AppLookDocument;
export function scopeEntries(look: AppLookDocument | null): ({ key: string } & SkinScopeState)[];
/** The skin in force at a place over the chain plugin → ui → app → global → default (`hubDefault` = the hub default skin pointer, the floor every app stands on). */
export function resolveLookSkin(look: AppLookDocument | null, global: GlobalSkin | null | undefined, scope: Partial<SkinScope> | null | undefined, hubDefault?: GlobalSkin | null): ResolvedSkin;
