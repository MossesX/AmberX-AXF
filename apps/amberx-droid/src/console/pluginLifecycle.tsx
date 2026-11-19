/**
 * `@console/pluginLifecycle` for AmberX. A console plugin running here is installed, repaired and removed on the console
 * (its server part and data live there), so this panel says so and links there instead of offering the actions.
 */
import { Icon } from '../axf/react';

const CONSOLE = 'https://console.amberxai.com';

export function PluginLifecyclePanel({ folder }: { folder: string }) {
  return (
    <div className="fx-stack">
      <p className="fx-small fx-muted"><Icon name="package" size={14} /> This plugin runs on the Dev Console; AmberX shows it through its server. Install, repair and uninstall it there (Settings → Plugins → <code className="fx-mono">{folder}</code>).</p>
      <p className="fx-small"><a href={`${CONSOLE}/#/settings/plugins`} target="_blank" rel="noreferrer">Open the console</a></p>
    </div>
  );
}
