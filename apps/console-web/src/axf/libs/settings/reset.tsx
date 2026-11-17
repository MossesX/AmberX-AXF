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
import { keyOwner, parseResetScope, planSettingsReset, resetScopeKey, type ResetPlan, type ResetScope, type ResetState } from '../../core/engines/settings-reset';
import { parseSettingsOwner, pluginSettingsGroups, resolveSettingsInterface, settingsOwnerKey } from '../../core/engines/plugin-settings';
import type { AxfRuntime, SettingValue } from '../../core';
import { useRuntime } from '../../react';
import { resetStateOf } from './changed';

export const SETTINGS_RESET_ASK = 'settings.reset.ask';
export const SETTINGS_RESET_RUN = 'settings.reset';
export const SETTINGS_RESET_UNDO = 'settings.reset.undo';
export const SETTINGS_RESET_PLAN = 'settings.reset.plan';
export const SETTINGS_INTERFACE_READ = 'settings.interface';
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

/** A scope as people say it: `console`, a plugin id, its last id segment or its settings label ("agent manager"). */
export function resolveResetScope(rt: AxfRuntime, ref: string): ResetScope | null {
  const raw = (ref ?? '').trim().replace(/^plugin:/, '');
  if (!raw || raw === 'console' || raw === 'app') return { kind: 'console' };
  const fold = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const plugins = [...new Set(rt.settings.listTabs().map((t) => t.plugin).filter((p): p is string => !!p))];
  const hit = plugins.find((p) => p === raw) ?? plugins.find((p) => p.toLowerCase() === raw.toLowerCase() || p.split('.').pop() === raw.toLowerCase())
    ?? plugins.find((p) => rt.settings.listTabs().some((t) => t.plugin === p && fold(t.label) === fold(raw)))
    ?? plugins.find((p) => fold(p.split('.').pop() ?? '') === fold(raw));
  // not registered here (off, or another app's): a full plugin id still names it; a bare word that matches nothing is no scope
  return hit ? { kind: 'plugin', id: hit } : raw.includes('.') ? parseResetScope(raw) : null;
}

/** A display name for the scope. */
export function resetScopeName(rt: AxfRuntime, scope: ResetScope): string {
  if (scope.kind === 'console') return rt.manifest.app.name;
  return rt.settings.listTabs().find((t) => t.plugin === scope.id)?.label ?? scope.id;
}

/** Open the confirm dialog for a scope (`console`, `plugin:<id>` or a plugin id). */
export function askReset(rt: AxfRuntime, scope: string | ResetScope = 'console', opts: { includeAssets?: boolean } = {}): void {
  const s = typeof scope === 'string' ? resolveResetScope(rt, scope) : scope;
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
  rt.actions.register(SETTINGS_RESET_ASK, ([scope, assets]) => askReset(rt, scope || 'console', { includeAssets: assets === 'assets' }), { label: 'Reset settings… (asks first)', params: true, effect: 'navigate' });
  rt.actions.register(SETTINGS_RESET_RUN, ([scope, assets]) => {
    const s = resolveResetScope(rt, scope || 'console');
    if (!s) { rt.toast(`Nothing called “${scope}” to reset.`, 'warning', 'Settings'); return; }
    runSettingsReset(rt, s, assets === 'assets' || assets === 'true');
  }, { label: 'Reset settings (confirmed)', params: true, effect: 'destructive' });
  // reads: in the UI they show what they read; through the console API the open console answers with the data
  rt.actions.register(SETTINGS_INTERFACE_READ, ([owner]) => { const o = parseSettingsOwner(owner ?? ''); if (o?.kind === 'plugin') rt.dispatch(`settings.plugin:${o.id}`); else rt.dispatch('app.settings'); }, { label: 'Read a settings interface (owner: console or a plugin id)', params: true, effect: 'read' });
  rt.actions.register(SETTINGS_RESET_PLAN, ([scope, assets]) => askReset(rt, scope || 'console', { includeAssets: assets === 'assets' }), { label: 'What a settings reset would change (dry run)', params: true, effect: 'read' });
  rt.actions.register(SETTINGS_RESET_UNDO, () => { if (!undoSettingsReset(rt)) rt.toast('There is no reset to undo.', 'info', 'Settings'); }, { label: 'Undo the last settings reset', effect: 'write' });
}

/* ---------------- reads for the API (REST, MCP, CLI, voice: the open console answers them) ---------------- */

/** One owner's interface as the API reads it: the resolved interface, its current values and its changed assets. */
export function settingsInterfaceReport(rt: AxfRuntime, ownerRef: string): Record<string, unknown> | null {
  const sc = resolveResetScope(rt, ownerRef);
  const owner = sc ? (sc.kind === 'console' ? parseSettingsOwner('app') : parseSettingsOwner(`plugin:${sc.id}`)) : null;
  if (!owner) return null;
  const state = resetStateOf(rt);
  const assets = rt.registry.list('settings');
  const resolved = resolveSettingsInterface(owner, { assets, appPick: rt.assetOrNull('settings')?.id ?? null, tabs: state.tabs ?? [], groups: state.groups ?? [] });
  const scope: ResetScope = owner.kind === 'app' ? { kind: 'console' } : { kind: 'plugin', id: owner.id };
  const plan = planSettingsReset(scope, true, state);
  const groups = owner.kind === 'plugin' ? pluginSettingsGroups(owner.id, state.tabs, state.groups) : (state.groups ?? []).filter((g) => !keyOwnerOf(g, state));
  const values: Record<string, SettingValue> = {};
  for (const g of groups) for (const s of g.settings) if (s.kind !== 'secret' && s.kind !== 'action') values[s.key] = rt.settings.get(s.key);
  return {
    $axf: 'settings-interface@1', owner: settingsOwnerKey(owner), id: resolved.id, source: resolved.source, interface: resolved.ui,
    opens: owner.kind === 'plugin' ? `settings:plugin/${owner.id}` : 'view:settings', values,
    changedAssets: plan.assets, settingsToReset: plan.settings, summary: plan.summary, undo: lastReset(rt)?.at ?? null,
  };
}

/** Is this group a plugin's? (its keys belong to a plugin) */
function keyOwnerOf(g: { settings: { key: string }[] }, state: ResetState): boolean {
  return g.settings.some((s) => keyOwner(s.key, state) !== null);
}

/** The plan as the API reads it (dry run). */
export function settingsResetReport(rt: AxfRuntime, scopeRef: string, includeAssets: boolean): ResetPlan | null {
  const s = resolveResetScope(rt, scopeRef);
  return s ? planReset(rt, s, includeAssets) : null;
}
