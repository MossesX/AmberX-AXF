/**
 * The settings gear every plugin screen carries (build every-plugin-screen-gets-a-settings-gear; Brett, Nov 16 2026:
 * "Every one has a gear icon to open its settings, right? Yeah, check and fix.").
 *
 * One shared gear, drawn by the console host, never by a plugin: `countingUses()` (pluginLoader.tsx) wraps every
 * plugin view in <PluginViewHost>, a slim role="toolbar" row above the screen with the gear at its right end. The gear
 * opens Settings → Plugins → <the plugin's sub-tab> through the standard `settings.open:<tab>` action, so it is the same
 * press as the console action `plugin.settings.open:<folder>`, the CLI and voice.
 *
 *   address  view:<screen>/button:settings-gear              (console-control@1; relative inside the view's ControlScope)
 *   opens    view:settings/tab:settings.tabs=plugins/subtab:settings.subtabs=<tab>
 *
 * Tap-to-confirm needs no code here: the row is a role="toolbar", which framework/react/tapConfirm.ts arms.
 * A plugin opts out only through plugin.json `"settingsGear": false` with a `"settingsGearReason"`.
 * Tokens only (pluginSettingsGear.css), framework IconButton, no raw controls.
 */
import { useSyncExternalStore, type MouseEvent, type ReactNode } from 'react';
import { Button, IconButton, useRuntime } from './axf/react';
import './pluginSettingsGear.css';

/** The address part every gear registers (relative: the view's ControlScope puts `view:<screen>/` in front). */
export const SETTINGS_GEAR_TARGET = 'settings-gear';

/** How the gear is drawn (console setting, Settings → Plugins → Console plugins): icon | label | menu. */
export const SETTINGS_GEAR_PLACEMENT_KEY = 'axf.plugins.settingsGear.placement';
export type SettingsGearPlacement = 'icon' | 'label' | 'menu';
/** The context-menu target of the ⋯ button (placement `menu`); its Settings item is registered in pluginSettingsActions.ts. */
export const PLUGIN_HOST_MENU = 'plugin-host';

function usePlacement(): SettingsGearPlacement {
  const rt = useRuntime();
  const v = useSyncExternalStore((fn) => rt.settings.subscribe(fn), () => String(rt.settings.get(SETTINGS_GEAR_PLACEMENT_KEY) ?? ''), () => '');
  return v === 'label' || v === 'menu' ? v : 'icon';
}

/** The Settings → Plugins sub-tab address of one plugin settings tab id. */
export const pluginSettingsAddress = (tab: string) => `view:settings/tab:settings.tabs=plugins/subtab:settings.subtabs=${tab}`;

export interface PluginSettingsGearProps {
  /** plugin folder (apps/console-web/plugins/<folder>) */
  folder: string;
  /** plugin display name, for the label ("VPS Configuration settings") */
  name: string;
  /** the plugin's Settings → Plugins sub-tab id (its settingsTabs[0].id; the folder when it uses the default tab) */
  tab: string;
}

/** The gear: a framework IconButton (or Button with its label, or a ⋯ menu) that opens the plugin's Settings → Plugins sub-tab. */
export function PluginSettingsGear({ folder, name, tab }: PluginSettingsGearProps): ReactNode {
  const rt = useRuntime();
  const placement = usePlacement();
  const open = () => rt.dispatch(`settings.open:${tab}`);
  const common = { id: SETTINGS_GEAR_TARGET, className: 'cw-plugin-gear', 'data-axf-plugin-gear': folder, 'data-axf-opens': pluginSettingsAddress(tab), 'data-axf-placement': placement };
  if (placement === 'label') return <Button {...common} size="sm" tone="quiet" icon="settings" title={`${name} settings (Settings → Plugins → ${name})`} onClick={open}>Settings</Button>;
  if (placement === 'menu') {
    const more = (e: MouseEvent<HTMLButtonElement>) => { const r = e.currentTarget.getBoundingClientRect(); rt.openContext(r.left, r.bottom, PLUGIN_HOST_MENU, folder); };
    return <IconButton {...common} icon="more" label={`${name}: more`} title={`${name}: settings and more`} onClick={more} />;
  }
  return <IconButton {...common} icon="settings" label={`${name} settings`} title={`${name} settings (Settings → Plugins → ${name})`} onClick={open} />;
}

/** What the host needs to draw a plugin's screen with its gear. null tab = no settings tab (the CI check refuses that). */
export interface PluginViewHostProps extends Partial<PluginSettingsGearProps> {
  children?: ReactNode;
}

/**
 * The host row above one plugin screen: its own flex line (never drawn over the plugin's page head), the gear at its
 * right end. Without a tab it renders the screen alone.
 */
export function PluginViewHost({ folder, name, tab, children }: PluginViewHostProps): ReactNode {
  if (!folder || !tab) return <>{children}</>;
  const label = name || folder;
  return (
    <div className="cw-plugin-host" data-axf-plugin-host={folder}>
      <div className="cw-plugin-host__bar" role="toolbar" aria-label={`${label} screen`} data-axf-toolbar={`plugin-host.${folder}`}>
        <PluginSettingsGear folder={folder} name={label} tab={tab} />
      </div>
      {children}
    </div>
  );
}
