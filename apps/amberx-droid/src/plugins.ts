/**
 * AmberX plugins (catalog kind `amberx`, amberx-plugin@1): each folder in `src/plugins/<folder>/` has a `plugin.json`
 * and `web/index.tsx` exporting `library` (an AxfWebLibrary). The Dev Console installs them from the plugin catalog
 * (`plugin-catalog.mjs app-install amberx <folder>`, Patches → Plugins per app) and commits the folder to GitHub; this
 * app's 5-minute update rebuilds with it. They run only in the browser: the Android shell loads the same bundle.
 * Folders starting with "_" (the template) never load.
 *
 * Console plugins that list "amberx-droid" in their plugin.json `targets` (AI assistant, Agent manager, …) load here
 * too, unchanged, from `virtual:amberx-console-plugins` (vite.config.ts); their server part stays on the console.
 */
import type { AxfWebLibrary } from './axf/react';
import consolePlugins from 'virtual:amberx-console-plugins';

type Manifest = { $axf?: string; id?: string; name?: string; version?: string };

const manifests = import.meta.glob<Manifest>(['./plugins/*/plugin.json', '!./plugins/_*/**'], { eager: true, import: 'default' });
const modules = import.meta.glob<{ library?: AxfWebLibrary }>(['./plugins/*/web/index.tsx', '!./plugins/_*/**'], { eager: true });

const folderOf = (path: string) => path.split('/')[2] ?? '';

export type LoadedPlugin = { folder: string; id: string; name: string; version: string; library: AxfWebLibrary };

/** Every installed plugin with a valid manifest and a library; one per id (the first folder wins). */
export function loadPlugins(): LoadedPlugin[] {
  const out: LoadedPlugin[] = [];
  const seen = new Set<string>();
  for (const [path, mod] of Object.entries(modules).sort(([a], [b]) => a.localeCompare(b))) {
    const folder = folderOf(path);
    if (!folder || folder.startsWith('_')) continue;
    const m = manifests[`./plugins/${folder}/plugin.json`];
    if (!m || m.$axf !== 'amberx-plugin@1' || typeof m.id !== 'string' || seen.has(m.id) || !mod.library) {
      console.warn(`[amberx-droid] plugin ${folder} skipped: needs plugin.json (amberx-plugin@1) and web/index.tsx exporting library`);
      continue;
    }
    seen.add(m.id);
    out.push({ folder, id: m.id, name: m.name ?? m.id, version: m.version ?? '', library: mod.library });
  }
  for (const c of consolePlugins) {
    const id = c.manifest.id;
    if (typeof id !== 'string' || seen.has(id) || !c.library) continue;
    seen.add(id);
    out.push({ folder: c.folder, id, name: c.manifest.name ?? id, version: c.manifest.version ?? '', library: c.library });
  }
  return out;
}
