/**
 * Settings interface of one plugin or asset type (settings-iface@1, core/engines/settings-iface-rules.mjs; build
 * settings-iface-default-all, Nov 18 2026).
 *
 * Every plugin's settings tab and every asset type's card in Settings starts with one row: the name of the settings
 * interface it uses, greyed out and locked on its default (`default-<name>`), and a checkbox "Use another settings
 * interface". Ticking unlocks it; clicking the name (or Choose…) opens a dialog listing only the settings interfaces
 * built for that plugin or asset type (data.builtFor). Unticking goes back to the default.
 *
 * Actions (console-visible: REST, MCP, CLI, voice):
 *   settings.iface:<asset|plugin>:<name>:<settings id|default>   pick one (default = untick)
 *   settings.iface.choose:<asset|plugin>:<name>                   open the dialog
 */
import { useState } from 'react';
import { ASSET_TYPES, assetTypeSpecs, builtForOf, ifaceChoices, ifaceDefaultAsset, ifaceKey, ifacePick, ifaceSet, layerIface, parseBuiltFor, parseIfaceArgs, pluginIfaceName, type AxfRuntime, type SettingsUi } from '../../core';
import { Button, Checkbox, ChoiceGrid, Container, Icon, Note, useAxfState, useRuntime } from '../../react';

export const SETTINGS_IFACE_DIALOG = 'axf.settings.iface';
export const SETTINGS_IFACE_ACTIONS = { pick: 'settings.iface', choose: 'settings.iface.choose' } as const;
const PLUGINS_TAB = 'plugins';
/** Settings → Appearance → Asset types: one card per asset type, each with its settings interface row. */
export const ASSET_TYPES_TAB = { id: 'asset-types', label: 'Asset types', icon: 'layers', parent: 'appearance', order: 40, description: 'Every asset type and the settings interface its settings use.' } as const;
/** Modules whose sub-tabs of Plugins are not plugins (the settings library's own Banners tab). */
const NOT_PLUGINS = new Set(['ai.amberx.axf.settings']);
const ORIGIN = 'settings-iface';
const types = ASSET_TYPES as readonly string[];

/** The plugin owner of a settings tab (a sub-tab of Settings → Plugins), or null. */
export function tabIfaceOwner(rt: AxfRuntime, tabId: string): string | null {
  const tab = rt.settings.getTab(tabId);
  if (!tab || tab.parent !== PLUGINS_TAB || (tab.module && NOT_PLUGINS.has(tab.module))) return null;
  const name = pluginIfaceName(tab.module ?? tab.plugin ?? tab.id);
  return name && parseBuiltFor(`plugin:${name}`) ? `plugin:${name}` : null;
}

function settingsAssets(rt: AxfRuntime) {
  return rt.registry.list('settings') as unknown as { id: string; name?: string; description?: string; data?: Record<string, unknown> }[];
}

/**
 * Register the default of every owner that ships none (a framework library's plugin tab, an app that has not baked the
 * asset-type defaults yet), so every plugin and asset type always has its default-<name>.
 */
export function syncIfaceDefaults(rt: AxfRuntime): () => void {
  let last = '';
  const sync = () => {
    const owners = new Map<string, string>();
    for (const t of types) owners.set(`asset:${t}`, (assetTypeSpecs as Record<string, { label?: string }>)[t]?.label ?? t);
    for (const tab of rt.settings.listTabs()) { const o = tabIfaceOwner(rt, tab.id); if (o) owners.set(o, tab.label); }
    const key = [...owners.keys()].join('|');
    if (key === last) return;
    last = key;
    for (const [owner, label] of owners) {
      const a = ifaceDefaultAsset(owner, { label, assetTypes: types });
      if (a && !rt.registry.has('settings', a.id)) rt.registry.register(a, 'builtin', ORIGIN);
    }
  };
  sync();
  return rt.subscribe(sync);
}

/** The settings interface data a plugin's tab renders through: the page's, layered with the plugin's pick. */
export function ownerSettingsUi(rt: AxfRuntime, owner: string | null, base: SettingsUi): SettingsUi {
  if (!owner) return base;
  const pick = ifacePick(rt.settings.get(ifaceKey(owner) ?? ''), owner, settingsAssets(rt), types);
  const own = pick.id ? rt.registry.get('settings', pick.id)?.data : null;
  return own ? ({ ...base, ...layerIface(base, own) } as SettingsUi) : base;
}

/** Pick for an owner (`default` / '' = back to the default). Returns an error text, or '' when done. */
export function setOwnerIface(rt: AxfRuntime, owner: string, which: string): string {
  const key = ifaceKey(owner);
  if (!key) return `No settings owner "${owner}".`;
  const r = ifaceSet(owner, which, settingsAssets(rt), types);
  if (r.error !== undefined) return r.error;
  if (r.value === null) rt.settings.clear(key); else rt.settings.set(key, r.value);
  return '';
}

/** Only interfaces built for the Settings page itself are offered as the page's settings asset. */
export function isAppIface(a: { id: string; data?: unknown }): boolean {
  return builtForOf(a as never, types) === 'app';
}

export function registerIfaceActions(rt: AxfRuntime): void {
  rt.actions.register(SETTINGS_IFACE_ACTIONS.pick, (args) => {
    const p = parseIfaceArgs(args);
    if (!p || p.owner === 'app') { rt.toast('Use settings.iface:<asset|plugin>:<name>:<settings id|default>.', 'warning', 'Settings interface'); return; }
    const err = setOwnerIface(rt, p.owner, p.which);
    if (err) rt.toast(err, 'warning', 'Settings interface');
  }, { label: 'Pick the settings interface of one plugin or asset type (settings.iface:<asset|plugin>:<name>:<id|default>; default = back to the locked default)', params: true, effect: 'write' });
  rt.actions.register(SETTINGS_IFACE_ACTIONS.choose, (args) => {
    const p = parseIfaceArgs(args);
    if (!p || p.owner === 'app') return;
    rt.openDialog(SETTINGS_IFACE_DIALOG, { owner: p.owner });
  }, { label: 'Choose the settings interface of one plugin or asset type (settings.iface.choose:<asset|plugin>:<name>)', params: true });
}

/** The locked row at the top of a plugin's settings or an asset type's card. */
export function SettingsIfaceRow({ owner, label }: { owner: string; label: string }) {
  const rt = useRuntime();
  useAxfState();
  const assets = settingsAssets(rt);
  const pick = ifacePick(rt.settings.get(ifaceKey(owner) ?? ''), owner, assets, types);
  const [ticked, setTicked] = useState(false);
  const unlocked = ticked || !pick.locked;
  const current = pick.id ? rt.registry.get('settings', pick.id) : null;
  const name = current?.name ?? pick.id ?? 'None';
  const open = () => rt.dispatch(`${SETTINGS_IFACE_ACTIONS.choose}:${owner}`);
  const toggle = (on: boolean) => {
    setTicked(on);
    if (on) open();
    else rt.dispatch(`${SETTINGS_IFACE_ACTIONS.pick}:${owner}:default`);
  };
  return (
    <div className={`axf-settings-iface ${unlocked ? '' : 'is-locked'}`} data-axf-settings-iface={owner}>
      <div className="axf-settings-iface__head">
        <span className="axf-settings-iface__label fx-eyebrow">Settings interface</span>
        {unlocked
          ? <Button tone="quiet" size="sm" icon="settings" onClick={open} aria-label={`Choose the settings interface for ${label}`} title="Choose another settings interface">{name}</Button>
          : <span className="axf-settings-iface__name" aria-disabled="true" title="Locked on the default. Tick the box to choose another."><Icon name="lock" size={14} /> {name}</span>}
      </div>
      <Checkbox label="Use another settings interface" checked={unlocked} onChange={toggle} title={unlocked ? 'Untick to go back to the default' : 'Tick to choose another settings interface built for this one'} />
    </div>
  );
}

/** The dialog: only interfaces built for this owner. */
export function SettingsIfaceDialog({ owner }: { owner: string }) {
  const rt = useRuntime();
  useAxfState();
  const o = parseBuiltFor(owner);
  if (!o || o.kind === 'app') return <Note tone="warning">No settings owner "{owner}".</Note>;
  const choices = ifaceChoices(owner, settingsAssets(rt), types);
  const pick = ifacePick(rt.settings.get(ifaceKey(owner) ?? ''), owner, settingsAssets(rt), types);
  const choose = (id: string) => { rt.dispatch(`${SETTINGS_IFACE_ACTIONS.pick}:${owner}:${id}`); rt.closeDialog(); };
  return (
    <div className="fx-stack axf-settings-iface__dialog" data-axf-settings-iface-dialog={owner}>
      <p className="fx-muted">Settings interfaces built for this {o.kind === 'asset' ? 'asset type' : 'plugin'} ({o.name}). Interfaces are not shared between plugins or asset types.</p>
      <ChoiceGrid label="Settings interface" selected={pick.id ? [pick.id] : []} onToggle={choose}
        choices={choices.map((c) => ({ id: c.id, title: c.name, text: c.description, icon: c.isDefault ? 'lock' : 'settings', ...(c.isDefault ? { tag: 'Default' } : {}) }))} />
      {choices.length < 2 && <Note tone="info">Only the default is built for this one so far. A settings asset with data.builtFor = "{owner}" shows up here.</Note>}
      <div className="fx-row"><Button tone="quiet" onClick={() => rt.closeDialog()}>Close</Button></div>
    </div>
  );
}

/** Settings → Appearance → Asset types: every asset type, its active asset and its settings interface. */
export function AssetTypesIfacePanel() {
  const rt = useRuntime();
  const state = useAxfState();
  const specs = assetTypeSpecs as Record<string, { label?: string; icon?: string }>;
  return (
    <div className="fx-stack axf-settings-iface__types" role="list" aria-label="Asset types">
      {types.map((t) => {
        const label = specs[t]?.label ?? t;
        const active = (state.active as Record<string, string | undefined>)[t];
        const name = active ? (rt.registry.get(t as never, active)?.name ?? active) : '';
        return (
          <div role="listitem" key={t} data-axf-anchor={`settings-asset-type:${t}`}>
            <Container collapsible defaultOpen={false} title={label} icon={specs[t]?.icon ?? 'layers'}>
              <div className="axf-settings__rows">
                <SettingsIfaceRow owner={`asset:${t}`} label={label} />
                {name && <p className="fx-muted axf-settings__desc">Active: {name}</p>}
              </div>
            </Container>
          </div>
        );
      })}
    </div>
  );
}

export const SETTINGS_IFACE_CSS = `
.axf-settings-iface{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:var(--fx-dens-gap-md) var(--fx-dens-gap-2xl);padding:var(--fx-dens-gap-md) 0;border-bottom:var(--fx-border-w) solid var(--fx-border)}
.axf-settings-iface__head{display:flex;align-items:center;flex-wrap:wrap;gap:var(--fx-dens-gap-lg);min-width:0}
.axf-settings-iface__name{display:inline-flex;align-items:center;gap:var(--fx-dens-gap-xs);color:var(--fx-muted);opacity:var(--fx-opacity-disabled);cursor:not-allowed}
`;
