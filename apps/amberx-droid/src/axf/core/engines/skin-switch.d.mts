import type { AppLookDocument, GlobalSkin, LookUndo } from './skin-rules.mjs';
import type { ResolvedSkin, SkinScopeState } from './skin-coverage.mjs';

export const SKIN_SWITCH_CONTRACT: 'skin-switch@1';
export type SkinSwitchAction = 'use' | 'back-to-skin' | 'restore-default' | 'undo';
export const SKIN_SWITCH_ACTIONS: readonly SkinSwitchAction[];
export type SkinSwitchScopeKind = 'hub' | 'app' | 'ui' | 'plugin';
export const SKIN_SWITCH_SCOPES: readonly SkinSwitchScopeKind[];
export const SKIN_SWITCH_HUB: 'hub';
export type SkinSwitchError = 'bad-action' | 'bad-scope' | 'other-app' | 'no-skin' | 'unknown-skin' | 'bad-slot' | 'no-document' | 'nothing-to-undo';
export const SKIN_SWITCH_ERRORS: readonly SkinSwitchError[];

/** A scope string read: `hub`, `app` / `app:<id>`, `ui:<view>`, `plugin:<id>`. */
export interface SwitchScope { kind: SkinSwitchScopeKind; key: string; id: string; scope: string }
/** The command every entry point sends. */
export interface SkinSwitchCommand { action: SkinSwitchAction; scope: string; skin?: string; slot?: string; at?: string }
export interface SkinSwitchProblem { code: SkinSwitchError; message: string }
/** The pair an action works on: the acting app's document and the hub-wide skin. */
export interface SkinSwitchState { look: AppLookDocument | null; global: GlobalSkin | null | undefined }
export interface SkinSwitchContext { has?: (id: string) => boolean; now?: string }
export interface SkinSwitchResult {
  ok: boolean;
  error?: SkinSwitchError;
  message?: string;
  look: AppLookDocument | null;
  global: GlobalSkin | null;
  changed: { look: boolean; global: boolean };
  /** The record the action left (null for undo, for a refused command and for a command that changed nothing). */
  undo: LookUndo | null;
}
/** What the Skins screen and the API read for one scope. */
export interface SkinSwitchView {
  contract: 'skin-switch@1';
  scope: string;
  key: string;
  state: SkinScopeState | ({ use: 'on' } & GlobalSkin) | { use: 'off'; id: ''; overrides: Record<string, never> };
  inForce: ResolvedSkin;
  known: boolean;
  overridden: string[];
  canUndo: boolean;
  undo: { action: string; scope: string; at: string } | null;
}

export function parseSwitchScope(raw: unknown): SwitchScope | null;
export function switchScopeOf(key: string, app?: string): string;
export function switchScopes(look: AppLookDocument | null | undefined): string[];
export function normalizeSkinSwitch(raw: unknown): { command: SkinSwitchCommand; errors: SkinSwitchProblem[] };
export function skinSwitch(state: SkinSwitchState, command: unknown, ctx?: SkinSwitchContext): SkinSwitchResult;
export function switchScopeState(look: AppLookDocument | null | undefined, global: GlobalSkin | null | undefined, scope: string): SkinSwitchView['state'] | null;
export function skinSwitchState(look: AppLookDocument | null | undefined, global: GlobalSkin | null | undefined, scope: string, ctx?: SkinSwitchContext): SkinSwitchView | null;
