/**
 * PluginScreenHeader — the header slot of a plugin screen, with the settings gear in its tools (plugin-settings@1).
 *
 * The framework page header (`fx-pagehead`: eyebrow, title, lede) plus a tools strip at the end (`role="toolbar"`,
 * labelled "<title> tools") that holds the screen's own actions and, last, the one PluginSettingsGear that opens the
 * plugin's Settings → Plugins sub-tab. Plugins render it instead of a hand-made <header>, so every screen gets the
 * gear in the same place, and a plugin that must keep its own header puts <PluginSettingsGear tab=…/> in it.
 *
 * Inside a host's settings page (embed@1 page mode, rt.embedded.page) the header is not drawn: the host shows the
 * plugin's name and the settings are already on screen.
 *
 * Every size, gap and colour comes from the theme tokens through axf.css (.fx-pagehead, .fx-pagehead__tools); the
 * component sets none of its own.
 */
import type { ReactNode } from 'react';
import { useOptionalRuntime } from '../AxfProvider';
import { PluginSettingsGear } from './PluginSettingsGear';

export interface PluginScreenHeaderProps {
  /** the plugin's settings tab id (plugin.json settings.tab) */
  tab: string;
  /** the screen title (h1) and the plugin's name for the gear label */
  title: string;
  /** small line above the title (default "Plugin") */
  eyebrow?: ReactNode;
  /** a line under the title */
  lede?: ReactNode;
  /** the screen's own actions, drawn before the gear */
  actions?: ReactNode;
  /** draw the gear (default true; false only for a plugin without a settings tab, which plugin-settings@1 refuses) */
  gear?: boolean;
  /** the gear's label when "<title> settings" isn't right */
  gearLabel?: string;
  /** accessible name of the tools strip (default "<title> tools") */
  toolsLabel?: string;
  className?: string;
  children?: ReactNode;
}

export function PluginScreenHeader({ tab, title, eyebrow = 'Plugin', lede, actions, gear = true, gearLabel, toolsLabel, className, children }: PluginScreenHeaderProps) {
  const rt = useOptionalRuntime();
  if (rt?.embedded?.page) return null;
  const tools = toolsLabel ?? `${title} tools`;
  return (
    <header className={`fx-pagehead ${className ?? ''}`.trim()} data-axf-plugin-header={tab}>
      <div>
        {eyebrow ? <p className="fx-eyebrow">{eyebrow}</p> : null}
        <h1>{title}</h1>
        {lede ? <p className="fx-muted">{lede}</p> : null}
        {children}
      </div>
      <div className="fx-pagehead__tools" role="toolbar" aria-label={tools} data-axf-toolbar={`plugin-header.${tab}`}>
        {actions}
        {gear ? <PluginSettingsGear tab={tab} plugin={title} label={gearLabel} /> : null}
      </div>
    </header>
  );
}
