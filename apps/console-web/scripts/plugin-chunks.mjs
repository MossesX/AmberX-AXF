/**
 * Vite plugin for the console's plugin lazy loader (src/pluginLoader.ts).
 *
 * - `virtual:axf-plugin-hashes`: a content hash of every plugin's web part (plugins/<folder>/web/**), so the loader
 *   knows when a cached shape (menus, views, actions a plugin contributes) is stale and the plugin must load once.
 * - `axf-plugin-chunks.json` (build only): each plugin's own chunk file, its size and its CSS, for the lazy loader's
 *   live table and the offline chunk cache.
 * - Dev (HMR): each plugin's `web/index.tsx` is its own update boundary, so an edit to one plugin re-installs only
 *   that plugin instead of reloading the page and every other plugin.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const VIRTUAL = 'virtual:axf-plugin-hashes';
const RESOLVED = `\0${VIRTUAL}`;
const ENTRY = /\/plugins\/([a-z0-9][a-z0-9-]*)\/web\/index\.tsx$/;
export const HOT_EVENT = 'axf:plugin-hot';
export const CHUNKS_FILE = 'axf-plugin-chunks.json';

function files(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else out.push(p);
  }
  return out;
}

/** folder → short content hash of its web part (path + bytes of every file under web/). */
export function pluginHashes(pluginsDir) {
  const out = {};
  if (!existsSync(pluginsDir)) return out;
  for (const folder of readdirSync(pluginsDir).sort()) {
    const web = join(pluginsDir, folder, 'web');
    if (folder.startsWith('_') || !existsSync(web)) continue;
    const h = createHash('sha1');
    for (const f of files(web)) { h.update(f.slice(web.length)); h.update(readFileSync(f)); }
    out[folder] = h.digest('hex').slice(0, 12);
  }
  return out;
}

export function pluginChunks({ pluginsDir }) {
  let serve = false;
  return {
    name: 'axf-plugin-chunks',
    enforce: 'post',
    configResolved(c) { serve = c.command === 'serve'; },
    resolveId(id) { return id === VIRTUAL ? RESOLVED : undefined; },
    load(id) { return id === RESOLVED ? `export default ${JSON.stringify(pluginHashes(pluginsDir))};` : undefined; },
    transform(code, id) {
      if (!serve) return undefined;
      const m = ENTRY.exec(id.split('?')[0]);
      if (!m) return undefined;
      const fire = `globalThis.dispatchEvent(new CustomEvent(${JSON.stringify(HOT_EVENT)}, { detail: { folder: ${JSON.stringify(m[1])}, exports: nextExports } }))`;
      // React Refresh would invalidate this module (it exports `plugin`, not only components) and reload the page.
      const refresh = 'if (invalidateMessage) import.meta.hot.invalidate(invalidateMessage);';
      if (code.includes(refresh)) return { code: code.replace(refresh, `if (invalidateMessage) ${fire};`), map: null };
      return { code: `${code}\nif (import.meta.hot) import.meta.hot.accept((nextExports) => { if (nextExports) ${fire}; });\n`, map: null };
    },
    generateBundle(_opts, bundle) {
      const out = {};
      const size = (f) => { const a = bundle[f]; return a ? (a.type === 'chunk' ? Buffer.byteLength(a.code) : (typeof a.source === 'string' ? Buffer.byteLength(a.source) : a.source.length)) : 0; };
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk' || !chunk.facadeModuleId) continue;
        const m = ENTRY.exec(chunk.facadeModuleId);
        if (!m) continue;
        const css = [...(chunk.viteMetadata?.importedCss ?? [])];
        out[m[1]] = { file: chunk.fileName, bytes: size(chunk.fileName), css, cssBytes: css.reduce((n, f) => n + size(f), 0) };
      }
      const entry = Object.values(bundle).find((c) => c.type === 'chunk' && c.isEntry);
      const startup = entry ? { file: entry.fileName, bytes: size(entry.fileName), css: [...(entry.viteMetadata?.importedCss ?? [])].reduce((n, f) => n + size(f), 0) } : null;
      this.emitFile({ type: 'asset', fileName: CHUNKS_FILE, source: JSON.stringify({ startup, plugins: out }) });
    },
  };
}
