/**
 * PluginSettingsGear — the one gear every plugin screen carries (plugin-settings@1, core/plugin-settings.mjs).
 *
 * Brett, Nov 16 2026: "They all need a settings page. They all need a settings interface." A plugin's settings are its
 * sub-tab of Settings → Plugins; this gear opens that sub-tab and nothing else. It is a framework IconButton (the
 * `fx-iconbtn` control, so the app's button asset and style theme restyle it; no look of its own), labelled
 * "<Plugin> settings", and it carries a console-control address (`button:plugin-settings-gear-<tab>`, data-axf-target)
 * so REST, MCP, the CLI and voice press it exactly as a finger does.
 *
 * Pressing it goes through console control: `open view:settings/tab:settings.tabs=plugins/subtab:settings.subtabs=<tab>`
 * (the same command the API runs), which opens Settings, switches to Plugins, then to the plugin's sub-tab and
 * highlights it. When the sub-tab isn't registered yet (the settings library not loaded), it falls back to the
 * runtime action `settings.open:<tab>`.
 */
import { useOptionalRuntime } from '../AxfProvider';
import { controlRegistry } from '../controlTargets';
import { settingsAddress, settingsOpenAction, TAB_ID } from '../../core/plugin-settings.mjs';
import { IconButton } from './Controls';

export interface PluginSettingsGearProps {
  /** the plugin's settings tab id (plugin.json settings.tab = its `settings-tab:<id>`) */
  tab: string;
  /** the plugin's name, for the label "<name> settings" (default: the tab id) */
  plugin?: string;
  /** a full label instead of "<name> settings" */
  label?: string;
  size?: number;
  className?: string;
  /** called before the open (a popover or banner panel that hosts the gear closes itself here) */
  onBeforeOpen?: () => void;
  /** called after the open was asked for (the result tells whether console control found the sub-tab) */
  onOpened?: (result: { address: string; ok: boolean }) => void;
}

/** The gear's DOM id and the relative console-control address every gear registers under. */
export function pluginSettingsGearId(tab: string): string { return `plugin-settings-gear-${tab}`; }
export function pluginSettingsGearAddress(tab: string): string { return `button:${pluginSettingsGearId(tab)}`; }
export function pluginSettingsGearLabel(plugin: string | undefined, tab: string): string { return `${plugin?.trim() || tab} settings`; }

export function PluginSettingsGear({ tab, plugin, label, size = 14, className, onBeforeOpen, onOpened }: PluginSettingsGearProps) {
  const rt = useOptionalRuntime();
  if (!TAB_ID.test(tab)) return null;
  const address = settingsAddress(tab);
  const text = label ?? pluginSettingsGearLabel(plugin, tab);
  const open = async () => {
    if (!rt) return;
    onBeforeOpen?.();
    const r = await controlRegistry(rt).run({ verb: 'open', address });
    const ok = r.ok === true;
    if (!ok) rt.dispatch(settingsOpenAction(tab));
    onOpened?.({ address, ok });
  };
  return (
    <IconButton
      id={pluginSettingsGearId(tab)}
      data-axf-target={pluginSettingsGearAddress(tab)}
      data-axf-plugin-settings={tab}
      data-axf-opens={address}
      icon="settings"
      label={text}
      size={size}
      className={`fx-plugin-gear ${className ?? ''}`.trim()}
      onClick={() => { void open(); }}
    />
  );
}
