/**
 * AmberX plugins (catalog kind `amberx`, amberx-plugin@1): each folder in `src/plugins/<folder>/` has a `plugin.json`
 * and `web/index.tsx` exporting `library` (an AxfWebLibrary). The Dev Console installs them from the plugin catalog
 * (`plugin-catalog.mjs app-install amberx <folder>`, Patches → Plugins per app) and commits the folder to GitHub; this
 * app's 5-minute update rebuilds with it. They run only in the browser: the Android shell loads the same bundle.
 * Folders starting with "_" (the template) never load.
 */
import type { AxfWebLibrary } from './axf/react';

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
  return out;
}
