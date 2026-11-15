/**
 * <QuickSettingsFrame scope="settings"> … the interface … </QuickSettingsFrame>
 *
 * Every settings interface (console Settings, a plugin's settings, the chrome settings of tab groups / toolbars /
 * banners / navigation / menu bar, and any later one) is drawn inside this frame (quick-settings@1; Brett, Nov 13 2026:
 * "every settings interface has a collapsible pane at the very top, header Quick settings, doesn't scroll, everything
 * scrolls underneath it; current skin and override console skin; default assets like navigation menu; it says it's
 * overriding the current skin"). `framework/cli/check-quick-settings.mjs` fails CI for a settings interface without it.
 *
 * The pane is pinned (position: sticky at the top of whatever scrolls the interface: the page, a dialog body, a
 * floating window), folds with a handle whose style is an app setting, and remembers being folded per interface.
 * Its contents, in order: (1) the skin in force with "Override console skin" (a skin for just this interface: the
 * skin-coverage@1 UI level `ui:qs.<scope>`, drawn by the <SkinScope> this frame wraps around everything), (2) the
 * default assets of this interface, each with "Override console default" (the picker stays greyed out until it is
 * ticked; the pick is gated by asset-gate@1 and handed to the frame's children through QuickAssetsContext), (3) the
 * override notice with the "N assets are controlled by their own settings" line (chrome.edits).
 *
 * Everything here is an action too (quick.*, core/engines/quick-settings.mjs): console API, MCP, CLI and voice.
 */
import { useEffect, useState, type ReactNode } from 'react';
import {
  FRAMEWORK_MODULE, QUICK_ACTIONS, QUICK_ASSET_LABEL, QUICK_HANDLE_KEY, QUICK_HANDLE_LABEL, QUICK_HANDLES, normalizeQuickAssets, parseQuickAction,
  quickAssetTypes, quickAssetsKey, quickCollapsedKey, quickHandleOf, quickKindOf, quickNotice, quickOverrides, quickSkinScopeKey, quickSkinUiId, setQuickAsset,
  type AssetType, type AxfRuntime, type QuickOverride,
} from '../../core';
import { useAxfState, useRuntime } from '../AxfProvider';
import { Button, IconButton } from './Controls';
import { Checkbox, SelectField } from './Forms';
import { Icon } from './Icon';
import { SkinScope } from './SkinScope';
import { BANNER_SETTINGS_DIALOG } from './BannerSettings';
import { AssetsWithEdits } from './ChromeContext';
import { QuickAssetsContext } from './quickAssets';

export { QuickAssetsContext, useQuickAsset } from './quickAssets';


function useKeys(rt: AxfRuntime, keys: string[]): void {
  const [, setTick] = useState(0);
  useEffect(() => { const offs = keys.map((k) => rt.settings.onChange(k, () => setTick((n) => n + 1))); return () => offs.forEach((f) => f()); }, [rt, keys.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** The skin this interface overrides with ('' = it follows the console). */
export function quickSkinOf(rt: AxfRuntime, scope: string): string {
  const s = rt.skinScopes().find((x) => x.key === quickSkinScopeKey(scope));
  return s && s.use === 'on' ? s.id : '';
}

/** Every override of one interface (skin first, then assets): what the notice lists and quick.state reports. */
export function quickOverridesOf(rt: AxfRuntime, scope: string): QuickOverride[] {
  return quickOverrides({ skin: quickSkinOf(rt, scope) || null, assets: normalizeQuickAssets(rt.settings.get(quickAssetsKey(scope)), scope) });
}

/** The readable state of one interface's pane (quick.state, the console API, the CLI). */
export function quickState(rt: AxfRuntime, scope: string) {
  const assets = normalizeQuickAssets(rt.settings.get(quickAssetsKey(scope)), scope);
  const overrides = quickOverridesOf(rt, scope);
  return {
    scope, kind: quickKindOf(scope), collapsed: rt.settings.get(quickCollapsedKey(scope)) === true, handle: quickHandleOf(rt.settings.get(QUICK_HANDLE_KEY)),
    skin: { console: rt.skinInForce().id, override: quickSkinOf(rt, scope) || null },
    assets: quickAssetTypes(scope).map((type) => ({ type, console: rt.getState().active[type as AssetType] ?? '', override: assets[type] ?? null })),
    overrides, notice: quickNotice(overrides),
  };
}

/** Where `quick.open:<scope>` goes: the settings interface the scope names. */
function openScope(rt: AxfRuntime, scope: string): void {
  const [head, ...rest] = scope.split('.');
  if (head === 'plugin' && rest.length) rt.dispatch(`settings.open:${rest.join('.')}`);
  else if (head === 'chrome' && rest.length >= 1) rt.dispatch(`chrome.settings:${rest[0]}:${rest.slice(1).join('.') || 'app'}`);
  else if (head === 'banner') rt.openDialog(BANNER_SETTINGS_DIALOG, rest.length && rest.join('.') !== 'app' ? { id: rest.join('.') } : {});
  else rt.dispatch('settings.open');
}

const quickInstalled = new WeakSet<AxfRuntime>();
/** The quick.* actions (console-visible: console_action, `axf quick`, voice). Idempotent per runtime. */
export function installQuickSettings(rt: AxfRuntime): void {
  if (quickInstalled.has(rt)) return;
  quickInstalled.add(rt);
  const run = (id: string) => (args: string[]) => {
    const op = parseQuickAction(id, args);
    if ('error' in op) { rt.toast(op.error, 'warning', 'Quick settings'); return; }
    switch (op.op) {
      case 'handle': rt.settings.set(QUICK_HANDLE_KEY, op.handle); return;
      case 'open': rt.settings.set(quickCollapsedKey(op.scope), false); openScope(rt, op.scope); return;
      case 'collapse': {
        const cur = rt.settings.get(quickCollapsedKey(op.scope)) === true;
        rt.settings.set(quickCollapsedKey(op.scope), op.value === 'toggle' ? !cur : op.value === 'on');
        return;
      }
      case 'skin':
        if (op.skin) rt.scopeSkin(quickSkinScopeKey(op.scope), 'on', op.skin);
        else rt.scopeSkin(quickSkinScopeKey(op.scope), 'inherit');
        return;
      case 'asset': {
        if (op.id && !rt.applyGate(rt.checkAsset(op.type, op.id), 'Quick settings')) return;
        const next = setQuickAsset(rt.settings.get(quickAssetsKey(op.scope)), op.scope, op.type, op.id);
        if (Object.keys(next).length) rt.settings.set(quickAssetsKey(op.scope), next as never); else rt.settings.clear(quickAssetsKey(op.scope));
        return;
      }
      case 'reset':
        rt.settings.clear(quickAssetsKey(op.scope));
        if (quickSkinOf(rt, op.scope)) rt.scopeSkin(quickSkinScopeKey(op.scope), 'inherit');
        return;
      case 'state': {
        const s = op.scope ? quickState(rt, op.scope) : { handle: quickHandleOf(rt.settings.get(QUICK_HANDLE_KEY)) };
        rt.terminal.log('quick-settings', JSON.stringify(s));
        if ('notice' in s) rt.toast(s.notice || 'Follows the console skin and defaults.', 'info', 'Quick settings');
        return;
      }
    }
  };
  const labels: Record<string, string> = {
    'quick.open': 'Open a settings interface at its Quick settings (quick.open:<scope>)',
    'quick.collapse': 'Fold or unfold Quick settings (quick.collapse:<scope>:<on|off|toggle>)',
    'quick.skin': 'Override the console skin for one settings interface (quick.skin:<scope>:<skin|off>)',
    'quick.asset': 'Override a default asset for one settings interface (quick.asset:<scope>:<type>:<asset|off>)',
    'quick.reset': 'Drop every Quick settings override of one settings interface (quick.reset:<scope>)',
    'quick.handle': 'Quick settings handle style (quick.handle:<arrow|chevron|bar|text>)',
    'quick.state': 'Read the Quick settings state of a settings interface (quick.state:<scope>)',
  };
  const swaps = new Set(['quick.skin', 'quick.asset', 'quick.reset']);
  rt.actions.withModule(FRAMEWORK_MODULE, () => {
    for (const id of QUICK_ACTIONS) rt.actions.register(id, run(id), { label: labels[id] ?? id, params: true, ...(swaps.has(id) ? { requires: 'assets.swap' } : {}) });
  });
}

/** The collapse handle, in the style the app picked (Settings → Appearance → Quick settings handle; quick.handle). */
function Handle({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const rt = useRuntime();
  const style = quickHandleOf(rt.settings.get(QUICK_HANDLE_KEY));
  const label = collapsed ? 'Show Quick settings' : 'Hide Quick settings';
  const attrs = { 'aria-expanded': !collapsed, 'data-axf-quick-handle': style };
  switch (style) {
    case 'chevron': return <Button size="sm" tone="neutral" icon={collapsed ? 'chevron-down' : 'chevron-up'} aria-label={label} title={label} onClick={onToggle} {...attrs} />;
    case 'text': return <Button size="sm" tone="neutral" onClick={onToggle} {...attrs}>{collapsed ? 'Show' : 'Hide'}</Button>;
    case 'bar': return <Button size="sm" tone="neutral" className="fx-qs__bar" aria-label={label} title={label} onClick={onToggle} {...attrs}><span className="fx-qs__grip" aria-hidden="true" /></Button>;
    default: return <IconButton icon={collapsed ? 'chevron-right' : 'chevron-down'} label={label} onClick={onToggle} {...attrs} />;
  }
}

/** The pane itself (pinned at the top of the frame). */
export function QuickSettings({ scope }: { scope: string }) {
  const rt = useRuntime();
  useAxfState();
  useKeys(rt, [quickCollapsedKey(scope), quickAssetsKey(scope), QUICK_HANDLE_KEY]);
  const collapsed = rt.settings.get(quickCollapsedKey(scope)) === true;
  const toggle = () => rt.dispatch(`quick.collapse:${scope}:${collapsed ? 'off' : 'on'}`);
  const consoleSkin = rt.skinInForce().id;
  const ownSkin = quickSkinOf(rt, scope);
  const skins = rt.skinList();
  const skinName = (id: string) => skins.find((s) => s.id === id)?.name ?? (id || 'none');
  const assets = normalizeQuickAssets(rt.settings.get(quickAssetsKey(scope)), scope);
  const overrides = quickOverrides({ skin: ownSkin || null, assets });
  const notice = quickNotice(overrides);
  const style = quickHandleOf(rt.settings.get(QUICK_HANDLE_KEY));
  const handle = <Handle collapsed={collapsed} onToggle={toggle} />;
  return (
    <section className={`fx-qs ${collapsed ? 'is-collapsed' : ''}`} aria-label="Quick settings" data-axf-quick={scope} data-axf-quick-overrides={overrides.length}>
      <div className="fx-qs__head">
        {style !== 'bar' && handle}
        <h3 className="fx-qs__title"><Icon name="sliders" size={14} /> Quick settings</h3>
        {collapsed && notice && <span className="fx-chip fx-chip--warning" title={notice}>Overriding</span>}
      </div>
      {!collapsed && (
        <div className="fx-qs__body">
          <div className="fx-qs__row" data-axf-quick-part="skin">
            <span className="fx-qs__label"><Icon name="palette" size={13} /> Skin</span>
            <span className="fx-qs__current">{skinName(ownSkin || consoleSkin)}{ownSkin ? '' : ' (console)'}</span>
            <Checkbox label="Override console skin" checked={!!ownSkin} onChange={(on) => rt.dispatch(on ? `quick.skin:${scope}:${consoleSkin || skins[0]?.id || 'off'}` : `quick.skin:${scope}:off`)} />
            <SelectField label="Skin for this interface" value={ownSkin || consoleSkin} disabled={!ownSkin} options={skins.map((s) => ({ value: s.id, label: s.name }))} onChange={(v) => rt.dispatch(`quick.skin:${scope}:${v}`)} />
          </div>
          {quickAssetTypes(scope).map((type) => {
            const cur = rt.getState().active[type as AssetType] ?? '';
            const own = assets[type] ?? '';
            const list = rt.registry.list(type as AssetType);
            const name = (id: string) => list.find((a) => a.id === id)?.name ?? (id || 'none');
            return (
              <div key={type} className="fx-qs__row" data-axf-quick-part={`asset:${type}`}>
                <span className="fx-qs__label">{QUICK_ASSET_LABEL[type] ?? type}</span>
                <span className="fx-qs__current">{name(own || cur)}{own ? '' : ' (console)'}</span>
                <Checkbox label="Override console default" checked={!!own} disabled={!list.length} onChange={(on) => rt.dispatch(`quick.asset:${scope}:${type}:${on ? cur || list[0]?.id || 'off' : 'off'}`)} />
                <SelectField label={`${QUICK_ASSET_LABEL[type] ?? type} for this interface`} value={own || cur} disabled={!own} empty={cur ? undefined : 'None'} options={list.map((a) => ({ value: a.id, label: a.name }))} onChange={(v) => rt.dispatch(`quick.asset:${scope}:${type}:${v}`)} />
              </div>
            );
          })}
          {notice && (
            <div className="fx-qs__notice" role="status" data-axf-quick-part="notice">
              <span className="fx-qs__noticeline"><Icon name="alert" size={13} /> {notice}</span>
              <ul className="fx-qs__list" aria-label="Overrides here">
                {overrides.map((o) => {
                  const key = o.kind === 'skin' ? 'skin' : `asset:${o.type}`;
                  const what = o.kind === 'skin' ? `Skin: ${skinName(o.id)}` : `${QUICK_ASSET_LABEL[o.type] ?? o.type}: ${o.id}`;
                  return (
                    <li key={key} className="fx-qs__item" data-axf-quick-override={key}>
                      <span>{what}</span>
                      <Button size="sm" tone="neutral" icon="undo" onClick={() => rt.dispatch(o.kind === 'skin' ? `quick.skin:${scope}:off` : `quick.asset:${scope}:${o.type}:off`)}>Reset</Button>
                    </li>
                  );
                })}
              </ul>
              {overrides.length > 1 && <Button size="sm" tone="neutral" icon="undo" onClick={() => rt.dispatch(`quick.reset:${scope}`)}>Reset all here</Button>}
            </div>
          )}
          <AssetsWithEdits />
        </div>
      )}
      {style === 'bar' && handle}
    </section>
  );
}

/** A settings interface: its own skin level, the pinned Quick settings pane, then everything else (which scrolls under it). */
export function QuickSettingsFrame({ scope, className = '', children }: { scope: string; className?: string; children: ReactNode }) {
  const rt = useRuntime();
  useEffect(() => installQuickSettings(rt), [rt]);
  useKeys(rt, [quickAssetsKey(scope)]);
  const assets = normalizeQuickAssets(rt.settings.get(quickAssetsKey(scope)), scope);
  return (
    <SkinScope kind="ui" id={quickSkinUiId(scope)} className={`fx-qs-frame ${className}`.trim()} attrs={{ 'data-axf-quick-frame': scope }}>
      <QuickSettings scope={scope} />
      <QuickAssetsContext.Provider value={assets}>
        <div className="fx-qs-frame__body">{children}</div>
      </QuickAssetsContext.Provider>
    </SkinScope>
  );
}

export { QUICK_HANDLES, QUICK_HANDLE_LABEL };
