import type { ResolvedSkin, SkinScope, SkinScopeState } from './skin-coverage.mjs';

export const APP_LOOK_FRAME: 'app-look@1';
export const APP_LOOK_PROJECT: string;
export const APP_LOOK_MAX_BYTES: number;
export const SKIN_NEVER: readonly string[];
export const SKIN_USES: readonly ('on' | 'off' | 'inherit')[];
/** The skin's four sections → the asset type holding that section's presets. */
export const SKIN_SECTIONS: { readonly colors: 'color-theme'; readonly style: 'style-theme'; readonly layout: 'layout'; readonly behavior: 'behavior-theme' };
export type SkinSection = keyof typeof SKIN_SECTIONS;
export function isSkinSectionType(type: string): boolean;
export function sectionOfType(type: string): SkinSection | '';
export function migrateLegacyLook<T extends AppLookDocument | null>(look: T): T;
/** A look: what a snapshot holds and what picks add. */
export interface LookPart { slots?: Record<string, string>; spacing?: string; hidden?: Record<string, boolean>; settings?: Record<string, unknown> }
/** The app level: Use skin, follow the hub-wide skin while off, the skin and its overrides. */
export interface AppSkinState { use: boolean; inherit: boolean; id: string; overrides: Record<string, string> }
/** The hub-wide skin (kept on the shared appearance document). */
export interface GlobalSkin { id: string; overrides?: Record<string, string> }
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
export function backToSkin(look: AppLookDocument, slot: string): AppLookDocument;
export function overriddenSlots(look: AppLookDocument | null): string[];
export function restoreAppDefault(look: AppLookDocument, at: string): AppLookDocument;
export function undoRestore(look: AppLookDocument): AppLookDocument;
export function setLookSlot(look: AppLookDocument, slot: string, id: string | null): AppLookDocument;
export function scopeState(look: AppLookDocument, key: string): SkinScopeState | null;
export function setScopeSkin(look: AppLookDocument, key: string, use: 'on' | 'off' | 'inherit', id?: string): AppLookDocument;
export function setScopeOverride(look: AppLookDocument, key: string, slot: string, id: string | null): AppLookDocument;
export function scopeEntries(look: AppLookDocument | null): ({ key: string } & SkinScopeState)[];
export function resolveLookSkin(look: AppLookDocument | null, global: GlobalSkin | null | undefined, scope: Partial<SkinScope> | null | undefined): ResolvedSkin;
