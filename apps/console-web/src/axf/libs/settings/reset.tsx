/**
 * Reset, through the confirm dialog (settings-reset@1, spec/PLUGIN-SETTINGS.md §4; Brett, Nov 17 2026: "Reset asks in a
 * confirm dialog with a switch to include assets and a scrollable table of changed assets.").
 *
 * Every Reset in the settings library (Settings → Appearance Restore, the skin picker's Reset, the right-click Restore to
 * default, the level editor's Reset mine, every settings interface's Reset and every PluginSettingsWindow's) opens
 * `RESET_CONFIRM_DIALOG` for its scope; nothing resets without it. Confirmed, `runSettingsReset` applies exactly the plan
 * the dialog showed:
 *
 *   - switch off: the scope's setting keys are cleared, nothing else;
 *   - switch on: the scope's look keys too, and the look through the existing skin path: the console's own look goes
 *     back through Restore to default (skin-switch@1 `skin.restore:app` when a Skins plugin provides it, else the
 *     runtime's restoreDefaultAppearance), a plugin's skin scope goes back to inherit (rt.scopeSkin).
 *
 * One undo: the values cleared are kept under `SETTINGS_RESET_UNDO_KEY` (the last reset only); `settings.reset.undo`
 * puts them back and, when the look was restored, runs the look's own one undo (skin.undo / undoRestoreDefault).
 *
 * Actions (console-control, MCP, CLI and voice reach them the same way):
 *   settings.reset.ask:<scope>                     opens the dialog (scope `console` or a plugin id)
 *   settings.reset:<scope>[:assets]                destructive: callers confirm first (the dialog, or `confirm: true`)
 *   settings.reset.undo                            the one undo
 */
import { useCallback } from 'react';
import { ResetConfirmDialog, RESET_CONFIRM_DIALOG } from '../../react/components/ResetConfirmDialog';
import { parseResetScope, planSettingsReset, resetScopeKey, type ResetPlan, type ResetScope } from '../../core/engines/settings-reset';
import type { AxfRuntime, SettingValue } from '../../core';
import { useRuntime } from '../../react';
import { resetStateOf } from './changed';

export const SETTINGS_RESET_ASK = 'settings.reset.ask';
export const SETTINGS_RESET_RUN = 'settings.reset';
export const SETTINGS_RESET_UNDO = 'settings.reset.undo';
/** The last reset's cleared values (one undo). */
export const SETTINGS_RESET_UNDO_KEY = 'axf.settings.reset.undo';

interface ResetUndo { at: string; scope: string; values: Record<string, SettingValue>; look: 'restore' | 'drop-scope' | null; scopes: string[] }

const SKIN_SWITCH = 'axf.skin-switch@1';
const hasSkinSwitch = (rt: AxfRuntime) => (rt.libraries as unknown as { provides?: string[] }[]).some((l) => l.provides?.includes(SKIN_SWITCH));

/** The plan for a scope and switch position, over the runtime's state now. */
export function planReset(rt: AxfRuntime, scope: ResetScope, includeAssets: boolean): ResetPlan {
  return planSettingsReset(scope, includeAssets, resetStateOf(rt));
}

/** Apply a reset (after the confirm). Returns the plan it applied. */
export function runSettingsReset(rt: AxfRuntime, scope: ResetScope, includeAssets: boolean): ResetPlan {
  const plan = planReset(rt, scope, includeAssets);
  if (plan.empty) return plan;
  const saved = rt.settings.savedValues();
  const values: Record<string, SettingValue> = {};
  for (const k of plan.apply.clear) if (k in saved) values[k] = saved[k]!;
  const undo: ResetUndo = { at: new Date().toISOString(), scope: resetScopeKey(scope), values, look: plan.apply.look, scopes: plan.apply.scopes };
  for (const k of plan.apply.clear) rt.settings.clear(k);
  if (plan.apply.look === 'restore') {
    if (hasSkinSwitch(rt)) rt.dispatch('skin.restore:app'); else rt.restoreDefaultAppearance();
  } else if (plan.apply.look === 'drop-scope') {
    for (const key of plan.apply.scopes) rt.scopeSkin(key, 'inherit');
  }
  rt.settings.set(SETTINGS_RESET_UNDO_KEY, JSON.stringify(undo));
  rt.terminal.ok('settings', `reset ${undo.scope}: ${plan.summary}`);
  rt.toast(`${plan.summary} reset. Undo in Settings.`, 'success', 'Settings');
  return plan;
}

/** The last reset, if it can still be undone. */
export function lastReset(rt: AxfRuntime): ResetUndo | null {
  const raw = rt.settings.get(SETTINGS_RESET_UNDO_KEY);
  if (typeof raw !== 'string' || !raw) return null;
  try { return JSON.parse(raw) as ResetUndo; } catch { return null; }
}

/** Put the last reset back (settings, and the look through its own undo). One step: the record goes after. */
export function undoSettingsReset(rt: AxfRuntime): boolean {
  const u = lastReset(rt);
  if (!u) return false;
  for (const [k, v] of Object.entries(u.values)) rt.settings.set(k, v);
  if (u.look === 'restore') { if (hasSkinSwitch(rt)) rt.dispatch('skin.undo'); else rt.undoRestoreDefault(); }
  rt.settings.clear(SETTINGS_RESET_UNDO_KEY);
  rt.toast('Reset undone.', 'success', 'Settings');
  return true;
}

/** A display name for the scope. */
export function resetScopeName(rt: AxfRuntime, scope: ResetScope): string {
  if (scope.kind === 'console') return rt.manifest.app.name;
  return rt.settings.listTabs().find((t) => t.plugin === scope.id)?.label ?? scope.id;
}

/** Open the confirm dialog for a scope (`console`, `plugin:<id>` or a plugin id). */
export function askReset(rt: AxfRuntime, scope: string | ResetScope = 'console', opts: { includeAssets?: boolean } = {}): void {
  const s = typeof scope === 'string' ? parseResetScope(scope) : scope;
  if (!s) { rt.toast(`Nothing called “${String(scope)}” to reset.`, 'warning', 'Settings'); return; }
  rt.openDialog(RESET_CONFIRM_DIALOG, { scope: resetScopeKey(s), ...(opts.includeAssets ? { includeAssets: true } : {}) });
}

/** The dialog's body (registered as RESET_CONFIRM_DIALOG). */
export function ResetDialogBody({ scope, includeAssets }: { scope: string; includeAssets?: boolean }) {
  const rt = useRuntime();
  const s = parseResetScope(scope) ?? { kind: 'console' as const };
  const key = resetScopeKey(s);
  const plan = useCallback((assets: boolean) => planReset(rt, s, assets), [rt, key]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <ResetConfirmDialog scope={key} name={resetScopeName(rt, s)} plan={plan} {...(includeAssets ? { includeAssets } : {})}
      onReset={(assets) => { rt.closeDialog(); runSettingsReset(rt, s, assets); }} onCancel={() => rt.closeDialog()} />
  );
}

/** Register the dialog's actions. */
export function registerResetActions(rt: AxfRuntime): void {
  rt.actions.register(SETTINGS_RESET_ASK, ([scope, assets]) => askReset(rt, scope || 'console', { includeAssets: assets === 'assets' }), { label: 'Reset settings… (asks first)', params: true });
  rt.actions.register(SETTINGS_RESET_RUN, ([scope, assets]) => {
    const s = parseResetScope(scope || 'console');
    if (!s) { rt.toast(`Nothing called “${scope}” to reset.`, 'warning', 'Settings'); return; }
    runSettingsReset(rt, s, assets === 'assets' || assets === 'true');
  }, { label: 'Reset settings (confirmed)', params: true, effect: 'destructive' });
  rt.actions.register(SETTINGS_RESET_UNDO, () => { if (!undoSettingsReset(rt)) rt.toast('There is no reset to undo.', 'info', 'Settings'); }, { label: 'Undo the last settings reset', effect: 'write' });
}
