/**
 * Console actions of the Skins plugin (console_action, menus, search, AmberX voice). Each one calls the same REST
 * route as the screen, the CLI and the MCP plugin commands, so every way in makes the same change.
 *   skin.use <skin> [scope]   skin.back [scope] [slot]   skin.restore [scope]   skin.undo   skin.open [skin] [scope]
 *   skin.scope <scope> [follow|own]
 *   skin.setting <key> <value>   bannerChip on|off · defaultScope <scope> · undoSeconds <n> · previewView desktop|phone
 *   skin-gallery.focus:<path>  the deep link console_open … focus runs: skin/<id> | scope/<scope> | preview/<id>?view=phone
 * Scope: hub | app | ui:<view> | plugin:<id>; default the plugin's default scope (settings), else app.
 */
import type { AxfRuntime } from '@console/axf/core';
import { backAt, followAt, restoreAt, undoLast, useSkinAt, type ScopeView } from './api';
import { setLink } from './link';
import { defaultScope, saveSettings, type SkinsSettings } from './settings';

const SCOPE = /^(hub|app|app:[a-z0-9-]+|(ui|plugin):[a-z0-9][a-z0-9._-]*)$/;
const LABEL: Record<string, string> = { use: 'Skin in use', back: 'Back to skin', restore: 'Restored to default', undo: 'Undone', scope: 'Scope switch' };

function scopeArg(args: string[] | undefined, at: number): string {
  const v = (args ?? [])[at]?.trim() ?? '';
  return SCOPE.test(v) ? v : defaultScope();
}

export function registerActions(rt: AxfRuntime): void {
  const done = (verb: string, p: Promise<ScopeView>) => p.then(
    (v) => rt.toast(`${v.inForce.id || 'No skin'} at ${v.scope} (from ${v.inForce.from}).${verb !== 'undo' && v.canUndo ? ' Say "undo the skin" to take it back.' : ''}`, 'success', LABEL[verb]),
    (e: Error) => rt.toast(e.message, 'warning', 'Skins'),
  );
  rt.actions.register('skin.use', (args?: string[]) => {
    const skin = (args ?? [])[0]?.trim();
    if (!skin) { rt.navigate('skin-gallery'); return; }
    void done('use', useSkinAt(skin, scopeArg(args, 1)));
  }, { label: 'Use skin' });
  rt.actions.register('skin.back', (args?: string[]) => { void done('back', backAt(scopeArg(args, 0), (args ?? [])[1]?.trim() ?? '')); }, { label: 'Back to skin' });
  rt.actions.register('skin.restore', (args?: string[]) => { void done('restore', restoreAt(scopeArg(args, 0))); }, { label: 'Restore skin to default' });
  rt.actions.register('skin.undo', () => { void done('undo', undoLast()); }, { label: 'Undo skin change' });
  rt.actions.register('skin.scope', (args?: string[]) => {
    const scope = (args ?? [])[0]?.trim() ?? '';
    if (!SCOPE.test(scope) || scope === 'hub') { rt.toast('Say which scope: app, ui:<screen> or plugin:<id>.', 'warning', 'Skins'); return; }
    void done('scope', followAt(scope, (args ?? [])[1] !== 'own'));
  }, { label: 'Skin scope: follow or own' });
  rt.actions.register('skin.open', (args?: string[]) => {
    const [skin = '', scope = ''] = args ?? [];
    if (skin || SCOPE.test(scope)) setLink(skin ? `skin/${skin}${SCOPE.test(scope) ? `?scope=${scope}` : ''}` : `scope/${scope}`);
    rt.navigate('skin-gallery');
  }, { label: 'Open Skins' });
  rt.actions.register('skin.setting', (args?: string[]) => {
    const [key = '', ...rest] = args ?? [];
    const raw = rest.join(':').trim();
    const patch: Partial<SkinsSettings> = key === 'bannerChip' ? { bannerChip: ['on', 'true', 'show', 'yes'].includes(raw) }
      : key === 'undoSeconds' ? { undoSeconds: Number(raw) }
      : key === 'previewView' ? { previewView: raw as SkinsSettings['previewView'] }
      : key === 'defaultScope' ? { defaultScope: raw } : {};
    if (!Object.keys(patch).length) { rt.toast(`No Skins setting "${key}": bannerChip, defaultScope, undoSeconds, previewView.`, 'warning', 'Skins'); return; }
    void saveSettings(patch).then(() => rt.toast(`${key} set to ${raw}.`, 'success', 'Skins settings'), (e: Error) => rt.toast(e.message, 'warning', 'Skins settings'));
  }, { label: 'Change a Skins setting', params: true });
  rt.actions.register('skin-gallery.focus', (args?: string[]) => {
    setLink((args ?? []).join(':'));
    rt.navigate('skin-gallery');
  }, { label: 'Open Skins at a skin, scope or preview' });
}
