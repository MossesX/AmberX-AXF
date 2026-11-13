import type { AppLookDocument } from './skin-rules.mjs';

export const LOOK_MIGRATION_FRAME: 'look-migration@1';
export const LOOK_MIGRATION_VERSION: number;
export const LEGACY_LOOK_KEY: 'axf.legacy.look';
export const LOOK_MIGRATED_KEY: 'axf.skin.migrated';
export const RETIRED_LOOK_KEYS: readonly string[];
export const RETIRED_LOOK_PREFIXES: readonly string[];
export const FOLDED_PICK_TYPES: readonly string[];
export function isRetiredLookKey(key: string): boolean;
export function isFoldedPickType(type: string): boolean;

/** A skin's data as the fold needs it (engines/skin.ts `SkinData` fits). */
export interface FoldSkin { layoutTheme?: string; colorTheme?: string; styleTheme?: string; behaviorTheme?: string; assets?: Record<string, string>; extras?: { spacing?: string; hidden?: Record<string, boolean>; settings?: Record<string, unknown> } }
/** The local backup (`axf.legacy.look`). */
export interface LegacyLookBackup { $axf: 'look-migration@1'; version: number; at: string; settings: Record<string, unknown> }
export type FoldReason = 'nothing' | 'skin-on' | 'package' | 'match' | 'no-skin' | 'no-document';
export interface FoldReport { skin: string; folded: Record<string, string>; overrides: Record<string, string>; kept: Record<string, string>; reason: FoldReason }
export interface FoldContext { skinOf: (id: string) => FoldSkin | null; skinIds?: readonly string[]; has?: (type: string, id: string) => boolean; designPick?: string; now?: string; by?: string }

export function legacyPicks(look: AppLookDocument | null | undefined): Record<string, string>;
export function legacyLookSettings(look: AppLookDocument | null | undefined): Record<string, unknown>;
export const DESIGN_OVERRIDES_SETTING: 'axf.appearance.overrides';
export function legacyThemesInForce(slots: Record<string, string> | null | undefined, settings: Record<string, unknown> | null | undefined, skinOf: (id: string) => FoldSkin | null, has?: (type: string, id: string) => boolean): Partial<Record<'style-theme' | 'color-theme', string>>;
export function resolveLegacyLook(look: AppLookDocument, skinOf: (id: string) => FoldSkin | null, has?: (type: string, id: string) => boolean): { look: AppLookDocument; settings: Record<string, unknown> };
export function lookMigrated(look: AppLookDocument | null | undefined): boolean;
export function lookNeedsMigration(look: AppLookDocument | null | undefined): boolean;
export function settingsNeedMigration(values: Record<string, unknown> | null | undefined): boolean;
export function parseLegacyLook(raw: unknown): LegacyLookBackup | null;
export function migrateLookSettings(values: Record<string, unknown> | null | undefined, now: string): { changed: boolean; set: Record<string, string | number>; clear: string[]; designPick: string; backup: LegacyLookBackup | null };
export function foldLegacyPicks(look: AppLookDocument, ctx: FoldContext): { look: AppLookDocument } & FoldReport;
export function migrateLook(look: AppLookDocument | null, values: Record<string, unknown> | null | undefined, ctx: FoldContext): {
  look: AppLookDocument | null;
  lookChanged: boolean;
  settings: { set: Record<string, string | number>; clear: string[] };
  settingsChanged: boolean;
  retired: string[];
  backup: LegacyLookBackup | null;
  report: FoldReport;
};
