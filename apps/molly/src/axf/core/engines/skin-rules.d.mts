export const APP_LOOK_FRAME: 'app-look@1';
export const APP_LOOK_PROJECT: string;
export const APP_LOOK_MAX_BYTES: number;
export const SKIN_NEVER: readonly string[];
/** A look: what a snapshot holds and what picks add. */
export interface LookPart { slots?: Record<string, string>; spacing?: string; hidden?: Record<string, boolean>; settings?: Record<string, unknown> }
export interface AppSkinState { use: boolean; id: string; overrides: Record<string, string> }
export interface AppLookDocument {
  $axf: typeof APP_LOOK_FRAME;
  app: string;
  default: LookPart;
  own: LookPart;
  skin: AppSkinState;
  /** What Restore replaced: one undo. */
  undo?: { own: LookPart; skin: AppSkinState; at: string } | null;
  updatedBy?: string;
  updatedAt?: string;
}
export function appLookPath(appId: string): string;
export function normalizeLookPart(raw: unknown): LookPart;
export function newAppLook(app: string, snapshot: LookPart): AppLookDocument;
export function normalizeAppLook(raw: unknown): AppLookDocument | null;
export function parseAppLook(text: string | null | undefined): AppLookDocument | null;
export function setUseSkin(look: AppLookDocument, on: boolean): AppLookDocument;
export function pickSkin(look: AppLookDocument, id: string): AppLookDocument;
export function backToSkin(look: AppLookDocument, slot: string): AppLookDocument;
export function overriddenSlots(look: AppLookDocument | null): string[];
export function restoreAppDefault(look: AppLookDocument, at: string): AppLookDocument;
export function undoRestore(look: AppLookDocument): AppLookDocument;
export function setLookSlot(look: AppLookDocument, slot: string, id: string | null): AppLookDocument;
