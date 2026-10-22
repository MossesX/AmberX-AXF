/** `@console/pluginLifecycle` in Patches: install and uninstall happen in the Dev Console; Patches says so. */
import { Note } from '../axf/react';

export function PluginLifecyclePanel({ folder }: { folder: string }) {
  return (
    <Note tone="info" icon="package">
      Patches runs this plugin’s banner; its server part ({folder}) runs in the Dev Console. Switch it on or off in Settings → Patches → Plugins.
    </Note>
  );
}
